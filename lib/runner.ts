import { withClient, resolveConnection, friendlyDbError, type ConnectionSource } from "./db"
import { checkStatement, buildExplain } from "./sql-safety"
import { analyzePlan, type AnalysisResult, type ExplainResult } from "./analyze"

export interface ConnectionInput {
  source?: ConnectionSource
  connectionString?: string
}

export interface AnalyzeOutput {
  explain: ExplainResult
  analysis: AnalysisResult
  executed: boolean
  source: ConnectionSource
}

/**
 * Run EXPLAIN (optionally ANALYZE) for a statement and return the parsed plan
 * plus heuristic analysis. Read-only statements are executed inside a READ ONLY
 * transaction so data can never be mutated.
 */
export async function runAnalyze(sql: string, conn: ConnectionInput): Promise<AnalyzeOutput> {
  const check = checkStatement(sql)
  if (!check.ok) throw new Error(check.reason ?? "Invalid statement.")

  const { connectionString, source } = resolveConnection(conn.source, conn.connectionString)
  const analyze = check.isReadOnly
  const explainSql = buildExplain(check.normalized, analyze)

  try {
    const rows = await withClient(connectionString, async (client) => {
      if (analyze) {
        await client.query("BEGIN")
        await client.query("SET TRANSACTION READ ONLY")
        try {
          const res = await client.query(explainSql)
          return res.rows
        } finally {
          await client.query("ROLLBACK").catch(() => {})
        }
      }
      const res = await client.query(explainSql)
      return res.rows
    })

    const explainJson = rows[0]?.["QUERY PLAN"]
    const parsed: ExplainResult = Array.isArray(explainJson) ? explainJson[0] : explainJson
    if (!parsed?.Plan) {
      throw new Error("Could not read the query plan from the database.")
    }

    return {
      explain: parsed,
      analysis: analyzePlan(parsed),
      executed: analyze,
      source,
    }
  } catch (err) {
    throw new Error(friendlyDbError(err))
  }
}

export interface ColumnInfo {
  name: string
  type: string
  nullable: boolean
}

export interface IndexInfo {
  name: string
  definition: string
}

export interface TableInfo {
  schema: string
  name: string
  estimatedRows: number
  columns: ColumnInfo[]
  indexes: IndexInfo[]
}

/**
 * Introspect user tables (excluding system + auth schemas) for the connection.
 */
export async function getSchema(conn: ConnectionInput): Promise<TableInfo[]> {
  const { connectionString } = resolveConnection(conn.source, conn.connectionString)

  try {
    return await withClient(connectionString, async (client) => {
      const tablesRes = await client.query<{
        schemaname: string
        relname: string
        reltuples: number
      }>(
        `SELECT n.nspname AS schemaname, c.relname, c.reltuples
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE c.relkind = 'r'
           AND n.nspname NOT IN ('pg_catalog','information_schema','pg_toast','neon_auth')
         ORDER BY n.nspname, c.relname
         LIMIT 200`,
      )

      const tables: TableInfo[] = []
      for (const t of tablesRes.rows) {
        const colsRes = await client.query<{
          column_name: string
          data_type: string
          is_nullable: string
        }>(
          `SELECT column_name, data_type, is_nullable
           FROM information_schema.columns
           WHERE table_schema = $1 AND table_name = $2
           ORDER BY ordinal_position`,
          [t.schemaname, t.relname],
        )

        const idxRes = await client.query<{ indexname: string; indexdef: string }>(
          `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = $1 AND tablename = $2`,
          [t.schemaname, t.relname],
        )

        tables.push({
          schema: t.schemaname,
          name: t.relname,
          estimatedRows: Math.max(0, Math.round(t.reltuples)),
          columns: colsRes.rows.map((c) => ({
            name: c.column_name,
            type: c.data_type,
            nullable: c.is_nullable === "YES",
          })),
          indexes: idxRes.rows.map((i) => ({ name: i.indexname, definition: i.indexdef })),
        })
      }
      return tables
    })
  } catch (err) {
    throw new Error(friendlyDbError(err))
  }
}

export interface BenchmarkQuery {
  label: string
  sql: string
}

export interface BenchmarkResult {
  label: string
  sql: string
  ok: boolean
  error?: string
  executionTime?: number
  planningTime?: number
  totalCost?: number
  runs?: number[]
  nodeTypes?: string[]
}

/**
 * Benchmark read-only queries by running EXPLAIN (ANALYZE) a few times and
 * reporting the median execution time. Non read-only statements are rejected.
 */
export async function runBenchmark(
  queries: BenchmarkQuery[],
  conn: ConnectionInput,
  iterations = 3,
): Promise<BenchmarkResult[]> {
  const { connectionString } = resolveConnection(conn.source, conn.connectionString)

  return withClient(connectionString, async (client) => {
    const results: BenchmarkResult[] = []

    for (const q of queries) {
      const check = checkStatement(q.sql)
      if (!check.ok) {
        results.push({ label: q.label, sql: q.sql, ok: false, error: check.reason })
        continue
      }
      if (!check.isReadOnly) {
        results.push({
          label: q.label,
          sql: q.sql,
          ok: false,
          error: "Benchmarking is only available for read-only (SELECT) queries.",
        })
        continue
      }

      const explainSql = buildExplain(check.normalized, true)
      const runs: number[] = []
      let planningTime: number | undefined
      let totalCost: number | undefined
      const nodeTypes = new Set<string>()

      try {
        await client.query("BEGIN")
        await client.query("SET TRANSACTION READ ONLY")
        for (let i = 0; i < iterations; i++) {
          const res = await client.query(explainSql)
          const plan: ExplainResult = res.rows[0]["QUERY PLAN"][0]
          if (typeof plan["Execution Time"] === "number") runs.push(plan["Execution Time"])
          planningTime = plan["Planning Time"]
          totalCost = plan.Plan["Total Cost"]
          collectNodeTypes(plan.Plan, nodeTypes)
        }
        await client.query("ROLLBACK").catch(() => {})

        const sorted = [...runs].sort((a, b) => a - b)
        const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : undefined

        results.push({
          label: q.label,
          sql: q.sql,
          ok: true,
          executionTime: median,
          planningTime,
          totalCost,
          runs,
          nodeTypes: [...nodeTypes],
        })
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {})
        results.push({ label: q.label, sql: q.sql, ok: false, error: friendlyDbError(err) })
      }
    }

    return results
  })
}

function collectNodeTypes(node: { "Node Type": string; Plans?: unknown[] }, set: Set<string>) {
  set.add(node["Node Type"])
  for (const child of (node.Plans as { "Node Type": string; Plans?: unknown[] }[]) ?? []) {
    collectNodeTypes(child, set)
  }
}

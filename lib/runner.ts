import { withClient, resolveConnection, friendlyDbError, type ConnectionSource } from "./db"
import { checkStatement, buildExplain } from "./sql-safety"
import { analyzePlan, type AnalysisResult, type ExplainResult, type IndexSuggestion } from "./analyze"

/** Minimal structural type for whatever pg client `withClient` hands us. */
type QueryClient = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> }

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
    const { parsed, analysis } = await withClient(connectionString, async (client) => {
      let rows: any[]
      if (analyze) {
        await client.query("BEGIN")
        await client.query("SET TRANSACTION READ ONLY")
        try {
          const res = await client.query(explainSql)
          rows = res.rows
        } finally {
          await client.query("ROLLBACK").catch(() => {})
        }
      } else {
        const res = await client.query(explainSql)
        rows = res.rows
      }

      const explainJson = rows![0]?.["QUERY PLAN"]
      const parsed: ExplainResult = Array.isArray(explainJson) ? explainJson[0] : explainJson
      if (!parsed?.Plan) {
        throw new Error("Could not read the query plan from the database.")
      }

      const analysis = analyzePlan(parsed)

      // Validate index suggestions against the planner's own cost model using
      // hypothetical (HypoPG) indexes, when the extension is available.
      if (analysis.indexSuggestions.length > 0) {
        analysis.indexSuggestions = await validateSuggestions(
          client,
          check.normalized,
          parsed.Plan["Total Cost"] ?? 0,
          analysis.indexSuggestions,
        )
      }

      return { parsed, analysis }
    })

    return { explain: parsed, analysis, executed: analyze, source }
  } catch (err) {
    throw new Error(friendlyDbError(err))
  }
}

/**
 * Ensure HypoPG is usable on this connection. Returns false (rather than
 * throwing) when the extension isn't installed and can't be created, so
 * suggestions gracefully fall back to "estimated".
 */
async function ensureHypopg(client: QueryClient): Promise<boolean> {
  try {
    const present = await client.query("SELECT 1 FROM pg_extension WHERE extname = 'hypopg'")
    if ((present.rowCount ?? present.rows.length) > 0) return true
  } catch {
    /* ignore */
  }
  try {
    await client.query("CREATE EXTENSION IF NOT EXISTS hypopg")
    return true
  } catch {
    return false
  }
}

/**
 * For each candidate index, create a hypothetical index with HypoPG, re-plan the
 * query, and record the planner's projected cost change. Suggestions the planner
 * wouldn't actually use (no meaningful cost drop) are discarded. If HypoPG is
 * unavailable the suggestions are returned unchanged (still marked `estimated`).
 */
async function validateSuggestions(
  client: QueryClient,
  normalizedSql: string,
  baselineCost: number,
  suggestions: IndexSuggestion[],
): Promise<IndexSuggestion[]> {
  const available = await ensureHypopg(client)
  if (!available || baselineCost <= 0) return suggestions

  const validated: IndexSuggestion[] = []
  for (const s of suggestions) {
    try {
      await client.query("SELECT hypopg_reset()")
      await client.query("SELECT hypopg_create_index($1)", [s.ddl.replace(/;\s*$/, "")])
      const res = await client.query(`EXPLAIN (FORMAT JSON) ${normalizedSql}`)
      const planJson = res.rows[0]?.["QUERY PLAN"]
      const plan = Array.isArray(planJson) ? planJson[0] : planJson
      const newCost: number | undefined = plan?.Plan?.["Total Cost"]
      await client.query("SELECT hypopg_reset()")

      if (typeof newCost === "number") {
        const improvementPct = ((baselineCost - newCost) / baselineCost) * 100
        validated.push({
          ...s,
          estimated: false,
          verified: true,
          baselineCost,
          hypotheticalCost: newCost,
          improvementPct,
        })
      } else {
        validated.push(s)
      }
    } catch {
      // Leave this suggestion as estimated if validation fails for any reason.
      await client.query("SELECT hypopg_reset()").catch(() => {})
      validated.push(s)
    }
  }

  // Keep unverified suggestions as-is; drop verified ones the planner ignores
  // (a hypothetical index that barely moves cost wouldn't be used in practice).
  const kept = validated.filter((s) => !s.verified || (s.improvementPct ?? 0) > 1)
  kept.sort((a, b) => (b.improvementPct ?? -1) - (a.improvementPct ?? -1))
  return kept
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



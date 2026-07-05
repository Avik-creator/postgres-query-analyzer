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



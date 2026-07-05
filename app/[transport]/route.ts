import { createMcpHandler } from "mcp-handler"
import { z } from "zod"
import { runAnalyze, getSchema, runBenchmark } from "@/lib/runner"

export const runtime = "nodejs"
export const maxDuration = 60

function connFrom(connectionString?: string) {
  return connectionString?.trim()
    ? { source: "custom" as const, connectionString }
    : { source: "demo" as const }
}

function textContent(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] }
}

const handler = createMcpHandler((server) => {
  server.registerTool(
    "analyze_query",
    {
      title: "Analyze Postgres query",
      description:
        "Run EXPLAIN (ANALYZE for read-only queries) on a PostgreSQL statement and return the execution plan, heuristic findings, and index suggestions. Uses the built-in demo database unless a connection string is provided.",
      inputSchema: {
        sql: z.string().describe("The SQL statement to analyze."),
        connectionString: z
          .string()
          .optional()
          .describe("Optional postgres:// connection string. Omit to use the demo database."),
      },
    },
    async ({ sql, connectionString }) => {
      try {
        const result = await runAnalyze(sql, connFrom(connectionString))
        return textContent({
          executed: result.executed,
          summary: result.analysis.summary,
          findings: result.analysis.findings,
          indexSuggestions: result.analysis.indexSuggestions,
        })
      } catch (err) {
        return textContent({ error: err instanceof Error ? err.message : "Analysis failed." })
      }
    },
  )

  server.registerTool(
    "get_schema",
    {
      title: "Get database schema",
      description:
        "List user tables with columns, estimated row counts, and existing indexes. Uses the demo database unless a connection string is provided.",
      inputSchema: {
        connectionString: z.string().optional().describe("Optional postgres:// connection string."),
      },
    },
    async ({ connectionString }) => {
      try {
        const tables = await getSchema(connFrom(connectionString))
        return textContent({ tables })
      } catch (err) {
        return textContent({ error: err instanceof Error ? err.message : "Failed to load schema." })
      }
    },
  )

  server.registerTool(
    "benchmark_queries",
    {
      title: "Benchmark queries",
      description:
        "Run multiple read-only queries with EXPLAIN ANALYZE and compare median execution time, planning time, and cost.",
      inputSchema: {
        queries: z
          .array(z.object({ label: z.string(), sql: z.string() }))
          .describe("Queries to benchmark, each with a label."),
        connectionString: z.string().optional().describe("Optional postgres:// connection string."),
      },
    },
    async ({ queries, connectionString }) => {
      try {
        const results = await runBenchmark(queries, connFrom(connectionString))
        return textContent({ results })
      } catch (err) {
        return textContent({ error: err instanceof Error ? err.message : "Benchmark failed." })
      }
    },
  )
})

export { handler as GET, handler as POST, handler as DELETE }

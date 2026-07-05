import { NextResponse } from "next/server"
import { generateObject } from "ai"
import { createGroq } from "@ai-sdk/groq"
import { z } from "zod"
import { runAnalyze, getSchema } from "@/lib/runner"

const groq = createGroq({ apiKey: process.env.GROQ_API_KEY })

export const runtime = "nodejs"
export const maxDuration = 60

const aiSchema = z.object({
  summary: z.string().describe("One paragraph plain-English explanation of what the query does and its main performance characteristic."),
  rewrittenQuery: z.string().describe("An optimized rewrite of the SQL. If no rewrite helps, return the original query unchanged."),
  rewriteRationale: z.string().describe("Why the rewrite helps, or why the original is already optimal."),
  indexSuggestions: z
    .array(
      z.object({
        ddl: z.string().describe("A single CREATE INDEX statement."),
        rationale: z.string().describe("Why this index helps this query."),
      }),
    )
    .describe("Concrete index DDL statements. Empty array if none are needed."),
  concepts: z
    .array(
      z.object({
        name: z.string().describe("Postgres concept, e.g. Bitmap Scan, Hash Join, MVCC, VACUUM."),
        explanation: z.string().describe("How this concept relates to the analyzed query, one or two sentences."),
      }),
    )
    .describe("Relevant Postgres internals demonstrated by this plan."),
})

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const sql: string = body?.sql ?? ""
    if (!sql.trim()) {
      return NextResponse.json({ error: "Provide a SQL query." }, { status: 400 })
    }

    if (!process.env.GROQ_API_KEY) {
      return NextResponse.json(
        { error: "GROQ_API_KEY is not set. Add it in Project Settings to enable AI analysis." },
        { status: 400 },
      )
    }

    const conn = { source: body?.source, connectionString: body?.connectionString }

    // Gather plan + schema context for grounding the model.
    const [analyzeResult, schema] = await Promise.all([
      runAnalyze(sql, conn),
      getSchema(conn).catch(() => []),
    ])

    const schemaText = schema
      .map(
        (t) =>
          `${t.schema}.${t.name} (~${t.estimatedRows} rows)\n  columns: ${t.columns
            .map((c) => `${c.name} ${c.type}`)
            .join(", ")}\n  indexes: ${t.indexes.map((i) => i.definition).join("; ") || "none"}`,
      )
      .join("\n")

    const { object } = await generateObject({
      model: groq("openai/gpt-oss-120b"),
      schema: aiSchema,
      system:
        "You are a senior PostgreSQL performance engineer. Given a query, its EXPLAIN plan, and the schema, produce actionable, correct advice. Only suggest indexes that would genuinely help. Keep explanations concise and practical. Never invent columns that are not in the schema.",
      prompt: [
        `SQL QUERY:\n${sql}`,
        `\nHEURISTIC FINDINGS:\n${analyzeResult.analysis.findings
          .map((f) => `- [${f.severity}] ${f.title}: ${f.detail}`)
          .join("\n")}`,
        `\nEXISTING INDEX SUGGESTIONS (heuristic):\n${
          analyzeResult.analysis.indexSuggestions.map((s) => s.ddl).join("\n") || "none"
        }`,
        `\nPLAN SUMMARY: total cost ${analyzeResult.analysis.summary.totalCost}, node types ${analyzeResult.analysis.summary.nodeTypes
          .map((n) => `${n.type} x${n.count}`)
          .join(", ")}`,
        `\nSCHEMA:\n${schemaText || "unavailable"}`,
        `\nRAW PLAN JSON (truncated):\n${JSON.stringify(analyzeResult.explain).slice(0, 6000)}`,
      ].join("\n"),
    })

    return NextResponse.json({ ai: object })
  } catch (err) {
    const message = err instanceof Error ? err.message : "AI analysis failed."
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

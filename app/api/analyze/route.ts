import { NextResponse } from "next/server"
import { runAnalyze } from "@/lib/runner"

export const runtime = "nodejs"
export const maxDuration = 60

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const sql: string = body?.sql ?? ""
    if (!sql.trim()) {
      return NextResponse.json({ error: "Provide a SQL query to analyze." }, { status: 400 })
    }

    const result = await runAnalyze(sql, {
      source: body?.source,
      connectionString: body?.connectionString,
    })

    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to analyze query."
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

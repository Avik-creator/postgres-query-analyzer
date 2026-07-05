import { NextResponse } from "next/server"
import { runBenchmark, type BenchmarkQuery } from "@/lib/runner"

export const runtime = "nodejs"
export const maxDuration = 60

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const queries: BenchmarkQuery[] = Array.isArray(body?.queries) ? body.queries : []
    const valid = queries.filter((q) => q?.sql?.trim())
    if (valid.length === 0) {
      return NextResponse.json({ error: "Provide at least one query to benchmark." }, { status: 400 })
    }

    const results = await runBenchmark(valid, {
      source: body?.source,
      connectionString: body?.connectionString,
    })

    return NextResponse.json({ results })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to run benchmark."
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

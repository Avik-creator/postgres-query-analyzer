import { NextResponse } from "next/server"
import { getSchema } from "@/lib/runner"

export const runtime = "nodejs"
export const maxDuration = 30

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const tables = await getSchema({
      source: body?.source,
      connectionString: body?.connectionString,
    })
    return NextResponse.json({ tables })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load schema."
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

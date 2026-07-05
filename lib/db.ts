import { Client } from "pg"

export type ConnectionSource = "demo" | "custom"

export interface ResolvedConnection {
  connectionString: string
  source: ConnectionSource
}

/**
 * Resolve the connection string to use for a request.
 * - "demo" uses the server-side DATABASE_URL (the seeded Neon demo database).
 * - "custom" uses a user-provided connection string.
 */
export function resolveConnection(
  source: ConnectionSource | undefined,
  customConnectionString?: string,
): ResolvedConnection {
  if (source === "custom") {
    const cs = (customConnectionString ?? "").trim()
    if (!cs) {
      throw new Error("A connection string is required when using a custom database.")
    }
    if (!/^postgres(ql)?:\/\//i.test(cs)) {
      throw new Error("Connection string must start with postgres:// or postgresql://")
    }
    return { connectionString: cs, source: "custom" }
  }

  const demo = process.env.DATABASE_URL
  if (!demo) {
    throw new Error("The demo database is not configured (DATABASE_URL missing).")
  }
  return { connectionString: demo, source: "demo" }
}

/**
 * Heuristic SSL configuration. Neon and most cloud providers require SSL,
 * while local databases usually do not support it.
 */
function sslConfig(connectionString: string) {
  const lower = connectionString.toLowerCase()
  if (lower.includes("sslmode=disable")) return false
  if (lower.includes("localhost") || lower.includes("127.0.0.1")) return false
  return { rejectUnauthorized: false }
}

/**
 * Create a short-lived pg Client, run the provided work, then always disconnect.
 */
export async function withClient<T>(
  connectionString: string,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({
    connectionString,
    ssl: sslConfig(connectionString),
    // Fail fast instead of hanging on unreachable hosts.
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
    query_timeout: 30_000,
  })

  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end().catch(() => {})
  }
}

export function friendlyDbError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  if (message.includes("ENOTFOUND") || message.includes("EAI_AGAIN")) {
    return "Could not resolve the database host. Check the connection string."
  }
  if (message.includes("ECONNREFUSED")) {
    return "Connection refused. Is the database reachable from the internet?"
  }
  if (message.includes("password authentication failed")) {
    return "Password authentication failed. Check your credentials."
  }
  if (message.includes("timeout") || message.includes("ETIMEDOUT")) {
    return "The database connection timed out."
  }
  if (message.includes("no pg_hba.conf") || message.includes("SSL")) {
    return "SSL negotiation failed. Try adding ?sslmode=require to your connection string."
  }
  return message
}

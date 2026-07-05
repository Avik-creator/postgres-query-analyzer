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

/** Human-friendly explanations for common Postgres SQLSTATE codes. */
const SQLSTATE_MESSAGES: Record<string, string> = {
  "42601": "Syntax error in your SQL. Double-check keywords, commas, and parentheses.",
  "42P01": "That table doesn't exist. Check the name (and schema) against the sidebar.",
  "42703": "That column doesn't exist. Check the spelling against the table's columns.",
  "42883": "That function or operator doesn't exist, or the argument types don't match.",
  "42P18": "The type of a parameter couldn't be determined. Try adding an explicit cast.",
  "22P02": "Invalid input value for its column type (for example, text where a number is expected).",
  "22003": "A numeric value is out of range for its column type.",
  "22012": "Division by zero.",
  "23505": "That value already exists in a unique column.",
  "23503": "This references a row that doesn't exist (foreign key violation).",
  "42501": "Permission denied. The database user can't read one of these tables.",
  "28P01": "Password authentication failed. Check your credentials.",
  "28000": "The database rejected this user. Check the username and permissions.",
  "3D000": "That database name doesn't exist on the server.",
  "53300": "Too many connections to the database right now. Try again shortly.",
  "57014": "The query took too long and was cancelled (30s limit).",
}

interface PgLikeError {
  message?: string
  code?: string
  hint?: string
  detail?: string
  position?: string
}

export function friendlyDbError(err: unknown): string {
  const e = (err ?? {}) as PgLikeError
  const message = err instanceof Error ? err.message : String(err)

  // Network / connection level problems come through as plain Error messages.
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
    return "The database connection timed out. Check the host and that it's reachable."
  }
  if (message.includes("no pg_hba.conf") || message.includes("SSL")) {
    return "SSL negotiation failed. Try adding ?sslmode=require to your connection string."
  }

  // Postgres query errors carry a SQLSTATE code and often a helpful hint/detail.
  const parts: string[] = []
  if (e.code && SQLSTATE_MESSAGES[e.code]) {
    parts.push(SQLSTATE_MESSAGES[e.code])
    if (message) parts.push(message.replace(/^error:\s*/i, ""))
  } else {
    parts.push(message.replace(/^error:\s*/i, ""))
  }
  if (e.hint) parts.push(`Hint: ${e.hint}`)
  else if (e.detail) parts.push(e.detail)

  return parts.filter(Boolean).join(" — ")
}

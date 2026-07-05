/**
 * Utilities to keep query analysis safe. EXPLAIN ANALYZE actually executes the
 * statement, so we only run it inside a READ ONLY transaction and we validate
 * that the statement is a single read-only command.
 */

const READ_PREFIXES = ["select", "with", "table", "values"]

export interface StatementCheck {
  ok: boolean
  isReadOnly: boolean
  reason?: string
  normalized: string
}

/**
 * Strip SQL comments and trailing semicolons for inspection.
 */
function stripComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ") // block comments
    .replace(/--[^\n]*/g, " ") // line comments
    .trim()
}

export function checkStatement(sqlRaw: string): StatementCheck {
  const sql = sqlRaw.trim()
  const cleaned = stripComments(sql).replace(/;+\s*$/g, "").trim()

  if (!cleaned) {
    return { ok: false, isReadOnly: false, reason: "The query is empty.", normalized: "" }
  }

  // Disallow multiple statements (basic guard against ; separated commands).
  if (cleaned.includes(";")) {
    return {
      ok: false,
      isReadOnly: false,
      reason: "Please analyze a single statement at a time (remove extra semicolons).",
      normalized: cleaned,
    }
  }

  const firstWord = cleaned.split(/\s+/)[0]?.toLowerCase() ?? ""
  const isReadOnly = READ_PREFIXES.includes(firstWord)

  return { ok: true, isReadOnly, normalized: cleaned }
}

/**
 * Build the EXPLAIN statement. For read-only queries we can safely ANALYZE
 * (execute) inside a read-only transaction. For anything else we fall back to a
 * plan-only EXPLAIN so we never mutate data.
 */
export function buildExplain(sql: string, analyze: boolean): string {
  // VERBOSE is enabled so the plan JSON includes each scan's "Schema", letting
  // us emit schema-qualified index DDL that both HypoPG validation and the user
  // can actually run (tables often live outside the search_path).
  const options = analyze
    ? "ANALYZE true, BUFFERS true, VERBOSE true, FORMAT JSON"
    : "VERBOSE true, FORMAT JSON"
  return `EXPLAIN (${options}) ${sql}`
}

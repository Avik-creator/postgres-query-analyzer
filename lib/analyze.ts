/**
 * Heuristic + cost-aware analysis of a PostgreSQL EXPLAIN (FORMAT JSON) plan.
 * These are shared types used by both the API and the UI.
 *
 * Design notes:
 * - Index suggestions are gated on selectivity (matched / scanned). When the
 *   statement was executed (EXPLAIN ANALYZE) this is measured; for write
 *   statements we fall back to a planner-estimated selectivity (Plan Rows /
 *   reltuples) and label it as an estimate.
 * - Accumulators are keyed by scan ALIAS, not relation name, so joins and
 *   self-joins attribute filter columns and sort keys to the correct relation
 *   instance. Sort-key qualifiers are preserved and resolved against the scans
 *   actually present under the Sort node.
 * - A filter's top-level OR is split into separate groups: `a = 1 OR b = 2`
 *   yields two single-column indexes (for a BitmapOr), never one bogus
 *   composite `(a, b)`.
 * - Suggestions produced here are marked `estimated: true`. They are only
 *   promoted to `verified` after HypoPG cost re-estimation in the runner.
 */

export interface PlanNode {
  "Node Type": string
  "Relation Name"?: string
  Schema?: string
  Alias?: string
  "Index Name"?: string
  "Startup Cost"?: number
  "Total Cost"?: number
  "Plan Rows"?: number
  "Plan Width"?: number
  "Actual Startup Time"?: number
  "Actual Total Time"?: number
  "Actual Rows"?: number
  "Actual Loops"?: number
  "Rows Removed by Filter"?: number
  "Filter"?: string
  "Index Cond"?: string
  "Recheck Cond"?: string
  "Hash Cond"?: string
  "Merge Cond"?: string
  "Join Type"?: string
  "Sort Key"?: string[]
  "Sort Method"?: string
  "Sort Space Used"?: number
  "Sort Space Type"?: string
  "Scan Direction"?: string
  "Parallel Aware"?: boolean
  "Workers Planned"?: number
  Plans?: PlanNode[]
  [key: string]: unknown
}

export interface ExplainResult {
  Plan: PlanNode
  "Planning Time"?: number
  "Execution Time"?: number
  [key: string]: unknown
}

export type Severity = "high" | "medium" | "low" | "info"

export interface Finding {
  id: string
  severity: Severity
  title: string
  detail: string
  nodeType: string
  relation?: string
  concept?: string
}

export interface IndexSuggestion {
  relation: string
  columns: string[]
  ddl: string
  rationale: string
  /** True when generated purely from plan heuristics (not yet cost-validated). */
  estimated: boolean
  /** Filter selectivity that motivated the suggestion (matched / scanned), 0..1. */
  matchRate?: number
  /** Whether matchRate was measured (ANALYZE) or planner-estimated (writes). */
  selectivitySource?: "measured" | "estimated"
  /** True when an existing index already leads with the same first column. */
  overlapsExisting?: boolean
  /** Set by HypoPG validation in the runner. */
  verified?: boolean
  baselineCost?: number
  hypotheticalCost?: number
  /** Percent cost reduction the planner estimates with this hypothetical index. */
  improvementPct?: number
}

export interface PlanSummary {
  totalCost: number
  planningTime?: number
  executionTime?: number
  nodeTypes: { type: string; count: number }[]
  concepts: string[]
  maxRowMisestimate?: number
  scannedRelations: string[]
}

export interface AnalysisResult {
  summary: PlanSummary
  findings: Finding[]
  indexSuggestions: IndexSuggestion[]
}

/** An index that already exists on a relation (from pg_indexes). */
export interface ExistingIndex {
  name: string
  columns: string[]
}

/**
 * Extra facts the runner can supply from the live database. All optional so the
 * analyzer still works from a plan alone (e.g. in tests).
 */
export interface AnalyzeContext {
  /** Whether the plan came from EXPLAIN ANALYZE (measured) vs plain EXPLAIN. */
  measured?: boolean
  /** relation name (bare and "schema.name") -> estimated row count (reltuples). */
  tableRows?: Record<string, number>
  /** relation name (bare and "schema.name") -> existing indexes. */
  existingIndexes?: Record<string, ExistingIndex[]>
}

/** Postgres node types mapped to the concepts they demonstrate. */
const CONCEPT_BY_NODE: Record<string, string> = {
  "Seq Scan": "Sequential Scan",
  "Index Scan": "Index Scan (B-tree)",
  "Index Only Scan": "Index-Only Scan",
  "Bitmap Heap Scan": "Bitmap Scan",
  "Bitmap Index Scan": "Bitmap Scan",
  "Hash Join": "Hash Join",
  "Merge Join": "Merge Join",
  "Nested Loop": "Nested Loop Join",
  Sort: "Sort",
  Aggregate: "Aggregation",
  Gather: "Parallel Query",
  "Gather Merge": "Parallel Query",
  Materialize: "Materialize",
  Hash: "Hash Build",
}

function walk(node: PlanNode, visit: (n: PlanNode, depth: number) => void, depth = 0) {
  visit(node, depth)
  for (const child of node.Plans ?? []) {
    walk(child, visit, depth + 1)
  }
}

/** A column referenced by a predicate, classified by how it can use an index. */
export interface PredicateColumn {
  column: string
  kind: "eq" | "range"
}

const NON_COLUMN =
  /^(text|int|int2|int4|int8|integer|smallint|numeric|bigint|real|double|float|timestamp|timestamptz|time|timetz|boolean|bool|date|json|jsonb|uuid|any|null|true|false)$/i

/** Remove one or more layers of fully-enclosing parentheses. */
function stripOuterParens(input: string): string {
  let s = input.trim()
  while (s.startsWith("(") && s.endsWith(")")) {
    let depth = 0
    let matched = true
    for (let i = 0; i < s.length; i++) {
      if (s[i] === "(") depth++
      else if (s[i] === ")") {
        depth--
        // Closing paren reaches 0 before the end => the outer parens don't wrap
        // the whole expression (e.g. "(a) OR (b)").
        if (depth === 0 && i < s.length - 1) {
          matched = false
          break
        }
      }
    }
    if (matched) s = s.slice(1, -1).trim()
    else break
  }
  return s
}

/** Split an expression on top-level (depth-0) OR, respecting parentheses. */
function splitTopLevelOr(expr: string): string[] {
  const parts: string[] = []
  const upper = expr.toUpperCase()
  let depth = 0
  let last = 0
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i]
    if (ch === "(") depth++
    else if (ch === ")") depth--
    else if (depth === 0 && upper.startsWith(" OR ", i)) {
      parts.push(expr.slice(last, i))
      i += 3
      last = i + 1
    }
  }
  parts.push(expr.slice(last))
  return parts.map((p) => p.trim()).filter(Boolean)
}

/**
 * Extract predicate columns from a single AND-conjunction expression,
 * classifying each as equality or range. Columns that cannot use a btree
 * usefully (`<>`, `!=`) are dropped. Equality wins over range for the same
 * column (it's the stronger leading key).
 */
export function extractPredicateColumns(expr?: string): PredicateColumn[] {
  if (!expr) return []
  const found = new Map<string, "eq" | "range">()
  const re =
    /([a-zA-Z_][a-zA-Z0-9_]*)\.?([a-zA-Z_][a-zA-Z0-9_]*)?\s*(=|>=|<=|<>|!=|>|<|~~\*?|~\*?|IN|=\s*ANY|BETWEEN)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(expr)) !== null) {
    const col = m[2] ?? m[1]
    if (!col || NON_COLUMN.test(col)) continue
    const opRaw = m[3].toUpperCase().replace(/\s+/g, " ")
    if (opRaw === "<>" || opRaw === "!=") continue
    const kind: "eq" | "range" = opRaw === "=" || opRaw === "IN" || opRaw === "= ANY" ? "eq" : "range"
    const prev = found.get(col)
    if (!prev || (prev === "range" && kind === "eq")) found.set(col, kind)
  }
  return [...found.entries()].map(([column, kind]) => ({ column, kind }))
}

/**
 * Split a filter into AND-conjunction groups. A filter with a top-level OR
 * produces one group per branch (each becomes its own index); a pure-AND filter
 * produces a single group. Returns `[]` when nothing indexable is found.
 */
export function extractPredicateGroups(expr?: string): PredicateColumn[][] {
  if (!expr) return []
  const stripped = stripOuterParens(expr)
  const branches = splitTopLevelOr(stripped)
  return branches.map((b) => extractPredicateColumns(b)).filter((g) => g.length > 0)
}

/** Backwards-compatible helper: just the column names from a predicate (flat). */
export function extractColumns(expr?: string): string[] {
  return extractPredicateColumns(expr).map((c) => c.column)
}

/** Parse a sort-key expression into an optional qualifier + column, or null. */
function parseSortKey(key: string): { qualifier?: string; column: string } | null {
  const base = key.replace(/\b(ASC|DESC|NULLS\s+(FIRST|LAST)|USING\s+\S+)\b/gi, "").trim()
  if (/[()]/.test(base)) return null // functional/expression key, not a plain column
  const m = base.match(/^(?:"?([a-zA-Z_][a-zA-Z0-9_]*)"?\.)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?$/)
  if (!m) return null
  return { qualifier: m[1], column: m[2] }
}

/** All scan nodes (nodes with a Relation Name) at or below `node`. */
function collectScans(node: PlanNode): PlanNode[] {
  const out: PlanNode[] = []
  walk(node, (n) => {
    if (n["Relation Name"]) out.push(n)
  })
  return out
}

/** The alias Postgres uses to qualify columns for a scan (defaults to relname). */
function scanAlias(node: PlanNode): string {
  return node["Alias"] ?? node["Relation Name"] ?? ""
}

/**
 * Order composite index columns for maximum usability:
 *   equality columns → sort keys (to satisfy ORDER BY) → range columns.
 * Range columns must come last because a btree can only range-scan on the final
 * key; equality columns first lets the index seek directly to the matching band.
 */
function orderComposite(eq: string[], sortKeys: string[], range: string[]): string[] {
  const ordered: string[] = []
  const push = (c: string) => {
    if (c && !ordered.includes(c)) ordered.push(c)
  }
  eq.forEach(push)
  sortKeys.forEach(push)
  range.forEach(push)
  return ordered
}

function qualified(schema: string | undefined, relation: string): string {
  return schema && schema !== "public" ? `${schema}.${relation}` : relation
}

// A filter is worth indexing only when it rejects most of what it scans.
const SELECTIVE_MATCH_RATE = 0.3
// Ignore tiny scans where a seq scan is always fine regardless of selectivity.
const MIN_SCANNED_ROWS = 500

/** One AND-group of predicate columns tied to a specific scan instance. */
interface FilterGroup {
  eq: string[]
  range: string[]
}

interface RelAccum {
  alias: string
  relation: string
  schema?: string
  /** Each group becomes one candidate index (multiple groups = OR predicate). */
  filterGroups: FilterGroup[]
  sortKeys: string[]
  matchRate?: number
  scanned?: number
  selectivitySource?: "measured" | "estimated"
  hasSelectiveFilter: boolean
  hasExpensiveSort: boolean
}

export function analyzePlan(explain: ExplainResult, ctx: AnalyzeContext = {}): AnalysisResult {
  const findings: Finding[] = []
  const nodeCounts = new Map<string, number>()
  const concepts = new Set<string>()
  const scannedRelations = new Set<string>()
  // Keyed by scan ALIAS so joins/self-joins stay separate.
  const rels = new Map<string, RelAccum>()
  let maxRowMisestimate: number | undefined
  let counter = 0

  const root = explain.Plan

  const getAccum = (alias: string, relation: string, schema?: string): RelAccum => {
    let a = rels.get(alias)
    if (!a) {
      a = {
        alias,
        relation,
        schema,
        filterGroups: [],
        sortKeys: [],
        hasSelectiveFilter: false,
        hasExpensiveSort: false,
      }
      rels.set(alias, a)
    }
    if (schema && !a.schema) a.schema = schema
    return a
  }

  // Look up a per-relation fact by qualified name first, then bare name.
  const lookupRows = (schema: string | undefined, relation: string): number | undefined => {
    const t = ctx.tableRows
    if (!t) return undefined
    return t[qualified(schema, relation)] ?? t[`${schema}.${relation}`] ?? t[relation]
  }
  const lookupIndexes = (schema: string | undefined, relation: string): ExistingIndex[] => {
    const e = ctx.existingIndexes
    if (!e) return []
    return e[qualified(schema, relation)] ?? e[`${schema}.${relation}`] ?? e[relation] ?? []
  }

  walk(root, (node) => {
    const type = node["Node Type"]
    nodeCounts.set(type, (nodeCounts.get(type) ?? 0) + 1)
    if (CONCEPT_BY_NODE[type]) concepts.add(CONCEPT_BY_NODE[type])

    const relation = node["Relation Name"]
    if (relation) scannedRelations.add(relation)

    const planRows = node["Plan Rows"]
    const actualRows = node["Actual Rows"]
    const loops = node["Actual Loops"] ?? 1

    // Row estimation accuracy (only meaningful with ANALYZE).
    if (typeof planRows === "number" && typeof actualRows === "number") {
      const actualTotal = actualRows * loops
      const larger = Math.max(planRows, actualTotal)
      const smaller = Math.max(1, Math.min(planRows, actualTotal))
      const ratio = larger / smaller
      if (actualTotal > 100 && ratio > 10) {
        maxRowMisestimate = Math.max(maxRowMisestimate ?? 0, ratio)
        findings.push({
          id: `mis-${counter++}`,
          severity: ratio > 100 ? "high" : "medium",
          title: `Row estimate off by ${Math.round(ratio)}x on ${type}`,
          detail: `Planner expected ${planRows.toLocaleString()} rows but got ${actualTotal.toLocaleString()}. Stale statistics can lead to poor plan choices. Run ANALYZE${relation ? ` ${relation}` : ""} to refresh statistics.`,
          nodeType: type,
          relation,
          concept: "Statistics / ANALYZE",
        })
      }
    }

    // Sequential scans: decide with selectivity (measured, or planner-estimated
    // for write statements that weren't executed).
    if (type === "Seq Scan" && relation) {
      const removed = node["Rows Removed by Filter"] ?? 0
      const cost = node["Total Cost"] ?? 0
      const groups = extractPredicateGroups(node["Filter"])
      const indexable = groups.length > 0

      // Measured selectivity (EXPLAIN ANALYZE) when we have actual rows...
      let matchRate: number | undefined
      let scanned: number | undefined
      let source: "measured" | "estimated" | undefined
      if (typeof actualRows === "number") {
        const matched = actualRows * loops
        scanned = matched + removed * loops
        matchRate = scanned > 0 ? matched / scanned : undefined
        source = "measured"
      } else if (typeof planRows === "number") {
        // ...otherwise estimate from Plan Rows / table size (writes, plain EXPLAIN).
        const total = lookupRows(node.Schema, relation)
        if (total && total > 0) {
          scanned = total
          matchRate = Math.min(1, planRows / total)
          source = "estimated"
        }
      }

      const bigEnough = scanned === undefined ? cost > 1000 : scanned >= MIN_SCANNED_ROWS
      const selective = matchRate !== undefined && matchRate <= SELECTIVE_MATCH_RATE

      if (indexable && bigEnough && selective) {
        const accum = getAccum(scanAlias(node), relation, node.Schema)
        for (const g of groups) {
          accum.filterGroups.push({
            eq: g.filter((p) => p.kind === "eq").map((p) => p.column),
            range: g.filter((p) => p.kind === "range").map((p) => p.column),
          })
        }
        accum.hasSelectiveFilter = true
        accum.matchRate = matchRate
        accum.scanned = scanned
        accum.selectivitySource = source

        const cols = groups.flatMap((g) => g.map((p) => p.column))
        const pct = (matchRate! * 100).toFixed(matchRate! < 0.1 ? 1 : 0)
        const measuredWord = source === "measured" ? "matched" : "is estimated to match"
        const estNote = source === "estimated" ? " (planner-estimated, since the statement was not executed)" : ""
        findings.push({
          id: `seq-${counter++}`,
          severity: matchRate! <= 0.05 ? "high" : "medium",
          title: `Selective filter scanned all of ${relation}`,
          detail: `The filter on ${cols.join(", ")} ${measuredWord} only ${pct}% of the ${scanned!.toLocaleString()} rows read${estNote}. An index can seek straight to those rows instead of reading the whole table.`,
          nodeType: type,
          relation,
          concept: "Indexes",
        })
      } else if (indexable && bigEnough && matchRate !== undefined && !selective) {
        // High match rate: an index would likely be ignored by the planner.
        const cols = groups.flatMap((g) => g.map((p) => p.column))
        findings.push({
          id: `seq-${counter++}`,
          severity: "low",
          title: `Full scan on ${relation} (most rows match)`,
          detail: `${(matchRate * 100).toFixed(0)}% of the ${scanned!.toLocaleString()} scanned rows match the filter on ${cols.join(", ")}, so Postgres reads the table sequentially. An index here would probably be ignored — a sequential scan is the right choice when most rows are needed.`,
          nodeType: type,
          relation,
          concept: "Sequential Scan",
        })
      } else if (cost > 1000) {
        findings.push({
          id: `seq-${counter++}`,
          severity: "low",
          title: `Sequential scan on ${relation}`,
          detail: `Postgres reads the entire ${relation} table. This is fine when most rows are needed, but watch it as the table grows.`,
          nodeType: type,
          relation,
          concept: "Sequential Scan",
        })
      }
    }

    // Sorts: attach each sort key to the RELATION IT BELONGS TO (resolved via
    // its qualifier) so a composite index can also satisfy the ORDER BY.
    if (type === "Sort") {
      const method = node["Sort Method"]
      const external = method?.toLowerCase().includes("external")
      const spaceKB = node["Sort Space Used"] ?? 0
      const rawKeys = node["Sort Key"] ?? []
      const parsed = rawKeys.map(parseSortKey).filter((k): k is { qualifier?: string; column: string } => !!k)

      const scans = collectScans(node)
      const byAlias = new Map(scans.map((s) => [scanAlias(s), s]))
      const resolvedAccums = new Set<RelAccum>()
      let allResolved = parsed.length > 0

      for (const { qualifier, column } of parsed) {
        let target: PlanNode | undefined
        if (qualifier) target = byAlias.get(qualifier)
        else if (scans.length === 1) target = scans[0] // unambiguous single-table sort
        if (!target) {
          allResolved = false
          continue
        }
        const accum = getAccum(scanAlias(target), target["Relation Name"]!, target.Schema)
        if (!accum.sortKeys.includes(column)) accum.sortKeys.push(column)
        resolvedAccums.add(accum)
      }

      // A sort-only index only makes sense if every key maps to ONE relation.
      if ((external || spaceKB > 4096) && allResolved && resolvedAccums.size === 1) {
        ;[...resolvedAccums][0].hasExpensiveSort = true
      }

      const keyText = parsed.map((p) => p.column).join(", ") || rawKeys.join(", ")
      findings.push({
        id: `sort-${counter++}`,
        severity: external ? "high" : "low",
        title: external ? "Disk-based (external) sort" : "In-memory sort",
        detail: external
          ? `The sort spilled to disk (${method}). Increase work_mem, or add an index matching the sort order (${keyText}) so Postgres can skip sorting entirely.`
          : `Rows are sorted in memory (${method ?? "quicksort"}). An index on ${keyText || "the ORDER BY columns"} could let Postgres return rows already ordered.`,
        nodeType: type,
        concept: "Sort",
      })
    }

    // Nested loops: gate on the actual cost of re-scanning, not a raw loop count.
    if (type === "Nested Loop") {
      const inner = node.Plans?.[1]
      if (inner && inner["Node Type"] === "Seq Scan") {
        const innerLoops = inner["Actual Loops"] ?? 1
        const innerPerLoopMs = inner["Actual Total Time"] ?? 0 // per-loop average
        const innerTotalMs = innerPerLoopMs * innerLoops
        const innerCost = inner["Total Cost"] ?? 0
        const expensive = innerLoops > 1 && (innerTotalMs > 10 || innerCost * innerLoops > 10000)
        if (expensive) {
          const groups = extractPredicateGroups(inner["Filter"])
          const rel = inner["Relation Name"]
          findings.push({
            id: `nl-${counter++}`,
            severity: "high",
            title: `Nested loop re-scans ${rel ?? "inner table"} ${innerLoops.toLocaleString()} times`,
            detail: `The inner side uses a sequential scan executed once per outer row (~${innerTotalMs.toFixed(
              0,
            )}ms total). An index on the join column turns this into a fast per-row lookup.`,
            nodeType: type,
            relation: rel,
            concept: "Nested Loop Join",
          })
          if (rel && groups.length > 0) {
            const accum = getAccum(scanAlias(inner), rel, inner.Schema)
            for (const g of groups) {
              accum.filterGroups.push({
                eq: g.filter((p) => p.kind === "eq").map((p) => p.column),
                range: g.filter((p) => p.kind === "range").map((p) => p.column),
              })
            }
            accum.hasSelectiveFilter = true // join lookup is inherently selective
            accum.selectivitySource = accum.selectivitySource ?? "measured"
          }
        }
      }
    }

    if (type === "Bitmap Heap Scan" && relation) {
      concepts.add("Bitmap Scan")
    }
  })

  // Build index suggestions from the merged per-alias info.
  const suggestionMap = new Map<string, IndexSuggestion>()

  const consider = (
    a: RelAccum,
    columns: string[],
    rationale: string,
    matchRate?: number,
    source?: "measured" | "estimated",
  ) => {
    if (!columns.length) return
    const existing = lookupIndexes(a.schema, a.relation)

    // Redundant: an existing index already covers these columns as a prefix.
    const covering = existing.find((ix) => arrayStartsWith(ix.columns, columns))
    if (covering) {
      findings.push({
        id: `idx-exists-${counter++}`,
        severity: "low",
        title: `Index already covers these columns on ${a.relation}`,
        detail: `An index (${covering.name}) already exists on (${covering.columns.join(
          ", ",
        )}), yet the planner chose a sequential scan — the filter may not be selective enough to use it, or statistics may be stale. Creating another index would not help.`,
        nodeType: "Seq Scan",
        relation: a.relation,
        concept: "Indexes",
      })
      return
    }

    // Partial overlap: an existing index leads with the same first column.
    const overlap = existing.find((ix) => ix.columns[0] === columns[0])
    let finalRationale = rationale
    if (overlap) {
      finalRationale += ` Note: index ${overlap.name} on (${overlap.columns.join(
        ", ",
      )}) already leads with "${columns[0]}" — consider extending it instead of adding an overlapping index.`
    }

    const ddl = `CREATE INDEX ON ${qualified(a.schema, a.relation)} (${columns.join(", ")});`
    if (!suggestionMap.has(ddl)) {
      suggestionMap.set(ddl, {
        relation: a.relation,
        columns,
        ddl,
        rationale: finalRationale,
        estimated: true,
        matchRate,
        selectivitySource: source,
        overlapsExisting: !!overlap,
      })
    }
  }

  for (const a of rels.values()) {
    if (a.hasSelectiveFilter && a.filterGroups.length > 0) {
      if (a.filterGroups.length === 1) {
        // Pure AND (or single-branch) filter: one composite index that can also
        // satisfy the ORDER BY.
        const g = a.filterGroups[0]
        const columns = orderComposite(g.eq, a.sortKeys, g.range)
        const parts: string[] = []
        if (g.eq.length) parts.push(`filters on ${g.eq.join(", ")}`)
        if (g.range.length) parts.push(`range on ${g.range.join(", ")}`)
        if (a.sortKeys.length) parts.push(`ORDER BY ${a.sortKeys.join(", ")}`)
        const noun = columns.length > 1 ? "Composite index" : "Index"
        let rationale = `${noun} covering ${parts.join(" + ")}. Equality columns are ordered first so the index can seek directly to the matching band.`
        if (a.sortKeys.length) {
          rationale += " The sort key follows so Postgres can also skip the ORDER BY sort."
        }
        consider(a, columns, rationale, a.matchRate, a.selectivitySource)
      } else {
        // Top-level OR: one index per branch so Postgres can combine them with a
        // BitmapOr. Sort keys are NOT folded in (the sort happens after the OR).
        for (const g of a.filterGroups) {
          const columns = orderComposite(g.eq, [], g.range)
          const rationale = `Part of an OR predicate. Separate single-purpose indexes on each branch let Postgres combine them with a BitmapOr instead of scanning the whole table; one composite index cannot serve an OR.`
          consider(a, columns, rationale, a.matchRate, a.selectivitySource)
        }
      }
    } else if (a.hasExpensiveSort && a.sortKeys.length) {
      const columns = orderComposite([], a.sortKeys, [])
      const rationale = `An index on the ORDER BY columns (${a.sortKeys.join(
        ", ",
      )}) lets Postgres return rows in order and avoid the expensive sort.`
      consider(a, columns, rationale)
    }
  }

  if (findings.length === 0) {
    findings.push({
      id: "ok",
      severity: "info",
      title: "No obvious bottlenecks detected",
      detail:
        "The planner is using indexes and efficient join strategies for this query. As data grows, re-run the analysis to catch regressions.",
      nodeType: root["Node Type"],
      concept: "Healthy plan",
    })
  }

  const nodeTypes = [...nodeCounts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count)

  const summary: PlanSummary = {
    totalCost: root["Total Cost"] ?? 0,
    planningTime: explain["Planning Time"],
    executionTime: explain["Execution Time"],
    nodeTypes,
    concepts: [...concepts],
    maxRowMisestimate,
    scannedRelations: [...scannedRelations],
  }

  return {
    summary,
    findings: sortBySeverity(findings),
    indexSuggestions: [...suggestionMap.values()],
  }
}

/** True when `arr` begins with every element of `prefix`, in order. */
function arrayStartsWith(arr: string[], prefix: string[]): boolean {
  if (prefix.length > arr.length) return false
  return prefix.every((c, i) => arr[i] === c)
}

const SEVERITY_ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2, info: 3 }

function sortBySeverity(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
}

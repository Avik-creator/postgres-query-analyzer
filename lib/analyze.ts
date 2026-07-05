/**
 * Heuristic + cost-aware analysis of a PostgreSQL EXPLAIN (FORMAT JSON) plan.
 * These are shared types used by both the API and the UI.
 *
 * Design notes:
 * - Index suggestions are gated on real selectivity (matched / scanned), not an
 *   absolute removed-row count.
 * - Filter columns and sort keys on the SAME relation are merged into a single
 *   composite suggestion, with equality columns ordered before range columns and
 *   sort keys placed so the index can also satisfy the ORDER BY.
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

/**
 * Extract predicate columns from a filter / condition expression, classifying
 * each as an equality or range comparison. Columns that cannot use a btree
 * index usefully (e.g. `<>`) are dropped. When a column appears with both an
 * equality and a range operator, equality wins (it's the stronger index key).
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
    // Not usefully indexable with a plain btree.
    if (opRaw === "<>" || opRaw === "!=") continue
    const kind: "eq" | "range" = opRaw === "=" || opRaw === "IN" || opRaw === "= ANY" ? "eq" : "range"
    const prev = found.get(col)
    if (!prev || (prev === "range" && kind === "eq")) found.set(col, kind)
  }
  return [...found.entries()].map(([column, kind]) => ({ column, kind }))
}

/** Backwards-compatible helper: just the column names from a predicate. */
export function extractColumns(expr?: string): string[] {
  return extractPredicateColumns(expr).map((c) => c.column)
}

/** Strip a sort-key expression down to a bare column name, or null if it's an expression. */
function cleanSortKey(key: string): string | null {
  const base = key.replace(/\b(ASC|DESC|NULLS\s+(FIRST|LAST)|USING\s+\S+)\b/gi, "").trim()
  if (/[()]/.test(base)) return null // functional/expression key, not a plain column
  const col = base.replace(/^[a-zA-Z0-9_]+\./, "").trim().replace(/^"|"$/g, "")
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(col) ? col : null
}

/** Find the relation of the nearest scan descendant (used to attach Sort keys). */
function firstScanRelation(node: PlanNode): { relation: string; schema?: string } | undefined {
  if (node["Relation Name"]) return { relation: node["Relation Name"], schema: node.Schema }
  for (const child of node.Plans ?? []) {
    const found = firstScanRelation(child)
    if (found) return found
  }
  return undefined
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

interface RelAccum {
  relation: string
  schema?: string
  eqCols: string[]
  rangeCols: string[]
  sortKeys: string[]
  matchRate?: number
  scanned?: number
  hasSelectiveFilter: boolean
  hasExpensiveSort: boolean
}

export function analyzePlan(explain: ExplainResult): AnalysisResult {
  const findings: Finding[] = []
  const nodeCounts = new Map<string, number>()
  const concepts = new Set<string>()
  const scannedRelations = new Set<string>()
  const rels = new Map<string, RelAccum>()
  let maxRowMisestimate: number | undefined
  let counter = 0

  const root = explain.Plan

  const getAccum = (relation: string, schema?: string): RelAccum => {
    let a = rels.get(relation)
    if (!a) {
      a = {
        relation,
        schema,
        eqCols: [],
        rangeCols: [],
        sortKeys: [],
        hasSelectiveFilter: false,
        hasExpensiveSort: false,
      }
      rels.set(relation, a)
    }
    if (schema && !a.schema) a.schema = schema
    return a
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

    // Sequential scans: decide with real selectivity, not an absolute row count.
    if (type === "Seq Scan" && relation) {
      const removed = node["Rows Removed by Filter"] ?? 0
      const matched = typeof actualRows === "number" ? actualRows : undefined
      const cost = node["Total Cost"] ?? 0
      const preds = extractPredicateColumns(node["Filter"])
      const eqCols = preds.filter((p) => p.kind === "eq").map((p) => p.column)
      const rangeCols = preds.filter((p) => p.kind === "range").map((p) => p.column)

      // Selectivity = fraction of scanned rows that survived the filter.
      const scanned = matched !== undefined ? matched + removed : undefined
      const matchRate = scanned && scanned > 0 ? matched! / scanned : undefined

      const accum = getAccum(relation, node.Schema)
      for (const c of eqCols) if (!accum.eqCols.includes(c)) accum.eqCols.push(c)
      for (const c of rangeCols) if (!accum.rangeCols.includes(c)) accum.rangeCols.push(c)

      const indexable = eqCols.length + rangeCols.length > 0
      const bigEnough = scanned === undefined ? cost > 1000 : scanned >= MIN_SCANNED_ROWS
      const selective = matchRate !== undefined && matchRate <= SELECTIVE_MATCH_RATE

      if (indexable && bigEnough && selective) {
        accum.hasSelectiveFilter = true
        accum.matchRate = matchRate
        accum.scanned = scanned
        const pct = (matchRate! * 100).toFixed(matchRate! < 0.1 ? 1 : 0)
        findings.push({
          id: `seq-${counter++}`,
          severity: matchRate! <= 0.05 ? "high" : "medium",
          title: `Selective filter scanned all of ${relation}`,
          detail: `The filter on ${[...eqCols, ...rangeCols].join(", ")} matched only ${pct}% of the ${scanned!.toLocaleString()} rows read. An index can seek straight to those rows instead of reading the whole table.`,
          nodeType: type,
          relation,
          concept: "Indexes",
        })
      } else if (indexable && bigEnough && matchRate !== undefined && !selective) {
        // High match rate: an index would likely be ignored by the planner.
        findings.push({
          id: `seq-${counter++}`,
          severity: "low",
          title: `Full scan on ${relation} (most rows match)`,
          detail: `${(matchRate * 100).toFixed(0)}% of the ${scanned!.toLocaleString()} scanned rows matched the filter, so Postgres reads the table sequentially. An index here would probably be ignored — a sequential scan is the right choice when most rows are needed.`,
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

    // Sorts: attach sort keys to the relation being sorted so we can build a
    // composite index that also satisfies the ORDER BY.
    if (type === "Sort") {
      const method = node["Sort Method"]
      const external = method?.toLowerCase().includes("external")
      const spaceKB = node["Sort Space Used"] ?? 0
      const rawKeys = node["Sort Key"] ?? []
      const cleanKeys = rawKeys.map(cleanSortKey).filter((k): k is string => !!k)
      const scanRel = firstScanRelation(node)

      if (scanRel && cleanKeys.length) {
        const accum = getAccum(scanRel.relation, scanRel.schema)
        for (const k of cleanKeys) if (!accum.sortKeys.includes(k)) accum.sortKeys.push(k)
        if (external || spaceKB > 4096) accum.hasExpensiveSort = true
      }

      findings.push({
        id: `sort-${counter++}`,
        severity: external ? "high" : "low",
        title: external ? "Disk-based (external) sort" : "In-memory sort",
        detail: external
          ? `The sort spilled to disk (${method}). Increase work_mem, or add an index matching the sort order (${cleanKeys.join(", ") || rawKeys.join(", ")}) so Postgres can skip sorting entirely.`
          : `Rows are sorted in memory (${method ?? "quicksort"}). An index on ${cleanKeys.join(", ") || "the ORDER BY columns"} could let Postgres return rows already ordered.`,
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
          const preds = extractPredicateColumns(inner["Filter"])
          const eqCols = preds.filter((p) => p.kind === "eq").map((p) => p.column)
          const rangeCols = preds.filter((p) => p.kind === "range").map((p) => p.column)
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
          if (rel && eqCols.length + rangeCols.length > 0) {
            const accum = getAccum(rel, inner.Schema)
            for (const c of eqCols) if (!accum.eqCols.includes(c)) accum.eqCols.push(c)
            for (const c of rangeCols) if (!accum.rangeCols.includes(c)) accum.rangeCols.push(c)
            accum.hasSelectiveFilter = true // join lookup is inherently selective
          }
        }
      }
    }

    if (type === "Bitmap Heap Scan" && relation) {
      concepts.add("Bitmap Scan")
    }
  })

  // Build composite index suggestions from the merged per-relation info.
  const suggestionMap = new Map<string, IndexSuggestion>()
  for (const a of rels.values()) {
    let columns: string[] = []
    let rationale = ""
    let matchRate: number | undefined

    if (a.hasSelectiveFilter && a.eqCols.length + a.rangeCols.length > 0) {
      columns = orderComposite(a.eqCols, a.sortKeys, a.rangeCols)
      matchRate = a.matchRate
      const parts: string[] = []
      if (a.eqCols.length) parts.push(`filters on ${a.eqCols.join(", ")}`)
      if (a.rangeCols.length) parts.push(`range on ${a.rangeCols.join(", ")}`)
      if (a.sortKeys.length) parts.push(`ORDER BY ${a.sortKeys.join(", ")}`)
      rationale = `Composite index covering ${parts.join(" + ")}. Equality columns are ordered first so the index can seek directly, and the sort key is included so Postgres can also skip the sort.`
    } else if (a.hasExpensiveSort && a.sortKeys.length) {
      columns = orderComposite([], a.sortKeys, [])
      rationale = `An index on the ORDER BY columns (${a.sortKeys.join(
        ", ",
      )}) lets Postgres return rows in order and avoid the expensive sort.`
    }

    if (columns.length) {
      const ddl = `CREATE INDEX ON ${qualified(a.schema, a.relation)} (${columns.join(", ")});`
      if (!suggestionMap.has(ddl)) {
        suggestionMap.set(ddl, {
          relation: a.relation,
          columns,
          ddl,
          rationale,
          estimated: true,
          matchRate,
        })
      }
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

const SEVERITY_ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2, info: 3 }

function sortBySeverity(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
}

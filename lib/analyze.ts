/**
 * Heuristic analysis of a PostgreSQL EXPLAIN (FORMAT JSON) plan.
 * These are shared types used by both the API and the UI.
 */

export interface PlanNode {
  "Node Type": string
  "Relation Name"?: string
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
  "Gather": "Parallel Query",
  "Gather Merge": "Parallel Query",
  "Materialize": "Materialize",
  "Hash": "Hash Build",
}

function walk(node: PlanNode, visit: (n: PlanNode, depth: number) => void, depth = 0) {
  visit(node, depth)
  for (const child of node.Plans ?? []) {
    walk(child, visit, depth + 1)
  }
}

/**
 * Extract candidate column names from a filter / condition expression.
 * e.g. "(status = 'pending'::text)" -> ["status"]
 */
export function extractColumns(expr?: string): string[] {
  if (!expr) return []
  const cols = new Set<string>()
  // Match identifiers (optionally qualified) before a comparison operator.
  const re = /([a-zA-Z_][a-zA-Z0-9_]*)\.?([a-zA-Z_][a-zA-Z0-9_]*)?\s*(=|>=|<=|<>|!=|>|<|~~|~~\*|IN|ANY|BETWEEN)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(expr)) !== null) {
    const col = m[2] ?? m[1]
    // Ignore obvious literals / casts / keywords.
    if (!col || /^(text|int|integer|numeric|bigint|timestamp|timestamptz|boolean|date|any)$/i.test(col)) continue
    cols.add(col)
  }
  return [...cols]
}

const LARGE_ROWS = 5000
const LARGE_REMOVED = 1000

export function analyzePlan(explain: ExplainResult): AnalysisResult {
  const findings: Finding[] = []
  const suggestionMap = new Map<string, IndexSuggestion>()
  const nodeCounts = new Map<string, number>()
  const concepts = new Set<string>()
  const scannedRelations = new Set<string>()
  let maxRowMisestimate: number | undefined
  let counter = 0

  const root = explain.Plan

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

    // Sequential scans with a filter on large tables.
    if (type === "Seq Scan") {
      const removed = node["Rows Removed by Filter"] ?? 0
      const cost = node["Total Cost"] ?? 0
      const filterCols = extractColumns(node["Filter"])
      const isSelective = removed > LARGE_REMOVED
      if ((isSelective || cost > 1000) && filterCols.length > 0 && relation) {
        findings.push({
          id: `seq-${counter++}`,
          severity: isSelective ? "high" : "medium",
          title: `Sequential scan on ${relation}`,
          detail: `A full table scan filtered out ${removed.toLocaleString()} rows. An index on ${filterCols.join(", ")} would let Postgres jump straight to matching rows instead of reading the whole table.`,
          nodeType: type,
          relation,
          concept: "Indexes",
        })
        const key = `${relation}(${filterCols.join(",")})`
        if (!suggestionMap.has(key)) {
          suggestionMap.set(key, {
            relation,
            columns: filterCols,
            ddl: `CREATE INDEX ON ${relation} (${filterCols.join(", ")});`,
            rationale: `Speeds up the WHERE filter on ${filterCols.join(", ")} currently handled by a sequential scan.`,
          })
        }
      } else if (cost > 1000 && relation) {
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

    // Expensive sorts, especially external (disk) sorts.
    if (type === "Sort") {
      const method = node["Sort Method"]
      const external = method?.toLowerCase().includes("external")
      const sortKeys = (node["Sort Key"] ?? []).map((k) => k.replace(/^[a-zA-Z0-9_]+\./, ""))
      findings.push({
        id: `sort-${counter++}`,
        severity: external ? "high" : "low",
        title: external ? "Disk-based (external) sort" : "In-memory sort",
        detail: external
          ? `The sort spilled to disk (${method}). Increase work_mem or add an index matching the sort order (${sortKeys.join(", ")}) to avoid sorting entirely.`
          : `Rows are sorted in memory (${method ?? "quicksort"}). An index on ${sortKeys.join(", ") || "the ORDER BY columns"} could let Postgres skip the sort.`,
        nodeType: type,
        concept: "Sort",
      })
    }

    // Nested loops that execute the inner side many times without an index.
    if (type === "Nested Loop") {
      const inner = node.Plans?.[1]
      if (inner && inner["Node Type"] === "Seq Scan" && (inner["Actual Loops"] ?? 1) > 50) {
        const cols = extractColumns(inner["Filter"])
        const rel = inner["Relation Name"]
        findings.push({
          id: `nl-${counter++}`,
          severity: "high",
          title: `Nested loop re-scans ${rel ?? "inner table"} ${inner["Actual Loops"]?.toLocaleString()} times`,
          detail: `The inner side of the join uses a sequential scan executed once per outer row. An index on the join column would turn this into a fast index lookup.`,
          nodeType: type,
          relation: rel,
          concept: "Nested Loop Join",
        })
        if (rel && cols.length) {
          const key = `${rel}(${cols.join(",")})`
          if (!suggestionMap.has(key)) {
            suggestionMap.set(key, {
              relation: rel,
              columns: cols,
              ddl: `CREATE INDEX ON ${rel} (${cols.join(", ")});`,
              rationale: `Removes the repeated sequential scan on the inner side of a nested-loop join.`,
            })
          }
        }
      }
    }

    // Bitmap heap scans with lossy recheck / large heap blocks (info level).
    if (type === "Bitmap Heap Scan" && relation) {
      concepts.add("Bitmap Scan")
    }
  })

  if (findings.length === 0) {
    findings.push({
      id: "ok",
      severity: "info",
      title: "No obvious bottlenecks detected",
      detail: "The planner is using indexes and efficient join strategies for this query. As data grows, re-run the analysis to catch regressions.",
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

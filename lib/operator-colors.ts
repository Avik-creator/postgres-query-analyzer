// Consistent color-coding for Postgres plan operators, grouped by category.
// After a few plans, users start recognizing operator types by color alone.
// NOTE: class strings are written out in full so Tailwind's JIT can detect them.

export type OperatorCategory =
  | "scan"
  | "join"
  | "sort"
  | "aggregate"
  | "combine"
  | "modify"
  | "other"

export interface CategoryStyle {
  label: string
  /** foreground text color */
  text: string
  /** subtle background tint */
  bg: string
  /** border tint */
  border: string
  /** solid dot / bar color */
  dot: string
}

export const CATEGORY_STYLE: Record<OperatorCategory, CategoryStyle> = {
  scan: { label: "Scan", text: "text-chart-4", bg: "bg-chart-4/15", border: "border-chart-4/40", dot: "bg-chart-4" },
  join: { label: "Join", text: "text-chart-3", bg: "bg-chart-3/15", border: "border-chart-3/40", dot: "bg-chart-3" },
  sort: { label: "Sort", text: "text-chart-5", bg: "bg-chart-5/15", border: "border-chart-5/40", dot: "bg-chart-5" },
  aggregate: {
    label: "Aggregate",
    text: "text-chart-2",
    bg: "bg-chart-2/15",
    border: "border-chart-2/40",
    dot: "bg-chart-2",
  },
  combine: {
    label: "Combine",
    text: "text-primary",
    bg: "bg-primary/15",
    border: "border-primary/40",
    dot: "bg-primary",
  },
  modify: {
    label: "Modify",
    text: "text-destructive",
    bg: "bg-destructive/15",
    border: "border-destructive/40",
    dot: "bg-destructive",
  },
  other: {
    label: "Other",
    text: "text-muted-foreground",
    bg: "bg-muted",
    border: "border-border",
    dot: "bg-muted-foreground",
  },
}

const NODE_CATEGORY: Record<string, OperatorCategory> = {
  // scans (blue)
  "Seq Scan": "scan",
  "Index Scan": "scan",
  "Index Only Scan": "scan",
  "Bitmap Heap Scan": "scan",
  "Bitmap Index Scan": "scan",
  "Tid Scan": "scan",
  "Sample Scan": "scan",
  "Subquery Scan": "scan",
  "Function Scan": "scan",
  "Table Function Scan": "scan",
  "CTE Scan": "scan",
  "Named Tuplestore Scan": "scan",
  "WorkTable Scan": "scan",
  "Foreign Scan": "scan",
  // joins (pink)
  "Nested Loop": "join",
  "Hash Join": "join",
  "Merge Join": "join",
  // sort / staging (amber)
  Sort: "sort",
  "Incremental Sort": "sort",
  Materialize: "sort",
  Memoize: "sort",
  // aggregation / grouping (green)
  Aggregate: "aggregate",
  HashAggregate: "aggregate",
  GroupAggregate: "aggregate",
  Group: "aggregate",
  WindowAgg: "aggregate",
  Hash: "aggregate",
  Unique: "aggregate",
  // combine / control (primary)
  Limit: "combine",
  Gather: "combine",
  "Gather Merge": "combine",
  Append: "combine",
  "Merge Append": "combine",
  Result: "combine",
  SetOp: "combine",
  "Recursive Union": "combine",
  // data modification (red)
  ModifyTable: "modify",
  Insert: "modify",
  Update: "modify",
  Delete: "modify",
}

export function operatorCategory(nodeType: string): OperatorCategory {
  return NODE_CATEGORY[nodeType] ?? "other"
}

export function operatorStyle(nodeType: string): CategoryStyle {
  return CATEGORY_STYLE[operatorCategory(nodeType)]
}

/** The categories worth showing in a legend (skips the generic "other"). */
export const LEGEND_CATEGORIES: OperatorCategory[] = ["scan", "join", "sort", "aggregate", "combine"]

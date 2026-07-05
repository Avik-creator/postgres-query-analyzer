// Plain-language explanations of Postgres EXPLAIN / planner concepts.
// Used by tooltips throughout the analyzer and by the "Learn" reference dialog.

export type GlossaryEntry = {
  term: string
  short: string // one-liner shown in tooltips
  long?: string // extra detail shown in the reference dialog
}

export const METRIC_GLOSSARY: Record<string, GlossaryEntry> = {
  cost: {
    term: "Cost",
    short:
      "The planner's estimate of how expensive a step is, in arbitrary units — not milliseconds. Lower is cheaper.",
    long: "Cost is an abstract number the planner uses to compare plans. It is calibrated so that reading one sequential page from disk costs 1.0. It is shown as start-up cost..total cost. The start-up cost is the work before the first row can be returned (e.g. building a hash table or sorting); the total cost is the work to return all rows. Cost is an estimate, so it can be wrong if the table statistics are stale.",
  },
  startupCost: {
    term: "Start-up cost",
    short: "Estimated work done before the first row can be produced (e.g. sorting or building a hash table).",
  },
  totalCost: {
    term: "Total cost",
    short: "Estimated work to return every row of this step, including its children.",
  },
  planRows: {
    term: "Estimated rows",
    short: "How many rows the planner expects this step to produce. Drives which plan it chooses.",
    long: "The planner estimates row counts from table statistics collected by ANALYZE. If the estimate is far off from the actual count, the planner may pick a bad strategy (for example a Nested Loop when a Hash Join would be far faster).",
  },
  actualRows: {
    term: "Actual rows",
    short: "How many rows this step really produced when the query ran (only shown with EXPLAIN ANALYZE).",
  },
  rowMisestimate: {
    term: "Row mis-estimate",
    short:
      "How far the planner's row estimate was from reality (e.g. 50x). Big gaps mean stale statistics and often bad plans.",
    long: "When estimated and actual rows differ by a large factor, the planner made decisions on bad information. Fix it by running ANALYZE on the table, increasing the statistics target on skewed columns, or adding an index that gives the planner a better cardinality signal.",
  },
  loops: {
    term: "Loops",
    short:
      "How many times this step was executed. Times shown are per-loop averages — multiply by loops for the real total.",
    long: "In a Nested Loop join the inner side runs once per outer row, so loops can be very large. A step that looks fast per-loop can dominate runtime once multiplied by thousands of loops.",
  },
  actualTime: {
    term: "Actual time",
    short:
      "Real wall-clock time for this step, as first-row..last-row in ms, per loop (only with EXPLAIN ANALYZE).",
  },
  selfTime: {
    term: "Self time",
    short: "Time spent in this node alone, excluding its children — this is where the query actually spends time.",
    long: "Total node time minus the time of its child nodes. Sorting the plan by self time points you straight at the real bottleneck, rather than a parent node that just aggregates its children's time.",
  },
  width: {
    term: "Width",
    short: "Estimated average size in bytes of each row this step emits. Wider rows mean more memory and I/O.",
  },
  planningTime: {
    term: "Planning time",
    short: "Time Postgres spent choosing a plan before running the query. Usually tiny.",
    long: "If planning time is unusually high it can indicate a very complex query (many joins) or a bloated system catalog. It is separate from execution time.",
  },
  executionTime: {
    term: "Execution time",
    short: "Time Postgres spent actually running the chosen plan and returning rows. This is the number to optimize.",
  },
  buffers: {
    term: "Buffers",
    short:
      "How many 8KB pages were read from cache (hit) vs disk (read). Lots of reads means the data wasn't cached.",
    long: "shared hit = pages found in Postgres's cache; shared read = pages fetched from disk. High reads often explain slow first runs; a warm cache turns reads into hits on repeat runs.",
  },
}

export const NODE_GLOSSARY: Record<string, GlossaryEntry> = {
  "Seq Scan": {
    term: "Sequential Scan",
    short: "Reads every row in the table one by one. Fine for small tables, slow when filtering large ones.",
    long: "A Seq Scan ignores indexes and walks the whole table. It's the right choice when a query returns most of a table, but a red flag when you filter down to a few rows from a large table — that usually calls for an index.",
  },
  "Index Scan": {
    term: "Index Scan",
    short: "Uses an index to jump to matching rows, then fetches them from the table. Great for selective filters.",
    long: "The index quickly finds matching row locations, then Postgres reads those rows from the heap. Efficient when a small fraction of rows match. If almost all rows match, a Seq Scan can actually be faster.",
  },
  "Index Only Scan": {
    term: "Index Only Scan",
    short: "Answers the query entirely from the index without touching the table. The fastest common access method.",
    long: "Possible when every column the query needs is present in the index (a covering index). Avoids reading the table heap entirely, so it's very fast.",
  },
  "Bitmap Heap Scan": {
    term: "Bitmap Heap Scan",
    short: "Collects matching row locations from an index into a bitmap, then reads the table in physical order.",
    long: "Used when an index matches a medium number of rows — too many for a plain Index Scan but too few for a Seq Scan. Reading pages in physical order reduces random I/O.",
  },
  "Bitmap Index Scan": {
    term: "Bitmap Index Scan",
    short: "Builds a bitmap of matching rows from an index, feeding a Bitmap Heap Scan above it.",
  },
  "Nested Loop": {
    term: "Nested Loop Join",
    short: "For each row on one side, looks up matches on the other. Fast for small inputs, slow when both are large.",
    long: "Great when the outer side is small and the inner side is indexed. Becomes a performance trap when row estimates are wrong and it loops millions of times — often a sign of a missing index or stale statistics.",
  },
  "Hash Join": {
    term: "Hash Join",
    short: "Builds a hash table of one side, then probes it with the other. Excellent for joining large tables.",
    long: "Has a start-up cost (building the hash table) but then matches rows very quickly. Preferred for large, unsorted inputs. Needs enough work_mem or it spills to disk in batches.",
  },
  "Merge Join": {
    term: "Merge Join",
    short: "Joins two inputs that are both sorted on the join key by walking them together.",
    long: "Efficient when inputs are already sorted (for example from an index) or when the result needs to be sorted anyway. Otherwise the required sorts can be expensive.",
  },
  Sort: {
    term: "Sort",
    short: "Orders rows (for ORDER BY, DISTINCT, merge joins, etc.). Watch for disk-based sorts on large sets.",
    long: "If the data fits in work_mem the sort is in-memory (quicksort); otherwise it spills to disk (external merge), which is much slower. An index on the sort column can let Postgres skip the sort entirely.",
  },
  Aggregate: {
    term: "Aggregate",
    short: "Computes aggregates like COUNT, SUM, AVG or GROUP BY over its input rows.",
  },
  HashAggregate: {
    term: "Hash Aggregate",
    short: "Groups rows using a hash table for GROUP BY / DISTINCT. Fast but memory-hungry on many groups.",
  },
  GroupAggregate: {
    term: "Group Aggregate",
    short: "Aggregates over already-sorted input, one group at a time. Pairs with a preceding Sort or index.",
  },
  Limit: {
    term: "Limit",
    short: "Stops after N rows. Can make a plan much cheaper if the planner can avoid producing all rows.",
  },
  Materialize: {
    term: "Materialize",
    short: "Caches a child's rows in memory so they can be re-read cheaply, often inside a Nested Loop.",
  },
  Gather: {
    term: "Gather",
    short: "Collects rows produced by parallel worker processes back into a single stream.",
  },
}

export function lookupNode(nodeType: string): GlossaryEntry | undefined {
  return NODE_GLOSSARY[nodeType]
}

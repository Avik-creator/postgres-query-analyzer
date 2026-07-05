// Helpers for turning a raw EXPLAIN plan tree into the numbers the UI needs:
// self-time, buffers, memory, parallel workers, and SQL highlight tokens.

import { extractColumns, type PlanNode } from "./analyze"

export function nodeTotalTime(node: PlanNode): number {
  return (node["Actual Total Time"] ?? 0) * (node["Actual Loops"] ?? 1)
}

/** Time spent in this node alone = total minus the time of its children. */
export function nodeSelfTime(node: PlanNode): number {
  const children = node.Plans ?? []
  const childTime = children.reduce((sum, c) => sum + nodeTotalTime(c), 0)
  return Math.max(0, nodeTotalTime(node) - childTime)
}

export function nodeActualRows(node: PlanNode): number | undefined {
  return node["Actual Rows"] !== undefined
    ? node["Actual Rows"] * (node["Actual Loops"] ?? 1)
    : undefined
}

export interface FlatNode {
  node: PlanNode
  depth: number
  /** stable path id, e.g. "0", "0.1", "0.1.0" */
  path: string
  selfTime: number
}

/** Depth-first flatten with stable path ids and precomputed self time. */
export function flattenPlan(root: PlanNode): FlatNode[] {
  const out: FlatNode[] = []
  const walk = (node: PlanNode, depth: number, path: string) => {
    out.push({ node, depth, path, selfTime: nodeSelfTime(node) })
    ;(node.Plans ?? []).forEach((child, i) => walk(child, depth + 1, `${path}.${i}`))
  }
  walk(root, 0, "0")
  return out
}

// ---- Buffers (8KB pages) --------------------------------------------------

export interface BufferStats {
  sharedHit: number
  sharedRead: number
  tempRead: number
  tempWritten: number
  hasAny: boolean
}

function num(node: PlanNode, key: string): number {
  const v = node[key]
  return typeof v === "number" ? v : 0
}

export function nodeBuffers(node: PlanNode): BufferStats {
  const sharedHit = num(node, "Shared Hit Blocks")
  const sharedRead = num(node, "Shared Read Blocks")
  const tempRead = num(node, "Temp Read Blocks")
  const tempWritten = num(node, "Temp Written Blocks")
  return {
    sharedHit,
    sharedRead,
    tempRead,
    tempWritten,
    hasAny: sharedHit + sharedRead + tempRead + tempWritten > 0,
  }
}

/** 8KB pages -> human string (KB / MB). */
export function fmtPages(pages: number): string {
  const kb = pages * 8
  if (kb >= 1024) return `${(kb / 1024).toFixed(1)} MB`
  return `${kb} KB`
}

/** Cache hit ratio 0..1 for a set of buffers. */
export function hitRatio(b: BufferStats): number | undefined {
  const total = b.sharedHit + b.sharedRead
  if (total === 0) return undefined
  return b.sharedHit / total
}

// ---- Memory (sort / hash) -------------------------------------------------

export interface MemoryStats {
  label: string
  /** kilobytes */
  kb: number
  spilledToDisk: boolean
  detail: string
}

export function nodeMemory(node: PlanNode): MemoryStats | undefined {
  const type = node["Node Type"]
  if (type === "Sort" || type === "Incremental Sort") {
    const kb = num(node, "Sort Space Used")
    if (kb <= 0) return undefined
    const method = (node["Sort Method"] as string | undefined) ?? "quicksort"
    const spaceType = (node["Sort Space Type"] as string | undefined) ?? "Memory"
    const spilledToDisk = /disk|external/i.test(`${method} ${spaceType}`)
    return { label: "sort space", kb, spilledToDisk, detail: method }
  }
  // Hash / HashAggregate report peak memory usage.
  const peak = num(node, "Peak Memory Usage")
  if (peak > 0) {
    const batches = num(node, "Hash Batches")
    const spilledToDisk = batches > 1
    return {
      label: "peak memory",
      kb: peak,
      spilledToDisk,
      detail: batches > 1 ? `${batches} batches (spilled)` : "single batch",
    }
  }
  return undefined
}

export function fmtKb(kb: number): string {
  if (kb >= 1024) return `${(kb / 1024).toFixed(1)} MB`
  return `${kb} KB`
}

// ---- Parallel workers -----------------------------------------------------

export interface WorkerStats {
  planned: number
  launched: number
}

export function nodeWorkers(node: PlanNode): WorkerStats | undefined {
  const planned = num(node, "Workers Planned")
  const launched = num(node, "Workers Launched")
  if (planned === 0 && launched === 0) return undefined
  return { planned, launched }
}

// ---- SQL highlight tokens -------------------------------------------------

const STRIP_PREFIX = /^[a-zA-Z0-9_]+\./

/**
 * Tokens (column / table names) from a node that we can highlight inside the
 * user's SQL so selecting a plan node lights up the clause responsible for it.
 */
export function highlightTokensForNode(node: PlanNode): string[] {
  const tokens = new Set<string>()

  const addCols = (expr?: string) => {
    for (const c of extractColumns(expr)) tokens.add(c)
  }
  addCols(node["Filter"])
  addCols(node["Index Cond"])
  addCols(node["Recheck Cond"])
  addCols(node["Hash Cond"])
  addCols(node["Merge Cond"])
  addCols(node["Join Filter"] as string | undefined)

  for (const key of node["Sort Key"] ?? []) {
    tokens.add(key.replace(STRIP_PREFIX, "").replace(/\s+(asc|desc)$/i, "").trim())
  }

  const relation = node["Relation Name"]
  if (relation) tokens.add(relation)
  const alias = node["Alias"]
  if (alias && alias !== relation) tokens.add(alias)

  return [...tokens].filter((t) => t && t.length > 1)
}

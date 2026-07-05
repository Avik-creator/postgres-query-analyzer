"use client"

import { cn } from "@/lib/utils"
import { InfoHint } from "./info-hint"
import { operatorStyle } from "@/lib/operator-colors"
import { flattenPlan, type FlatNode } from "@/lib/plan-utils"
import type { PlanNode } from "@/lib/analyze"

function fmtMs(n: number) {
  if (n >= 1000) return `${(n / 1000).toFixed(2)}s`
  return `${n.toFixed(n < 10 ? 2 : 1)}ms`
}

/**
 * "Where time goes" — the top nodes ranked by self time with proportional bars,
 * so bottlenecks are obvious at a glance. Rows are clickable to select the node.
 */
export function TimeBreakdown({
  root,
  totalTime,
  selectedPath,
  onSelect,
}: {
  root: PlanNode
  totalTime: number
  selectedPath?: string
  onSelect?: (node: PlanNode, path: string) => void
}) {
  if (!totalTime || totalTime <= 0) return null

  const rows: FlatNode[] = flattenPlan(root)
    .filter((f) => f.selfTime > 0)
    .sort((a, b) => b.selfTime - a.selfTime)
    .slice(0, 6)

  if (rows.length === 0) return null

  const max = rows[0].selfTime

  return (
    <div className="mb-3 rounded-lg border border-border bg-card/40 p-3">
      <div className="mb-2.5 flex items-center gap-1.5">
        <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Where time goes</h4>
        <InfoHint>
          The plan steps that consumed the most <strong>self time</strong> (time in the node itself, excluding
          its children). These are your bottlenecks — optimize the top rows first.
        </InfoHint>
      </div>
      <ul className="space-y-1.5">
        {rows.map((r) => {
          const type = r.node["Node Type"]
          const style = operatorStyle(type)
          const pct = (r.selfTime / totalTime) * 100
          const relation = r.node["Relation Name"]
          const selected = selectedPath === r.path
          return (
            <li key={r.path}>
              <button
                type="button"
                onClick={() => onSelect?.(r.node, r.path)}
                className={cn(
                  "group flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-secondary/60",
                  selected && "bg-secondary ring-1 ring-primary/40",
                )}
              >
                <span className="flex w-40 shrink-0 items-center gap-2 sm:w-52">
                  <span className={cn("size-2 shrink-0 rounded-full", style.dot)} />
                  <span className={cn("truncate font-mono text-xs font-medium", style.text)}>{type}</span>
                  {relation && (
                    <span className="truncate font-mono text-[11px] text-muted-foreground">{relation}</span>
                  )}
                </span>
                <span className="relative h-2 flex-1 overflow-hidden rounded-full bg-secondary">
                  <span
                    className={cn("absolute inset-y-0 left-0 rounded-full", style.dot)}
                    style={{ width: `${Math.max(2, (r.selfTime / max) * 100)}%` }}
                  />
                </span>
                <span className="flex w-24 shrink-0 items-center justify-end gap-1.5 font-mono text-xs tabular-nums">
                  <span className="text-foreground">{fmtMs(r.selfTime)}</span>
                  <span className={cn("w-9 text-right", pct >= 40 ? "text-warning" : "text-muted-foreground")}>
                    {pct.toFixed(0)}%
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

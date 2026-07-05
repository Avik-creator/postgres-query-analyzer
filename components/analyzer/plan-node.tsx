"use client"

import { useState } from "react"
import { ChevronRight, AlertTriangle } from "lucide-react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { InfoHint, TermHint } from "./info-hint"
import { lookupNode, METRIC_GLOSSARY } from "@/lib/glossary"
import type { PlanNode as PlanNodeType } from "@/lib/analyze"

function fmtRows(n: number | undefined) {
  if (n === undefined) return "—"
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function fmtMs(n: number | undefined) {
  if (n === undefined) return undefined
  if (n >= 1000) return `${(n / 1000).toFixed(2)}s`
  return `${n.toFixed(2)}ms`
}

const NODE_COLORS: Record<string, string> = {
  "Seq Scan": "text-warning",
  "Index Scan": "text-success",
  "Index Only Scan": "text-success",
  "Bitmap Heap Scan": "text-chart-5",
  "Hash Join": "text-primary",
  "Nested Loop": "text-primary",
  "Merge Join": "text-primary",
  Sort: "text-chart-3",
  Aggregate: "text-chart-3",
}

export function PlanNode({
  node,
  depth = 0,
  totalTime,
}: {
  node: PlanNodeType
  depth?: number
  totalTime: number
}) {
  const [open, setOpen] = useState(true)
  const children = node.Plans ?? []
  const hasChildren = children.length > 0
  const nodeType = node["Node Type"]

  // self time = this node's total time (x loops) minus children total time.
  const nodeTotal = (node["Actual Total Time"] ?? 0) * (node["Actual Loops"] ?? 1)
  const childTime = children.reduce(
    (sum, c) => sum + (c["Actual Total Time"] ?? 0) * (c["Actual Loops"] ?? 1),
    0,
  )
  const selfTime = Math.max(0, nodeTotal - childTime)
  const selfPct = totalTime > 0 ? (selfTime / totalTime) * 100 : 0

  const estRows = node["Plan Rows"]
  const actRows =
    node["Actual Rows"] !== undefined ? node["Actual Rows"] * (node["Actual Loops"] ?? 1) : undefined
  const misestimated =
    estRows !== undefined &&
    actRows !== undefined &&
    actRows > 100 &&
    (actRows > estRows * 10 || estRows > actRows * 10)

  const nodeColor = NODE_COLORS[nodeType] ?? "text-foreground"
  const relation = node["Relation Name"]
  const indexName = node["Index Name"]
  const nodeInfo = lookupNode(nodeType)

  return (
    <div className="text-sm">
      <div
        className="group flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-secondary/60"
        style={{ marginLeft: depth * 16 }}
      >
        <button
          type="button"
          onClick={() => hasChildren && setOpen((o) => !o)}
          className={cn(
            "mt-0.5 shrink-0 rounded p-0.5 text-muted-foreground transition-transform",
            hasChildren ? "hover:text-foreground" : "invisible",
            open && "rotate-90",
          )}
          aria-label={open ? "Collapse node" : "Expand node"}
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {nodeInfo ? (
              <TermHint
                hint={
                  <span>
                    <strong>{nodeInfo.term}.</strong> {nodeInfo.short}
                  </span>
                }
              >
                <span className={cn("font-mono font-medium", nodeColor)}>{nodeType}</span>
              </TermHint>
            ) : (
              <span className={cn("font-mono font-medium", nodeColor)}>{nodeType}</span>
            )}
            {relation && (
              <span className="font-mono text-xs text-muted-foreground">
                on {relation}
                {indexName ? ` using ${indexName}` : ""}
              </span>
            )}
            {misestimated && (
              <Badge variant="outline" className="gap-1 border-warning/40 text-warning">
                <AlertTriangle className="h-3 w-3" />
                bad estimate
              </Badge>
            )}
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs text-muted-foreground">
            <span>
              rows est <span className="text-foreground">{fmtRows(estRows)}</span>
              {actRows !== undefined && (
                <>
                  {" / act "}
                  <span className={cn(misestimated ? "text-warning" : "text-foreground")}>
                    {fmtRows(actRows)}
                  </span>
                </>
              )}
            </span>
            {(node["Actual Loops"] ?? 1) > 1 && <span>loops {fmtRows(node["Actual Loops"])}</span>}
            {fmtMs(selfTime) && totalTime > 0 && (
              <span>
                self <span className="text-foreground">{fmtMs(selfTime)}</span>
              </span>
            )}
            <span className="text-foreground/50">cost {node["Total Cost"]?.toFixed(0) ?? "—"}</span>
          </div>

          {totalTime > 0 && selfTime > 0 && (
            <div className="mt-1 h-1 w-full max-w-[220px] overflow-hidden rounded-full bg-secondary">
              <div
                className={cn("h-full rounded-full", selfPct > 40 ? "bg-warning" : "bg-primary")}
                style={{ width: `${Math.min(100, selfPct)}%` }}
              />
            </div>
          )}
        </div>
      </div>

      {open &&
        hasChildren &&
        children.map((child, i) => <PlanNode key={i} node={child} depth={depth + 1} totalTime={totalTime} />)}
    </div>
  )
}

export function PlanLegend() {
  const items: Array<{ label: string; key: keyof typeof METRIC_GLOSSARY }> = [
    { label: "rows est / act", key: "planRows" },
    { label: "loops", key: "loops" },
    { label: "self", key: "selfTime" },
    { label: "cost", key: "cost" },
  ]
  return (
    <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-md border border-border bg-card/40 px-3 py-2 font-mono text-[11px] text-muted-foreground">
      <span className="flex items-center gap-1 font-sans text-foreground">
        Legend
        <InfoHint>
          Each node shows these numbers. Hover a node&apos;s name to learn what that operation does, or open{" "}
          <strong>Learn</strong> in the header for the full guide.
        </InfoHint>
      </span>
      {items.map((it) => (
        <span key={it.key} className="flex items-center gap-1">
          {it.label}
          <InfoHint>{METRIC_GLOSSARY[it.key].short}</InfoHint>
        </span>
      ))}
    </div>
  )
}

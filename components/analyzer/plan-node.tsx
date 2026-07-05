"use client"

import { useState } from "react"
import { ChevronRight, AlertTriangle, HardDrive, MemoryStick, Users } from "lucide-react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { InfoHint, TermHint } from "./info-hint"
import { lookupNode, METRIC_GLOSSARY } from "@/lib/glossary"
import { operatorStyle, LEGEND_CATEGORIES, CATEGORY_STYLE } from "@/lib/operator-colors"
import {
  nodeSelfTime,
  nodeActualRows,
  nodeBuffers,
  nodeMemory,
  nodeWorkers,
  hitRatio,
  fmtPages,
  fmtKb,
} from "@/lib/plan-utils"
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

export function PlanNode({
  node,
  depth = 0,
  totalTime,
  path = "0",
  selectedPath,
  onSelect,
}: {
  node: PlanNodeType
  depth?: number
  totalTime: number
  path?: string
  selectedPath?: string
  onSelect?: (node: PlanNodeType, path: string) => void
}) {
  const [open, setOpen] = useState(true)
  const children = node.Plans ?? []
  const hasChildren = children.length > 0
  const nodeType = node["Node Type"]

  const selfTime = nodeSelfTime(node)
  const selfPct = totalTime > 0 ? (selfTime / totalTime) * 100 : 0

  const estRows = node["Plan Rows"]
  const actRows = nodeActualRows(node)
  const misestimated =
    estRows !== undefined &&
    actRows !== undefined &&
    actRows > 100 &&
    (actRows > estRows * 10 || estRows > actRows * 10)

  const style = operatorStyle(nodeType)
  const relation = node["Relation Name"]
  const indexName = node["Index Name"]
  const nodeInfo = lookupNode(nodeType)

  const buffers = nodeBuffers(node)
  const memory = nodeMemory(node)
  const workers = nodeWorkers(node)
  const ratio = hitRatio(buffers)
  const selected = selectedPath === path
  const isBottleneck = selfPct >= 40

  return (
    <div className="text-sm">
      <div
        className={cn(
          "group flex items-start gap-2 rounded-md px-2 py-1.5 transition-colors",
          selected ? "bg-secondary ring-1 ring-primary/40" : "hover:bg-secondary/60",
        )}
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

        <button
          type="button"
          onClick={() => onSelect?.(node, path)}
          className="min-w-0 flex-1 text-left"
          aria-pressed={selected}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn("size-2 shrink-0 rounded-full", style.dot)} aria-hidden />
            {nodeInfo ? (
              <TermHint
                hint={
                  <span>
                    <strong>{nodeInfo.term}.</strong> {nodeInfo.short}
                  </span>
                }
              >
                <span className={cn("font-mono font-medium", style.text)}>{nodeType}</span>
              </TermHint>
            ) : (
              <span className={cn("font-mono font-medium", style.text)}>{nodeType}</span>
            )}
            {relation && (
              <span className="font-mono text-xs text-muted-foreground">
                on {relation}
                {indexName ? ` using ${indexName}` : ""}
              </span>
            )}
            {isBottleneck && totalTime > 0 && (
              <Badge variant="outline" className="gap-1 border-warning/40 text-warning">
                bottleneck
              </Badge>
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
                  <span className={cn(misestimated ? "text-warning" : "text-foreground")}>{fmtRows(actRows)}</span>
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

          {/* Self-time bar with an inline percentage so bottlenecks pop. */}
          {totalTime > 0 && selfTime > 0 && (
            <div className="mt-1.5 flex items-center gap-2">
              <div className="h-1.5 w-full max-w-[260px] overflow-hidden rounded-full bg-secondary">
                <div
                  className={cn("h-full rounded-full", isBottleneck ? "bg-warning" : style.dot)}
                  style={{ width: `${Math.min(100, Math.max(2, selfPct))}%` }}
                />
              </div>
              <span
                className={cn(
                  "shrink-0 font-mono text-[11px] tabular-nums",
                  isBottleneck ? "text-warning" : "text-muted-foreground",
                )}
              >
                {selfPct.toFixed(0)}%
              </span>
            </div>
          )}

          {/* Buffers / memory / workers detail row. */}
          {(buffers.hasAny || memory || workers) && (
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-muted-foreground">
              {buffers.hasAny && (
                <span className="inline-flex items-center gap-1">
                  <HardDrive className="h-3 w-3 shrink-0" />
                  {buffers.sharedHit > 0 && (
                    <span>
                      hit <span className="text-success">{fmtPages(buffers.sharedHit)}</span>
                    </span>
                  )}
                  {buffers.sharedRead > 0 && (
                    <span>
                      read <span className="text-warning">{fmtPages(buffers.sharedRead)}</span>
                    </span>
                  )}
                  {ratio !== undefined && buffers.sharedRead > 0 && (
                    <span className="text-foreground/50">({(ratio * 100).toFixed(0)}% cached)</span>
                  )}
                  {(buffers.tempRead > 0 || buffers.tempWritten > 0) && (
                    <span className="text-destructive">temp {fmtPages(buffers.tempRead + buffers.tempWritten)}</span>
                  )}
                </span>
              )}
              {memory && (
                <span className={cn("inline-flex items-center gap-1", memory.spilledToDisk && "text-destructive")}>
                  <MemoryStick className="h-3 w-3 shrink-0" />
                  {memory.label} <span className="text-foreground">{fmtKb(memory.kb)}</span>
                  {memory.spilledToDisk && <span>· spilled to disk</span>}
                </span>
              )}
              {workers && (
                <span className="inline-flex items-center gap-1">
                  <Users className="h-3 w-3 shrink-0" />
                  {workers.launched}/{workers.planned} workers
                </span>
              )}
            </div>
          )}
        </button>
      </div>

      {open &&
        hasChildren &&
        children.map((child, i) => (
          <PlanNode
            key={i}
            node={child}
            depth={depth + 1}
            totalTime={totalTime}
            path={`${path}.${i}`}
            selectedPath={selectedPath}
            onSelect={onSelect}
          />
        ))}
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
    <div className="mb-2 flex flex-col gap-2 rounded-md border border-border bg-card/40 px-3 py-2">
      {/* Operator color key */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px]">
        <span className="flex items-center gap-1 font-sans text-foreground">
          Operators
          <InfoHint>
            Operators are colored by category so patterns are easy to spot. Click any node to highlight the part
            of your SQL it comes from.
          </InfoHint>
        </span>
        {LEGEND_CATEGORIES.map((cat) => (
          <span key={cat} className="flex items-center gap-1.5 text-muted-foreground">
            <span className={cn("size-2 rounded-full", CATEGORY_STYLE[cat].dot)} />
            {CATEGORY_STYLE[cat].label}
          </span>
        ))}
      </div>
      {/* Metric key */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-border/60 pt-2 font-mono text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1 font-sans text-foreground">Metrics</span>
        {items.map((it) => (
          <span key={it.key} className="flex items-center gap-1">
            {it.label}
            <InfoHint>{METRIC_GLOSSARY[it.key].short}</InfoHint>
          </span>
        ))}
      </div>
    </div>
  )
}

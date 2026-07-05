"use client"

import { Gauge, Loader2, TrendingDown, TrendingUp, AlertCircle } from "lucide-react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { BenchmarkResult } from "@/lib/types"

function fmtMs(n: number | undefined) {
  if (n === undefined) return "—"
  if (n >= 1000) return `${(n / 1000).toFixed(2)}s`
  return `${n.toFixed(2)}ms`
}

export function BenchmarkPanel({
  results,
  loading,
  canRun,
  onRun,
}: {
  results: BenchmarkResult[]
  loading: boolean
  canRun: boolean
  onRun: () => void
}) {
  const successful = results.filter((r) => r.ok && r.executionTime !== undefined)
  const maxTime = Math.max(...successful.map((r) => r.executionTime ?? 0), 1)
  const baseline = successful[0]?.executionTime

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground text-pretty">
          Runs each query with EXPLAIN (ANALYZE) three times and reports the median execution time. Read-only queries
          only.
        </p>
        <Button size="sm" className="shrink-0 gap-2" onClick={onRun} disabled={loading || !canRun}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Gauge className="h-4 w-4" />}
          Run benchmark
        </Button>
      </div>

      {results.length === 0 && !loading && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-12 text-center">
          <Gauge className="h-8 w-8 text-muted-foreground" />
          <p className="mt-3 max-w-xs text-pretty text-sm text-muted-foreground">
            Run a benchmark to compare the execution time of your query against the AI-optimized rewrite.
          </p>
        </div>
      )}

      <div className="space-y-3">
        {results.map((r, i) => {
          const pct = r.executionTime ? (r.executionTime / maxTime) * 100 : 0
          const delta =
            baseline && r.executionTime !== undefined && i > 0
              ? ((r.executionTime - baseline) / baseline) * 100
              : undefined
          return (
            <div key={i} className="rounded-lg border border-border bg-card/50 p-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{r.label}</span>
                  {i === 0 && (
                    <Badge variant="secondary" className="text-[10px]">
                      baseline
                    </Badge>
                  )}
                </div>
                {r.ok ? (
                  <span className="font-mono text-sm font-semibold text-foreground">{fmtMs(r.executionTime)}</span>
                ) : (
                  <Badge variant="outline" className="gap-1 text-destructive">
                    <AlertCircle className="h-3 w-3" />
                    failed
                  </Badge>
                )}
              </div>

              {r.ok ? (
                <>
                  <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-secondary">
                    <div
                      className={cn("h-full rounded-full", i === 0 ? "bg-primary" : "bg-success")}
                      style={{ width: `${Math.max(2, pct)}%` }}
                    />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs text-muted-foreground">
                    <span>planning {fmtMs(r.planningTime)}</span>
                    <span>cost {r.totalCost?.toFixed(0) ?? "—"}</span>
                    {r.runs && <span>runs {r.runs.map((x) => x.toFixed(1)).join(" / ")}</span>}
                    {delta !== undefined && (
                      <span
                        className={cn(
                          "flex items-center gap-1 font-medium",
                          delta < 0 ? "text-success" : "text-warning",
                        )}
                      >
                        {delta < 0 ? <TrendingDown className="h-3 w-3" /> : <TrendingUp className="h-3 w-3" />}
                        {delta > 0 ? "+" : ""}
                        {delta.toFixed(0)}% vs baseline
                      </span>
                    )}
                  </div>
                </>
              ) : (
                <p className="mt-1.5 text-xs leading-relaxed text-destructive/90">{r.error}</p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

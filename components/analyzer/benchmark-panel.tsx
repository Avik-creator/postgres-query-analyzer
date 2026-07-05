"use client"

import { Gauge, Loader2, TrendingDown, TrendingUp, AlertCircle, Minus, Trophy, Timer } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { InfoHint } from "./info-hint"
import type { BenchmarkResult } from "@/lib/types"

function fmtMs(n: number | undefined) {
  if (n === undefined) return "—"
  if (n >= 1000) return `${(n / 1000).toFixed(2)}s`
  if (n < 1) return `${n.toFixed(2)}ms`
  return `${n.toFixed(1)}ms`
}

function Stat({
  label,
  value,
  hint,
  accent,
}: {
  label: string
  value: string
  hint?: string
  accent?: "success" | "warning" | "default"
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
        {hint && <InfoHint side="top">{hint}</InfoHint>}
      </span>
      <span
        className={cn(
          "font-mono text-sm font-semibold tabular-nums",
          accent === "success" && "text-success",
          accent === "warning" && "text-warning",
          (!accent || accent === "default") && "text-foreground",
        )}
      >
        {value}
      </span>
    </div>
  )
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
  const maxTime = Math.max(...successful.map((r) => r.executionTime ?? 0), 0.001)
  const baseline = successful[0]?.executionTime
  const isComparison = successful.length > 1
  const fastest = successful.length
    ? successful.reduce((a, b) => ((a.executionTime ?? Infinity) <= (b.executionTime ?? Infinity) ? a : b))
    : undefined

  // Verdict when comparing baseline vs an alternative (e.g. AI rewrite).
  let verdict: { pct: number; faster: boolean; label: string } | null = null
  if (isComparison && baseline && successful[1]?.executionTime !== undefined) {
    const alt = successful[1].executionTime
    const pct = ((alt - baseline) / baseline) * 100
    verdict = { pct: Math.abs(pct), faster: pct < 0, label: successful[1].label }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-md">
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-medium text-foreground">Benchmark</p>
            <InfoHint side="right">
              Each query is executed three times with EXPLAIN (ANALYZE) and the middle (median) time is reported, so a
              single slow outlier won&apos;t skew the result. Only read-only queries are run.
            </InfoHint>
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground text-pretty">
            Measure real execution time. Generate an AI rewrite first to compare the two head-to-head.
          </p>
        </div>
        <Button size="sm" className="shrink-0 gap-2" onClick={onRun} disabled={loading || !canRun}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Gauge className="h-4 w-4" />}
          {results.length > 0 ? "Re-run" : "Run benchmark"}
        </Button>
      </div>

      {/* Empty state */}
      {results.length === 0 && !loading && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-12 text-center">
          <div className="flex size-11 items-center justify-center rounded-lg bg-secondary">
            <Timer className="h-5 w-5 text-muted-foreground" />
          </div>
          <p className="mt-3 text-sm font-medium text-foreground">No benchmark yet</p>
          <p className="mt-1 max-w-xs text-pretty text-sm text-muted-foreground">
            Run a benchmark to get a stable median execution time. If you&apos;ve generated an AI rewrite, both run so
            you can see which is faster.
          </p>
        </div>
      )}

      {/* Loading state */}
      {loading && results.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-border bg-card/50 py-12 text-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          <p className="mt-3 text-sm text-muted-foreground">Running each query three times…</p>
        </div>
      )}

      {/* Verdict */}
      {verdict && (
        <div
          className={cn(
            "flex items-center gap-3 rounded-lg border p-4",
            verdict.faster ? "border-success/40 bg-success/10" : "border-warning/40 bg-warning/10",
          )}
        >
          <div
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-md",
              verdict.faster ? "bg-success/15 text-success" : "bg-warning/15 text-warning",
            )}
          >
            {verdict.faster ? <TrendingDown className="size-5" /> : <TrendingUp className="size-5" />}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">
              {verdict.faster ? (
                <>
                  {verdict.label} is <span className="text-success">{verdict.pct.toFixed(0)}% faster</span>
                </>
              ) : (
                <>
                  {verdict.label} is <span className="text-warning">{verdict.pct.toFixed(0)}% slower</span>
                </>
              )}
            </p>
            <p className="text-xs text-muted-foreground">
              Compared against the original query&apos;s median execution time.
            </p>
          </div>
        </div>
      )}

      {/* Result cards */}
      <div className="space-y-3">
        {results.map((r, i) => {
          const isBaseline = i === 0
          const isWinner = isComparison && r.ok && fastest && r.label === fastest.label
          const pct = r.executionTime ? (r.executionTime / maxTime) * 100 : 0
          const delta =
            baseline && r.executionTime !== undefined && !isBaseline
              ? ((r.executionTime - baseline) / baseline) * 100
              : undefined
          const runsMin = r.runs?.length ? Math.min(...r.runs) : undefined
          const runsMax = r.runs?.length ? Math.max(...r.runs) : undefined

          return (
            <div
              key={i}
              className={cn(
                "rounded-lg border bg-card/50 p-4",
                isWinner ? "border-success/50 ring-1 ring-success/20" : "border-border",
              )}
            >
              {/* Card header */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  {isWinner ? (
                    <Trophy className="size-4 text-success" />
                  ) : (
                    <span
                      className={cn(
                        "size-2 rounded-full",
                        isBaseline ? "bg-primary" : "bg-muted-foreground/40",
                      )}
                    />
                  )}
                  <span className="text-sm font-medium text-foreground">{r.label}</span>
                  {isBaseline && isComparison && (
                    <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                      baseline
                    </span>
                  )}
                </div>
                {!r.ok && (
                  <span className="flex items-center gap-1 text-xs font-medium text-destructive">
                    <AlertCircle className="size-3.5" />
                    failed
                  </span>
                )}
              </div>

              {r.ok ? (
                <>
                  {/* Hero median + relative bar */}
                  <div className="mt-3 flex items-end justify-between gap-3">
                    <div className="flex items-baseline gap-1.5">
                      <span className="font-mono text-2xl font-semibold tabular-nums text-foreground">
                        {fmtMs(r.executionTime)}
                      </span>
                      <span className="text-xs text-muted-foreground">median</span>
                    </div>
                    {delta !== undefined && (
                      <span
                        className={cn(
                          "flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold",
                          Math.abs(delta) < 1
                            ? "bg-secondary text-muted-foreground"
                            : delta < 0
                              ? "bg-success/15 text-success"
                              : "bg-warning/15 text-warning",
                        )}
                      >
                        {Math.abs(delta) < 1 ? (
                          <Minus className="size-3" />
                        ) : delta < 0 ? (
                          <TrendingDown className="size-3" />
                        ) : (
                          <TrendingUp className="size-3" />
                        )}
                        {delta > 0 ? "+" : ""}
                        {delta.toFixed(0)}%
                      </span>
                    )}
                  </div>

                  {isComparison && (
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                      <div
                        className={cn("h-full rounded-full", isWinner ? "bg-success" : "bg-primary")}
                        style={{ width: `${Math.max(3, pct)}%` }}
                      />
                    </div>
                  )}

                  {/* Stat grid */}
                  <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border pt-3 sm:grid-cols-4">
                    <Stat
                      label="Fastest"
                      value={fmtMs(runsMin)}
                      accent="success"
                      hint="The quickest of the three runs."
                    />
                    <Stat label="Slowest" value={fmtMs(runsMax)} hint="The slowest of the three runs." />
                    <Stat
                      label="Planning"
                      value={fmtMs(r.planningTime)}
                      hint="Time Postgres spent choosing a query plan before executing."
                    />
                    <Stat
                      label="Cost"
                      value={r.totalCost?.toFixed(0) ?? "—"}
                      hint="Postgres's own estimate of the query's relative expense (arbitrary units, lower is cheaper)."
                    />
                  </div>

                  {/* Individual runs */}
                  {r.runs && r.runs.length > 0 && (
                    <div className="mt-3 flex items-center gap-2">
                      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        Runs
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {r.runs.map((run, ri) => (
                          <span
                            key={ri}
                            className={cn(
                              "rounded px-1.5 py-0.5 font-mono text-[11px] tabular-nums",
                              run === runsMin
                                ? "bg-success/15 text-success"
                                : run === runsMax
                                  ? "bg-secondary text-muted-foreground"
                                  : "bg-secondary/60 text-foreground",
                            )}
                          >
                            {fmtMs(run)}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <p className="mt-2 text-xs leading-relaxed text-destructive/90">{r.error}</p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

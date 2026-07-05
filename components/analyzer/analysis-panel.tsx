"use client"

import { useState } from "react"
import { Copy, Check, AlertTriangle, Info, AlertOctagon, Lightbulb, Database, Wrench } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { InfoHint } from "./info-hint"
import { METRIC_GLOSSARY } from "@/lib/glossary"
import type { AnalysisResult, Finding, IndexSuggestion, Severity } from "@/lib/analyze"

const SEVERITY_META: Record<
  Severity,
  { label: string; icon: typeof Info; className: string; dot: string; border: string }
> = {
  high: {
    label: "High",
    icon: AlertOctagon,
    className: "text-destructive",
    dot: "bg-destructive",
    border: "border-l-destructive",
  },
  medium: {
    label: "Medium",
    icon: AlertTriangle,
    className: "text-warning",
    dot: "bg-warning",
    border: "border-l-warning",
  },
  low: {
    label: "Low",
    icon: Info,
    className: "text-muted-foreground",
    dot: "bg-muted-foreground",
    border: "border-l-muted-foreground/50",
  },
  info: {
    label: "Info",
    icon: Info,
    className: "text-success",
    dot: "bg-success",
    border: "border-l-success",
  },
}

// Findings are shown grouped so what deserves attention is obvious.
const GROUPS: { severity: Severity; title: string }[] = [
  { severity: "high", title: "Critical" },
  { severity: "medium", title: "Needs attention" },
  { severity: "low", title: "Minor" },
  { severity: "info", title: "Looks healthy" },
]

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 gap-1.5 px-2 text-xs"
      onClick={() => {
        navigator.clipboard.writeText(text)
        setCopied(true)
        toast.success("Copied to clipboard")
        setTimeout(() => setCopied(false), 1500)
      }}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "Copied" : "Copy"}
    </Button>
  )
}

function FindingCard({ finding, fix }: { finding: Finding; fix?: IndexSuggestion }) {
  const meta = SEVERITY_META[finding.severity]
  const Icon = meta.icon
  return (
    <div className={cn("rounded-lg border border-l-2 border-border bg-card/50 p-4", meta.border)}>
      <div className="flex items-start gap-3">
        <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", meta.className)} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-sm font-medium text-foreground text-pretty">{finding.title}</h4>
            {finding.concept && (
              <Badge variant="secondary" className="text-[10px]">
                {finding.concept}
              </Badge>
            )}
          </div>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground text-pretty">{finding.detail}</p>

          {fix && (
            <div className="mt-3 rounded-md border border-success/30 bg-success/5 p-2.5">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-success">
                  <Wrench className="h-3.5 w-3.5" />
                  Suggested fix
                </span>
                <CopyButton text={fix.ddl} />
              </div>
              <pre className="overflow-x-auto rounded bg-background/60 p-2 font-mono text-xs text-success">
                {fix.ddl}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export function AnalysisPanel({ analysis }: { analysis: AnalysisResult }) {
  const { summary, findings, indexSuggestions } = analysis
  const counts = findings.reduce<Record<string, number>>((acc, f) => {
    acc[f.severity] = (acc[f.severity] ?? 0) + 1
    return acc
  }, {})

  // Attach an index suggestion to the first matching finding on that relation.
  const usedFixes = new Set<string>()
  const fixFor = (finding: Finding): IndexSuggestion | undefined => {
    if (!finding.relation) return undefined
    const match = indexSuggestions.find((s) => s.relation === finding.relation && !usedFixes.has(s.ddl))
    if (match) usedFixes.add(match.ddl)
    return match
  }

  return (
    <div className="space-y-6">
      {/* Row estimate warning (timings/cost already shown in the metrics strip above) */}
      {!!summary.maxRowMisestimate && summary.maxRowMisestimate > 10 && (
        <div className="flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning/10 p-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <p className="text-sm leading-relaxed text-foreground">
            Postgres misjudged row counts by up to{" "}
            <span className="font-mono font-semibold text-warning">{Math.round(summary.maxRowMisestimate)}x</span>{" "}
            in this plan.{" "}
            <span className="text-muted-foreground">
              {METRIC_GLOSSARY.rowMisestimate.short} Running <span className="font-mono">ANALYZE</span> on the
              table often fixes this.
            </span>
          </p>
        </div>
      )}

      {/* Concepts demonstrated */}
      {summary.concepts.length > 0 && (
        <div>
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Concepts in this plan
            <InfoHint>
              The distinct operations Postgres used to run your query (scans, joins, sorts…). Open{" "}
              <strong>Learn</strong> in the header for a full glossary of each one.
            </InfoHint>
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {summary.concepts.map((c) => (
              <Badge key={c} variant="secondary" className="font-mono text-[11px]">
                {c}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Findings, grouped by priority */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Findings ({findings.length})
          </h3>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            {(["high", "medium", "low"] as const).map(
              (s) =>
                counts[s] > 0 && (
                  <span key={s} className="flex items-center gap-1.5">
                    <span className={cn("h-2 w-2 rounded-full", SEVERITY_META[s].dot)} />
                    {counts[s]}
                  </span>
                ),
            )}
          </div>
        </div>

        <div className="space-y-5">
          {GROUPS.map(({ severity, title }) => {
            const group = findings.filter((f) => f.severity === severity)
            if (group.length === 0) return null
            const meta = SEVERITY_META[severity]
            return (
              <div key={severity}>
                <div className="mb-2 flex items-center gap-2">
                  <span className={cn("h-2 w-2 rounded-full", meta.dot)} />
                  <h4 className={cn("text-xs font-semibold uppercase tracking-wide", meta.className)}>{title}</h4>
                  <span className="text-xs text-muted-foreground">({group.length})</span>
                </div>
                <div className="space-y-2">
                  {group.map((f) => (
                    <FindingCard key={f.id} finding={f} fix={fixFor(f)} />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Index suggestions */}
      {indexSuggestions.length > 0 && (
        <div>
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <Lightbulb className="h-3.5 w-3.5" />
            Suggested indexes ({indexSuggestions.length})
            <InfoHint>
              An index is a lookup structure that lets Postgres find matching rows without scanning the whole
              table. Copy the <span className="font-mono">CREATE INDEX</span> statement and run it on your
              database, then re-analyze to see the effect.
            </InfoHint>
          </h3>
          <div className="space-y-2">
            {indexSuggestions.map((s, i) => (
              <div key={i} className="rounded-lg border border-border bg-card/50 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Database className="h-3.5 w-3.5" />
                    <span className="font-mono text-foreground">{s.relation}</span>
                  </div>
                  <CopyButton text={s.ddl} />
                </div>
                <pre className="mt-2 overflow-x-auto rounded bg-background/60 p-2 font-mono text-xs text-success">
                  {s.ddl}
                </pre>
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{s.rationale}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

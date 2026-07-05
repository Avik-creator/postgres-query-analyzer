"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  GitBranch,
  ListTree,
  Sparkles,
  Gauge,
  Terminal,
  ArrowDownWideNarrow,
  AlertTriangle,
  X,
  Loader2,
} from "lucide-react"
import { toast } from "sonner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import { ConnectionBar } from "./connection-bar"
import { SqlEditor } from "./sql-editor"
import { SchemaSidebar } from "./schema-sidebar"
import { PlanNode, PlanLegend } from "./plan-node"
import { AnalysisPanel } from "./analysis-panel"
import { AiPanel } from "./ai-panel"
import { McpDialog } from "./mcp-dialog"
import { LearnDialog } from "./learn-dialog"
import { Logo } from "./logo"
import { InfoHint } from "./info-hint"
import { METRIC_GLOSSARY } from "@/lib/glossary"
import type { AnalyzeResponse, ConnectionSource, TableInfo, AiSuggestion } from "@/lib/types"
import { SAMPLE_QUERIES } from "@/lib/sample-queries"

function fmtMs(n: number | undefined) {
  if (n === undefined || Number.isNaN(n)) return "—"
  if (n >= 1000) return `${(n / 1000).toFixed(2)}s`
  return `${n.toFixed(2)}ms`
}

function fmtRows(n: number | undefined) {
  if (n === undefined) return "—"
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

export function QueryAnalyzer() {
  const [sql, setSql] = useState(SAMPLE_QUERIES[0].sql)

  // connection state
  const [source, setSource] = useState<ConnectionSource>("demo")
  const [connectionString, setConnectionString] = useState("")
  const [connected, setConnected] = useState(false)
  const [testing, setTesting] = useState(false)

  // schema
  const [tables, setTables] = useState<TableInfo[]>([])
  const [schemaLoading, setSchemaLoading] = useState(false)

  // analysis
  const [analyzing, setAnalyzing] = useState(false)
  const [result, setResult] = useState<AnalyzeResponse | null>(null)
  const [analysisError, setAnalysisError] = useState<string | null>(null)

  // ai
  const [aiRunning, setAiRunning] = useState(false)
  const [ai, setAi] = useState<AiSuggestion | null>(null)

  const [tab, setTab] = useState("plan")
  const resultsRef = useRef<HTMLDivElement>(null)

  const scrollToResults = useCallback(() => {
    requestAnimationFrame(() => {
      resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    })
  }, [])

  const connBody = useCallback(
    () => ({ source, connectionString: source === "custom" ? connectionString : undefined }),
    [source, connectionString],
  )

  const loadSchema = useCallback(async () => {
    if (source === "custom" && !connected) return
    setSchemaLoading(true)
    try {
      const res = await fetch("/api/schema", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(connBody()),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setTables(data.tables ?? [])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load schema")
    } finally {
      setSchemaLoading(false)
    }
  }, [connBody, source, connected])

  // load demo schema on mount
  useEffect(() => {
    loadSchema()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleTest() {
    setTesting(true)
    try {
      const res = await fetch("/api/schema", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: "custom", connectionString }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setConnected(true)
      setTables(data.tables ?? [])
      toast.success("Connected — schema loaded")
    } catch (err) {
      setConnected(false)
      toast.error(err instanceof Error ? err.message : "Connection failed")
    } finally {
      setTesting(false)
    }
  }

  function handleSourceChange(next: ConnectionSource) {
    setSource(next)
    setResult(null)
    setAnalysisError(null)
    setAi(null)
    if (next === "demo") {
      setConnected(false)
      setSchemaLoading(true)
      fetch("/api/schema", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: "demo" }),
      })
        .then((r) => r.json())
        .then((d) => setTables(d.tables ?? []))
        .catch(() => setTables([]))
        .finally(() => setSchemaLoading(false))
    } else {
      setTables([])
    }
  }

  async function handleAnalyze() {
    if (!sql.trim()) {
      setAnalysisError("Write a SQL query before running an analysis.")
      return
    }
    setAnalyzing(true)
    setAnalysisError(null)
    setAi(null)
    scrollToResults()
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...connBody(), sql }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Analysis failed.")
      setResult(data)
      setTab("plan")
      if (!data.executed) {
        toast.info("Non-SELECT statement: showing estimated plan without executing.")
      }
    } catch (err) {
      setResult(null)
      setAnalysisError(err instanceof Error ? err.message : "Analysis failed for an unknown reason.")
    } finally {
      setAnalyzing(false)
    }
  }

  async function handleAi() {
    if (!sql.trim()) return
    setAiRunning(true)
    setTab("ai")
    scrollToResults()
    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...connBody(), sql }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setAi(data.ai)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "AI analysis failed")
    } finally {
      setAiRunning(false)
    }
  }

  function insertTable(name: string) {
    setSql((prev) => (prev.includes(name) ? prev : `${prev.trimEnd()} ${name}`))
  }

  const totalTime = result
    ? (result.explain["Execution Time"] ??
        (result.explain.Plan["Actual Total Time"] ?? 0) * (result.explain.Plan["Actual Loops"] ?? 1))
    : 0

  const hasResults = !!result || aiRunning || !!ai || !!analysisError

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      {/* Header */}
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-border px-4 py-3 sm:px-6">
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Logo className="size-5" />
          </div>
          <div>
            <h1 className="font-mono text-sm font-semibold leading-none tracking-tight text-foreground">pgxray</h1>
            <p className="mt-1 text-xs text-muted-foreground">Postgres Query Analyzer</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <LearnDialog />
          <McpDialog />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Schema sidebar */}
        <aside className="hidden w-64 shrink-0 border-r border-border bg-sidebar lg:block">
          <SchemaSidebar tables={tables} loading={schemaLoading} onRefresh={loadSchema} onInsert={insertTable} />
        </aside>

        {/* Main */}
        <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
          <div className="flex flex-col gap-4 p-4 sm:p-6">
            <ConnectionBar
              source={source}
              connectionString={connectionString}
              connected={connected}
              testing={testing}
              onSourceChange={handleSourceChange}
              onConnectionStringChange={setConnectionString}
              onTest={handleTest}
            />

            {/* Editor */}
            <SqlEditor
              sql={sql}
              onChange={setSql}
              onAnalyze={handleAnalyze}
              onAi={handleAi}
              analyzing={analyzing}
              aiRunning={aiRunning}
            />

            {/* Results */}
            <div ref={resultsRef} className="scroll-mt-4">
            {analyzing ? (
              <div className="flex min-h-[280px] flex-col items-center justify-center rounded-lg border border-border bg-card/40 p-8 text-center">
                <div className="flex size-12 items-center justify-center rounded-lg border border-border bg-muted/40 text-primary">
                  <Loader2 className="size-6 animate-spin" />
                </div>
                <p className="mt-4 text-sm font-medium text-foreground">Analyzing your query…</p>
                <p className="mt-1 max-w-sm text-pretty text-sm text-muted-foreground">
                  Running <span className="font-mono text-foreground">EXPLAIN (ANALYZE)</span> in a read-only
                  transaction and inspecting the plan.
                </p>
              </div>
            ) : !hasResults ? (
              <div className="flex min-h-[280px] flex-1 flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card/40 p-8 text-center">
                <div className="flex size-12 items-center justify-center rounded-lg border border-border bg-muted/40 text-muted-foreground">
                  <Terminal className="size-6" />
                </div>
                <p className="mt-4 text-sm font-medium text-foreground">No analysis yet</p>
                <p className="mt-1 max-w-sm text-pretty text-sm text-muted-foreground">
                  Write a query above and hit <span className="font-medium text-foreground">Analyze</span> to see the
                  execution plan, heuristic findings, index suggestions, and AI recommendations.
                </p>
              </div>
            ) : analysisError ? (
              <div className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4">
                <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-destructive/15 text-destructive">
                  <AlertTriangle className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">Couldn&apos;t analyze this query</p>
                  <p className="mt-1 break-words text-sm leading-relaxed text-muted-foreground">{analysisError}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setAnalysisError(null)}
                  aria-label="Dismiss error"
                  className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {/* Metrics strip */}
                {result && (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <Stat
                      label="Execution"
                      value={fmtMs(totalTime || undefined)}
                      accent
                      icon={<Gauge className="size-3.5" />}
                      hint={METRIC_GLOSSARY.executionTime.short}
                    />
                    <Stat
                      label="Planning"
                      value={fmtMs(result.explain["Planning Time"])}
                      hint={METRIC_GLOSSARY.planningTime.short}
                    />
                    <Stat
                      label="Rows returned"
                      value={fmtRows(result.explain.Plan["Actual Rows"])}
                      hint="How many rows the query actually produced."
                    />
                    <Stat
                      label="Total cost"
                      value={result.explain.Plan["Total Cost"]?.toFixed(0) ?? "—"}
                      icon={<ArrowDownWideNarrow className="size-3.5" />}
                      hint={METRIC_GLOSSARY.cost.short}
                    />
                  </div>
                )}

                {/* Tabs */}
                <div className="rounded-lg border border-border bg-card">
                  <Tabs value={tab} onValueChange={setTab} className="flex flex-col">
                    <div className="border-b border-border p-2">
                      <TabsList className="grid w-full grid-cols-3 sm:w-auto sm:inline-grid">
                        <TabsTrigger value="plan" className="gap-1.5 text-xs">
                          <ListTree className="size-3.5" />
                          Plan
                        </TabsTrigger>
                        <TabsTrigger value="analysis" className="gap-1.5 text-xs">
                          <GitBranch className="size-3.5" />
                          Analysis
                        </TabsTrigger>
                        <TabsTrigger value="ai" className="gap-1.5 text-xs">
                          <Sparkles className="size-3.5" />
                          AI
                        </TabsTrigger>
                      </TabsList>
                    </div>

                    <div className="p-4">
                      <TabsContent value="plan" className="mt-0">
                        {result ? (
                          <div>
                            <PlanLegend />
                            <div className="overflow-x-auto rounded-lg border border-border bg-muted/20 p-2">
                              <PlanNode node={result.explain.Plan} totalTime={totalTime} />
                            </div>
                          </div>
                        ) : (
                          <EmptyHint text="Run an analysis to view the execution plan tree." />
                        )}
                      </TabsContent>

                      <TabsContent value="analysis" className="mt-0">
                        {result ? (
                          <AnalysisPanel analysis={result.analysis} />
                        ) : (
                          <EmptyHint text="Run an analysis to see findings and index suggestions." />
                        )}
                      </TabsContent>

                      <TabsContent value="ai" className="mt-0">
                        <AiPanel ai={ai} loading={aiRunning} onGenerate={handleAi} onUseRewrite={setSql} />
                      </TabsContent>
                    </div>
                  </Tabs>
                </div>
              </div>
            )}
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}

function Stat({
  label,
  value,
  accent,
  icon,
  hint,
}: {
  label: string
  value: string
  accent?: boolean
  icon?: React.ReactNode
  hint?: string
}) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
        {hint && <InfoHint side="top">{hint}</InfoHint>}
      </div>
      <div className={cn("mt-1.5 font-mono text-xl font-semibold tabular-nums", accent && "text-primary")}>
        {value}
      </div>
    </div>
  )
}

function EmptyHint({ text }: { text: string }) {
  return <p className="py-8 text-center text-sm text-muted-foreground text-pretty">{text}</p>
}

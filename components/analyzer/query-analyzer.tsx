"use client"

import { useCallback, useEffect, useState } from "react"
import { GitBranch, ListTree, Sparkles, Gauge, ServerCog, Terminal } from "lucide-react"
import { toast } from "sonner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ConnectionBar } from "./connection-bar"
import { SqlEditor } from "./sql-editor"
import { SchemaSidebar } from "./schema-sidebar"
import { PlanNode, PlanLegend } from "./plan-node"
import { AnalysisPanel } from "./analysis-panel"
import { AiPanel } from "./ai-panel"
import { BenchmarkPanel } from "./benchmark-panel"
import { McpDialog } from "./mcp-dialog"
import { LearnDialog } from "./learn-dialog"
import type { AnalyzeResponse, BenchmarkResult, ConnectionSource, TableInfo, AiSuggestion } from "@/lib/types"
import { SAMPLE_QUERIES } from "@/lib/sample-queries"

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

  // ai
  const [aiRunning, setAiRunning] = useState(false)
  const [ai, setAi] = useState<AiSuggestion | null>(null)

  // benchmark
  const [benchLoading, setBenchLoading] = useState(false)
  const [benchResults, setBenchResults] = useState<BenchmarkResult[]>([])

  const [tab, setTab] = useState("plan")

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
    setAi(null)
    setBenchResults([])
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
    if (!sql.trim()) return
    setAnalyzing(true)
    setAi(null)
    setBenchResults([])
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...connBody(), sql }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setResult(data)
      setTab("plan")
      if (!data.executed) {
        toast.info("Non-SELECT statement: showing estimated plan without executing.")
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Analysis failed")
    } finally {
      setAnalyzing(false)
    }
  }

  async function handleAi() {
    if (!sql.trim()) return
    setAiRunning(true)
    setTab("ai")
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

  async function handleBenchmark() {
    const queries = [{ label: "Original query", sql }]
    if (ai?.rewrittenQuery && ai.rewrittenQuery.trim() !== sql.trim()) {
      queries.push({ label: "AI rewrite", sql: ai.rewrittenQuery })
    }
    setBenchLoading(true)
    try {
      const res = await fetch("/api/benchmark", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...connBody(), queries }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setBenchResults(data.results ?? [])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Benchmark failed")
    } finally {
      setBenchLoading(false)
    }
  }

  function insertTable(name: string) {
    setSql((prev) => (prev.includes(name) ? prev : `${prev.trimEnd()} ${name}`))
  }

  const totalTime = result
    ? (result.explain["Execution Time"] ??
        (result.explain.Plan["Actual Total Time"] ?? 0) * (result.explain.Plan["Actual Loops"] ?? 1))
    : 0

  return (
    <div className="mx-auto flex min-h-screen max-w-[1600px] flex-col">
      {/* Header */}
      <header className="flex items-center justify-between gap-4 border-b border-border px-4 py-3 sm:px-6">
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-md bg-primary/15 text-primary">
            <ServerCog className="size-5" />
          </div>
          <div>
            <h1 className="font-mono text-sm font-semibold leading-none text-foreground">pgxray</h1>
            <p className="mt-0.5 text-xs text-muted-foreground">Postgres Query Analyzer</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <LearnDialog />
          <McpDialog />
        </div>
      </header>

      <div className="flex flex-1 flex-col lg:flex-row">
        {/* Schema sidebar */}
        <aside className="hidden w-64 shrink-0 border-r border-border lg:block">
          <SchemaSidebar tables={tables} loading={schemaLoading} onRefresh={loadSchema} onInsert={insertTable} />
        </aside>

        {/* Main */}
        <main className="min-w-0 flex-1 space-y-4 p-4 sm:p-6">
          <ConnectionBar
            source={source}
            connectionString={connectionString}
            connected={connected}
            testing={testing}
            onSourceChange={handleSourceChange}
            onConnectionStringChange={setConnectionString}
            onTest={handleTest}
          />

          <div className="grid gap-4 xl:grid-cols-2">
            <div className="space-y-3">
              <SqlEditor
                sql={sql}
                onChange={setSql}
                onAnalyze={handleAnalyze}
                analyzing={analyzing}
                aiRunning={aiRunning}
              />
              <button
                type="button"
                onClick={handleAi}
                disabled={aiRunning || !sql.trim()}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-primary/30 bg-primary/10 py-2.5 text-sm font-medium text-primary transition-colors hover:bg-primary/15 disabled:opacity-50"
              >
                <Sparkles className="size-4" />
                Generate AI analysis &amp; rewrite
              </button>
            </div>

            {/* Results */}
            <div className="rounded-lg border border-border bg-card">
              {!result && !aiRunning && !ai ? (
                <div className="flex h-full min-h-[360px] flex-col items-center justify-center p-8 text-center">
                  <Terminal className="size-8 text-muted-foreground" />
                  <p className="mt-3 max-w-xs text-pretty text-sm text-muted-foreground">
                    Run an analysis to see the execution plan, heuristic findings, index suggestions, and AI
                    recommendations.
                  </p>
                </div>
              ) : (
                <Tabs value={tab} onValueChange={setTab} className="flex h-full flex-col">
                  <TabsList className="m-3 grid w-auto grid-cols-4">
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
                    <TabsTrigger value="bench" className="gap-1.5 text-xs">
                      <Gauge className="size-3.5" />
                      Bench
                    </TabsTrigger>
                  </TabsList>

                  <div className="flex-1 overflow-auto px-4 pb-4">
                    <TabsContent value="plan" className="mt-0">
                      {result ? (
                        <div>
                          <PlanLegend />
                          <div className="rounded-lg border border-border bg-background/40 p-2">
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

                    <TabsContent value="bench" className="mt-0">
                      <BenchmarkPanel
                        results={benchResults}
                        loading={benchLoading}
                        canRun={!!sql.trim()}
                        onRun={handleBenchmark}
                      />
                    </TabsContent>
                  </div>
                </Tabs>
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}

function EmptyHint({ text }: { text: string }) {
  return <p className="py-8 text-center text-sm text-muted-foreground text-pretty">{text}</p>
}

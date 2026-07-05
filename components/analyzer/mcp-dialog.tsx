"use client"

import { useEffect, useState } from "react"
import { Plug, Copy, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"

const TOOLS = [
  { name: "analyze_query", desc: "Return the EXPLAIN plan + heuristic findings and index suggestions for a SQL query." },
  { name: "get_schema", desc: "List tables, columns, and indexes for the connected database." },
  { name: "benchmark_queries", desc: "Benchmark one or more read-only queries and return median execution time." },
]

function Row({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-background/60 p-2">
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-xs text-foreground">{text}</code>
      <Button
        variant="ghost"
        size="icon"
        className="size-7 shrink-0"
        onClick={() => {
          navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        }}
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        <span className="sr-only">Copy</span>
      </Button>
    </div>
  )
}

export function McpDialog() {
  const [origin, setOrigin] = useState("")
  useEffect(() => setOrigin(window.location.origin), [])

  const mcpUrl = `${origin}/mcp`
  const config = JSON.stringify(
    { mcpServers: { pgxray: { url: mcpUrl } } },
    null,
    2,
  )

  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm" className="gap-2">
            <Plug className="size-4" />
            MCP
          </Button>
        }
      />
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            MCP Server
            <Badge variant="secondary" className="text-[10px]">
              Model Context Protocol
            </Badge>
          </DialogTitle>
          <DialogDescription className="text-pretty">
            This analyzer is exposed as an MCP server so agents (Claude, Cursor, etc.) can analyze and benchmark
            queries directly against your database.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <h4 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Endpoint</h4>
            <Row text={mcpUrl} />
            <p className="mt-1 text-xs text-muted-foreground">
              Streamable HTTP transport. An SSE endpoint is also available at{" "}
              <code className="font-mono">/sse</code>.
            </p>
          </div>

          <div>
            <h4 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Client config
            </h4>
            <pre className="overflow-x-auto rounded-md border border-border bg-background/60 p-3 font-mono text-xs text-foreground">
              {config}
            </pre>
          </div>

          <div>
            <h4 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Available tools
            </h4>
            <div className="space-y-2">
              {TOOLS.map((t) => (
                <div key={t.name} className="rounded-md border border-border bg-card/50 p-2.5">
                  <code className="font-mono text-xs font-medium text-primary">{t.name}</code>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{t.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

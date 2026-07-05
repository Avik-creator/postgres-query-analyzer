"use client"

import { useState } from "react"
import { Database, Plug, Check, Loader2, ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { ConnectionSource } from "@/lib/types"

interface ConnectionBarProps {
  source: ConnectionSource
  connectionString: string
  connected: boolean
  testing: boolean
  onSourceChange: (source: ConnectionSource) => void
  onConnectionStringChange: (value: string) => void
  onTest: () => void
}

export function ConnectionBar({
  source,
  connectionString,
  connected,
  testing,
  onSourceChange,
  onConnectionStringChange,
  onTest,
}: ConnectionBarProps) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center gap-2 p-3">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Database</span>
        <div className="flex rounded-md border border-border p-0.5">
          <button
            type="button"
            onClick={() => onSourceChange("demo")}
            className={cn(
              "flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium transition-colors",
              source === "demo" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Database className="size-3.5" />
            Demo
          </button>
          <button
            type="button"
            onClick={() => {
              onSourceChange("custom")
              setExpanded(true)
            }}
            className={cn(
              "flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium transition-colors",
              source === "custom" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Plug className="size-3.5" />
            Connect your DB
          </button>
        </div>

        {source === "demo" ? (
          <Badge variant="secondary" className="gap-1.5">
            <span className="size-1.5 rounded-full bg-success" />
            Neon demo · e-commerce dataset
          </Badge>
        ) : (
          <div className="flex flex-1 items-center gap-2">
            {!expanded && (
              <button
                type="button"
                onClick={() => setExpanded(true)}
                className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
              >
                {connected ? "Connected" : "Add connection string"}
                <ChevronDown className="size-3.5" />
              </button>
            )}
            {connected && (
              <Badge variant="secondary" className="gap-1.5">
                <Check className="size-3 text-success" />
                Connected
              </Badge>
            )}
          </div>
        )}
      </div>

      {source === "custom" && expanded && (
        <div className="flex flex-col gap-2 border-t border-border p-3 sm:flex-row sm:items-center">
          <Input
            value={connectionString}
            onChange={(e) => onConnectionStringChange(e.target.value)}
            placeholder="postgresql://user:password@host:5432/dbname?sslmode=require"
            className="font-mono text-xs"
            spellCheck={false}
            autoComplete="off"
          />
          <Button onClick={onTest} disabled={testing || !connectionString.trim()} className="shrink-0">
            {testing ? <Loader2 className="size-4 animate-spin" /> : "Test connection"}
          </Button>
        </div>
      )}
      {source === "custom" && (
        <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
          Credentials are used only to run read-only <code className="font-mono">EXPLAIN</code> queries and are never
          stored. Queries run inside a <code className="font-mono">READ ONLY</code> transaction.
        </p>
      )}
    </div>
  )
}

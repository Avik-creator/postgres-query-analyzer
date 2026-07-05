"use client"

import { useState } from "react"
import { Database, Plug, Check, Loader2, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        {/* Segmented source toggle */}
        <div className="flex rounded-lg border border-border bg-card p-0.5">
          <button
            type="button"
            onClick={() => onSourceChange("demo")}
            className={cn(
              "flex items-center gap-1.5 rounded-[calc(var(--radius)-6px)] px-3 py-1.5 text-xs font-medium transition-colors",
              source === "demo"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Database className="size-3.5" />
            Demo database
          </button>
          <button
            type="button"
            onClick={() => {
              onSourceChange("custom")
              setExpanded(true)
            }}
            className={cn(
              "flex items-center gap-1.5 rounded-[calc(var(--radius)-6px)] px-3 py-1.5 text-xs font-medium transition-colors",
              source === "custom"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Plug className="size-3.5" />
            Connect your DB
          </button>
        </div>

        {source === "demo" ? (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="size-1.5 rounded-full bg-success" />
            Neon demo · e-commerce dataset
          </span>
        ) : connected ? (
          <span className="flex items-center gap-1.5 text-xs font-medium text-success">
            <Check className="size-3.5" />
            Connected
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">Add a connection string to browse your schema</span>
        )}
      </div>

      {source === "custom" && expanded && (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3 sm:flex-row sm:items-center">
          <Input
            value={connectionString}
            onChange={(e) => onConnectionStringChange(e.target.value)}
            placeholder="postgresql://user:password@host:5432/dbname?sslmode=require"
            className="h-9 font-mono text-xs"
            spellCheck={false}
            autoComplete="off"
          />
          <Button
            onClick={onTest}
            disabled={testing || !connectionString.trim()}
            className="h-9 shrink-0 text-xs"
          >
            {testing ? <Loader2 className="size-4 animate-spin" /> : "Test connection"}
          </Button>
        </div>
      )}

      {source === "custom" && (
        <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
          <ShieldCheck className="mt-px size-3.5 shrink-0 text-success" />
          <span>
            Credentials run read-only <code className="font-mono text-foreground">EXPLAIN</code> queries inside a{" "}
            <code className="font-mono text-foreground">READ ONLY</code> transaction and are never stored.
          </span>
        </p>
      )}
    </div>
  )
}

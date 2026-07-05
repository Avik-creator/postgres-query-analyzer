"use client"

import { useState } from "react"
import { Table2, ChevronRight, KeyRound, Loader2, RefreshCw } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { TableInfo } from "@/lib/types"

function TableItem({ table, onInsert }: { table: TableInfo; onInsert: (name: string) => void }) {
  const [open, setOpen] = useState(false)
  const qualified = table.schema === "public" ? table.name : `${table.schema}.${table.name}`
  const indexedCols = new Set(
    table.indexes.flatMap((i) => {
      const m = i.definition.match(/\(([^)]+)\)/)
      return m ? m[1].split(",").map((c) => c.trim().split(" ")[0].replace(/"/g, "")) : []
    }),
  )

  return (
    <div className="rounded-md border border-border/60 bg-card/40">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-2.5 py-2 text-left"
      >
        <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
        <Table2 className="h-3.5 w-3.5 shrink-0 text-primary" />
        <span className="truncate font-mono text-xs text-foreground">{qualified}</span>
        <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">
          ~{table.estimatedRows.toLocaleString()}
        </span>
      </button>

      {open && (
        <div className="border-t border-border/60 px-2.5 py-2">
          <div className="space-y-1">
            {table.columns.map((c) => (
              <div key={c.name} className="flex items-center gap-1.5 font-mono text-[11px]">
                {indexedCols.has(c.name) && <KeyRound className="h-2.5 w-2.5 shrink-0 text-warning" />}
                <span className={cn("text-foreground", !indexedCols.has(c.name) && "ml-4")}>{c.name}</span>
                <span className="text-muted-foreground/70">{c.type}</span>
              </div>
            ))}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="mt-2 h-6 w-full justify-start px-1 text-[11px] text-muted-foreground"
            onClick={() => onInsert(qualified)}
          >
            Insert table name
          </Button>
        </div>
      )}
    </div>
  )
}

export function SchemaSidebar({
  tables,
  loading,
  onRefresh,
  onInsert,
}: {
  tables: TableInfo[]
  loading: boolean
  onRefresh: () => void
  onInsert: (name: string) => void
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Schema</h2>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onRefresh} disabled={loading}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          <span className="sr-only">Refresh schema</span>
        </Button>
      </div>
      <ScrollArea className="flex-1">
        <div className="space-y-1.5 p-3">
          {loading && tables.length === 0 && (
            <p className="px-1 py-4 text-center text-xs text-muted-foreground">Loading schema…</p>
          )}
          {!loading && tables.length === 0 && (
            <p className="px-1 py-4 text-center text-xs text-muted-foreground text-pretty">
              No tables found. Connect a database to browse its schema.
            </p>
          )}
          {tables.map((t) => (
            <TableItem key={`${t.schema}.${t.name}`} table={t} onInsert={onInsert} />
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}

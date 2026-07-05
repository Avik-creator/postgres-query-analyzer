"use client"

import { Play, Sparkles, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { SAMPLE_QUERIES } from "@/lib/sample-queries"

interface SqlEditorProps {
  sql: string
  onChange: (value: string) => void
  onAnalyze: () => void
  analyzing: boolean
  aiRunning: boolean
}

export function SqlEditor({ sql, onChange, onAnalyze, analyzing, aiRunning }: SqlEditorProps) {
  const busy = analyzing || aiRunning
  const lineCount = Math.max(sql.split("\n").length, 12)

  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">SQL</span>
        </div>
        <Select
          onValueChange={(value) => {
            const q = SAMPLE_QUERIES.find((s) => s.label === value)
            if (q) onChange(q.sql)
          }}
        >
          <SelectTrigger size="sm" className="w-[220px] text-xs">
            <SelectValue placeholder="Load a sample query" />
          </SelectTrigger>
          <SelectContent>
            {SAMPLE_QUERIES.map((q) => (
              <SelectItem key={q.label} value={q.label} className="text-xs">
                {q.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="relative flex">
        <div
          aria-hidden
          className="select-none border-r border-border bg-muted/30 px-3 py-3 text-right font-mono text-xs leading-6 text-muted-foreground"
        >
          {Array.from({ length: lineCount }, (_, i) => (
            <div key={i}>{i + 1}</div>
          ))}
        </div>
        <textarea
          value={sql}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault()
              onAnalyze()
            }
          }}
          placeholder="SELECT * FROM demo.orders WHERE status = 'paid';"
          className="min-h-[288px] flex-1 resize-y bg-transparent px-3 py-3 font-mono text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground"
        />
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2">
        <p className="text-xs text-muted-foreground">
          Press <kbd className="rounded border border-border bg-muted px-1 font-mono">⌘/Ctrl</kbd> +{" "}
          <kbd className="rounded border border-border bg-muted px-1 font-mono">Enter</kbd> to analyze
        </p>
        <Button onClick={onAnalyze} disabled={busy || !sql.trim()}>
          {analyzing ? (
            <Loader2 className="size-4 animate-spin" />
          ) : aiRunning ? (
            <Sparkles className="size-4 animate-pulse" />
          ) : (
            <Play className="size-4" />
          )}
          Analyze
        </Button>
      </div>
    </div>
  )
}

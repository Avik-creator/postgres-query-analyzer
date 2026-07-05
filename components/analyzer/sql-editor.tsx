"use client"

import { useRef } from "react"
import { Play, Sparkles, Loader2, FileCode2 } from "lucide-react"
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
  onAi: () => void
  analyzing: boolean
  aiRunning: boolean
}

export function SqlEditor({ sql, onChange, onAnalyze, onAi, analyzing, aiRunning }: SqlEditorProps) {
  const busy = analyzing || aiRunning
  const gutterRef = useRef<HTMLDivElement>(null)
  const lineCount = Math.max(sql.split("\n").length, 10)

  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-border bg-card">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-2 text-muted-foreground">
          <FileCode2 className="size-4" />
          <span className="font-mono text-xs font-medium tracking-tight text-foreground">query.sql</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            onValueChange={(value) => {
              const q = SAMPLE_QUERIES.find((s) => s.label === value)
              if (q) onChange(q.sql)
            }}
          >
            <SelectTrigger size="sm" className="h-8 w-[170px] text-xs max-sm:w-full">
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
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={onAi}
            disabled={busy || !sql.trim()}
          >
            {aiRunning ? <Sparkles className="size-3.5 animate-pulse" /> : <Sparkles className="size-3.5" />}
            AI rewrite
          </Button>
          <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={onAnalyze} disabled={busy || !sql.trim()}>
            {analyzing ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
            Analyze
          </Button>
        </div>
      </div>

      {/* Editor body */}
      <div className="flex overflow-hidden">
        <div
          ref={gutterRef}
          aria-hidden
          className="h-[272px] shrink-0 select-none overflow-hidden border-r border-border bg-muted/40 px-3 py-4 text-right font-mono text-sm leading-6 text-muted-foreground/60"
        >
          {Array.from({ length: lineCount }, (_, i) => (
            <div key={i}>{i + 1}</div>
          ))}
          {/* Spacer so the gutter can scroll in step with the textarea's overscroll */}
          <div className="h-8" />
        </div>
        <textarea
          value={sql}
          onChange={(e) => onChange(e.target.value)}
          onScroll={(e) => {
            if (gutterRef.current) gutterRef.current.scrollTop = e.currentTarget.scrollTop
          }}
          spellCheck={false}
          wrap="off"
          aria-label="SQL query editor"
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault()
              onAnalyze()
            }
          }}
          placeholder="SELECT * FROM demo.orders WHERE status = 'paid';"
          className="h-[272px] w-full resize-none overflow-auto whitespace-pre bg-transparent px-4 py-4 font-mono text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground/50"
        />
      </div>

      {/* Footer hint */}
      <div className="flex items-center justify-between gap-2 border-t border-border bg-muted/20 px-3 py-1.5">
        <p className="text-[11px] text-muted-foreground">
          <kbd className="rounded border border-border bg-muted px-1 font-mono text-[10px]">⌘</kbd>
          <span className="mx-0.5">+</span>
          <kbd className="rounded border border-border bg-muted px-1 font-mono text-[10px]">Enter</kbd>
          <span className="ml-1.5">to analyze</span>
        </p>
        <span className="font-mono text-[11px] text-muted-foreground/70">{sql.length} chars</span>
      </div>
    </div>
  )
}

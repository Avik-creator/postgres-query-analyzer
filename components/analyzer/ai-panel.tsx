"use client"

import { useState } from "react"
import { Sparkles, Copy, Check, Loader2, BookOpen, Lightbulb } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import type { AiSuggestion } from "@/lib/types"

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

export function AiPanel({
  ai,
  loading,
  onGenerate,
  onUseRewrite,
}: {
  ai: AiSuggestion | null
  loading: boolean
  onGenerate: () => void
  onUseRewrite: (sql: string) => void
}) {
  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-20 w-full" />
      </div>
    )
  }

  if (!ai) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-12 text-center">
        <Sparkles className="h-8 w-8 text-muted-foreground" />
        <p className="mt-3 max-w-xs text-pretty text-sm text-muted-foreground">
          Get an AI-powered explanation, an optimized query rewrite, and index recommendations grounded in your
          schema and plan.
        </p>
        <Button className="mt-4 gap-2" onClick={onGenerate}>
          <Sparkles className="h-4 w-4" />
          Generate AI analysis
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          AI analysis
        </h3>
        <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs" onClick={onGenerate}>
          <Loader2 className="hidden h-3.5 w-3.5" />
          Regenerate
        </Button>
      </div>

      <p className="text-sm leading-relaxed text-foreground text-pretty">{ai.summary}</p>

      {/* Rewrite */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Optimized rewrite</h4>
          <div className="flex items-center gap-1">
            <Button variant="secondary" size="sm" className="h-7 px-2 text-xs" onClick={() => onUseRewrite(ai.rewrittenQuery)}>
              Use in editor
            </Button>
            <CopyButton text={ai.rewrittenQuery} />
          </div>
        </div>
        <pre className="overflow-x-auto rounded-lg border border-border bg-background/60 p-3 font-mono text-xs leading-relaxed text-foreground">
          {ai.rewrittenQuery}
        </pre>
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground text-pretty">{ai.rewriteRationale}</p>
      </div>

      {/* Index suggestions */}
      {ai.indexSuggestions.length > 0 && (
        <div>
          <h4 className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <Lightbulb className="h-3.5 w-3.5" />
            Recommended indexes
          </h4>
          <div className="space-y-2">
            {ai.indexSuggestions.map((s, i) => (
              <div key={i} className="rounded-lg border border-border bg-card/50 p-3">
                <div className="flex items-center justify-end">
                  <CopyButton text={s.ddl} />
                </div>
                <pre className="overflow-x-auto rounded bg-background/60 p-2 font-mono text-xs text-success">
                  {s.ddl}
                </pre>
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{s.rationale}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Concepts */}
      {ai.concepts.length > 0 && (
        <div>
          <h4 className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <BookOpen className="h-3.5 w-3.5" />
            Postgres concepts
          </h4>
          <div className="space-y-2">
            {ai.concepts.map((c, i) => (
              <div key={i} className="rounded-lg border border-border bg-card/50 p-3">
                <Badge variant="secondary" className="font-mono text-[11px]">
                  {c.name}
                </Badge>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground text-pretty">{c.explanation}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

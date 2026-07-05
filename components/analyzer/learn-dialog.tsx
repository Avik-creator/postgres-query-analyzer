"use client"

import { BookOpen, Gauge, Layers, Lightbulb } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { ScrollArea } from "@/components/ui/scroll-area"
import { METRIC_GLOSSARY, NODE_GLOSSARY } from "@/lib/glossary"

const METRIC_ORDER = [
  "cost",
  "planRows",
  "actualRows",
  "rowMisestimate",
  "loops",
  "actualTime",
  "selfTime",
  "width",
  "planningTime",
  "executionTime",
  "buffers",
]

export function LearnDialog() {
  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm" className="gap-2">
            <BookOpen className="size-4" />
            Learn
          </Button>
        }
      />
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-6 py-4">
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="size-4 text-primary" />
            Understanding Postgres query plans
          </DialogTitle>
          <DialogDescription>
            A plain-language guide to everything this analyzer shows you — no prior EXPLAIN experience needed.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[calc(85vh-5.5rem)]">
          <div className="space-y-6 px-6 py-5">
            {/* How to read a plan */}
            <section>
              <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
                <Layers className="size-4 text-primary" />
                How to read a plan
              </h3>
              <p className="text-sm leading-relaxed text-muted-foreground text-pretty">
                Postgres turns your SQL into a tree of steps called an <strong>execution plan</strong>. The tree
                runs bottom-up: the deepest, most-indented nodes run first and pass their rows up to their
                parents. Each node describes one operation — scanning a table, joining two inputs, sorting, or
                aggregating. Your job when tuning is to find the node that costs the most{" "}
                <strong>self time</strong> and make it cheaper, usually with an index or a query rewrite.
              </p>
            </section>

            {/* Metrics */}
            <section>
              <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
                <Gauge className="size-4 text-primary" />
                Metrics on every node
              </h3>
              <Accordion className="w-full">
                {METRIC_ORDER.map((key) => {
                  const e = METRIC_GLOSSARY[key]
                  if (!e) return null
                  return (
                    <AccordionItem key={key} value={key}>
                      <AccordionTrigger className="text-sm">{e.term}</AccordionTrigger>
                      <AccordionContent className="text-sm leading-relaxed text-muted-foreground text-pretty">
                        <p>{e.short}</p>
                        {e.long && <p className="mt-2">{e.long}</p>}
                      </AccordionContent>
                    </AccordionItem>
                  )
                })}
              </Accordion>
            </section>

            {/* Node types */}
            <section>
              <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
                <Lightbulb className="size-4 text-primary" />
                Common node types
              </h3>
              <Accordion className="w-full">
                {Object.entries(NODE_GLOSSARY).map(([key, e]) => (
                  <AccordionItem key={key} value={key}>
                    <AccordionTrigger className="text-sm">
                      <span className="font-mono">{key}</span>
                    </AccordionTrigger>
                    <AccordionContent className="text-sm leading-relaxed text-muted-foreground text-pretty">
                      <p>{e.short}</p>
                      {e.long && <p className="mt-2">{e.long}</p>}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </section>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}

"use client"

import type { ReactNode } from "react"
import { HelpCircle } from "lucide-react"
import { cn } from "@/lib/utils"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

/**
 * A small "?" affordance that reveals a plain-language explanation on hover/focus.
 * Keyboard accessible: it renders a real <button> so it can be tabbed to.
 */
export function InfoHint({
  children,
  className,
  side = "top",
  label = "What does this mean?",
}: {
  children: ReactNode
  className?: string
  side?: "top" | "bottom" | "left" | "right"
  label?: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            className={cn(
              "inline-flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              className,
            )}
          >
            <HelpCircle className="size-3.5" />
          </button>
        }
      />
      <TooltipContent side={side} className="max-w-[16rem] text-pretty leading-relaxed">
        {children}
      </TooltipContent>
    </Tooltip>
  )
}

/** Dotted-underline text that shows an explanation tooltip — for inline terms. */
export function TermHint({
  children,
  hint,
  side = "top",
}: {
  children: ReactNode
  hint: ReactNode
  side?: "top" | "bottom" | "left" | "right"
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            className="cursor-help underline decoration-dotted decoration-muted-foreground/50 underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {children}
          </button>
        }
      />
      <TooltipContent side={side} className="max-w-[16rem] text-pretty leading-relaxed">
        {hint}
      </TooltipContent>
    </Tooltip>
  )
}

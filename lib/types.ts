import type { AnalysisResult, ExplainResult } from "./analyze"

export type ConnectionSource = "demo" | "custom"

export interface AnalyzeResponse {
  explain: ExplainResult
  analysis: AnalysisResult
  executed: boolean
  source: ConnectionSource
}

export interface ColumnInfo {
  name: string
  type: string
  nullable: boolean
}

export interface IndexInfo {
  name: string
  definition: string
}

export interface TableInfo {
  schema: string
  name: string
  estimatedRows: number
  columns: ColumnInfo[]
  indexes: IndexInfo[]
}

export interface BenchmarkResult {
  label: string
  sql: string
  ok: boolean
  error?: string
  executionTime?: number
  planningTime?: number
  totalCost?: number
  runs?: number[]
  nodeTypes?: string[]
}

export interface AiSuggestion {
  summary: string
  rewrittenQuery: string
  rewriteRationale: string
  indexSuggestions: { ddl: string; rationale: string }[]
  concepts: { name: string; explanation: string }[]
}

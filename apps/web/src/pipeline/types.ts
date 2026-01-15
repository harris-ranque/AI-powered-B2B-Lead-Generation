import type { Lead } from "@/lib/api-client";
import type { Id } from "@genni/convex-types/dataModel";

export type PipelineStage =
  | "source_selection"
  | "lead_discovery"
  | "enrichment"
  | "ai_personalization"
  | "review_export";

export type LeadSourceType = "google_maps" | "csv_upload" | "crm_import";

export interface PipelineState {
  currentStage: PipelineStage;
  completedStages: PipelineStage[];
  selectedSource: LeadSourceType | null;
  searchId: Id<"searches"> | null;
  leads: Lead[];
  enrichedLeads: Lead[];
  generatedEmails: EmailGenerationResult[];
  canProgress: boolean;
  isProcessing: boolean;
}

export interface StageConfig {
  id: PipelineStage;
  title: string;
  description: string;
  icon: string;
  estimatedTime?: string;
  requiresCredits?: boolean;
  dependencies?: PipelineStage[];
}

export interface SourceParams {
  location?: string;
  industry?: string;
  leadsCount?: number;
  radius?: number;
  includeEmails?: boolean;
  aiAnalysis?: boolean;
  roles?: string[];
  file?: File;
  columns?: Record<string, string>;
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  estimatedCost?: number;
  metadata?: Record<string, unknown>;
}

export interface CSVImportStats {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  skippedRows: number;
  leadsWithEmail: number;
  leadsNeedingEnrichment: number;
  estimatedCost: number;
  actualCost: number;
  errorReport?: Array<{
    rowNumber: number;
    companyName?: string;
    errors: string[];
    warnings?: string[];
    rawData?: Record<string, string>;
  }>;
}

export interface CSVFetchResult {
  leads: Lead[];
  stats: CSVImportStats;
}

export interface LeadSource {
  type: LeadSourceType;
  name: string;
  description: string;
  icon: string;
  validate: (params: SourceParams) => ValidationResult;
  fetch: (params: SourceParams) => Promise<Lead[] | CSVFetchResult>;
  supportsEnrichment: boolean;
  supportsAI: boolean;
}

export interface EmailGenerationResult {
  requestId?: string;
  leadId?: string;
  completed_at?: number;
  quality_score?: number;
  processing_time?: number;
  primary_email: {
    subject: string;
    body: string;
  };
  follow_up_emails: Array<{
    subject: string;
    body: string;
    delay_days: number;
  }>;
  relevance_score: number;
  personalization_notes: string[];
  estimated_response_rate: number;
}

export interface ExportFormat {
  type: "csv" | "json" | "pdf" | "excel";
  name: string;
  description: string;
  icon: string;
  includeEmails: boolean;
}

/**
 * TypeScript types for analysis / Write Emails progress
 */

import type { Id } from "@genni/convex-types/dataModel";

export interface AnalysisBreakdown {
  pending: number;
  inProgress: number;
  completed: number;
  personalized: number;
  failed: number;
  skipped: number;
  percentComplete: number;
  personalizedPercent: number;
}

export interface RecentPersonalizedContact {
  contactName: string;
  email: string;
  businessName: string;
  subject: string;
  relevanceScore: number | null;
}

export interface AnalysisProgress {
  mode: "contact" | "lead";
  searchId: Id<"searches">;
  searchStatus: string;
  researchTier: string | null;
  total: number;
  pending: number;
  scheduled: number;
  processing: number;
  inProgress: number;
  completed: number;
  failed: number;
  skipped: number;
  personalized: number;
  processed: number;
  percentComplete: number;
  personalizedPercent: number;
  isComplete: boolean;
  stuckInProgress?: number;
  recentPersonalized: RecentPersonalizedContact[];
}

export interface AnalysisBroadcastData {
  progress?: {
    discovered: number;
    enriched: number;
    analyzed: number;
    total: number;
  };
  analysisBreakdown?: AnalysisBreakdown;
  currentLead?: string;
  batchId?: string;
}

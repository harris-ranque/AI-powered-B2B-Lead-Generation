/**
 * TypeScript types for enrichment progress and workpool metrics
 */

import type { Id } from "@genni/convex-types/dataModel";

/**
 * Enrichment progress response from getEnrichmentProgress query
 */
export interface EnrichmentProgress {
  searchId: Id<"searches">;
  searchStatus: string;
  total: number;
  pending: number;
  inProgress: number;
  completed: number;
  failed: number;
  noContacts?: number;
  withEmail?: number;
  processed?: number;
  percentComplete: number;
  providers: {
    findymail: number;
    icypeas: number;
  };
  isComplete: boolean;
  isPaused: boolean;
}

/**
 * Workpool metrics from pipeline broadcasts
 */
export interface WorkpoolMetrics {
  totalLeads: number;
  enqueuedJobs: number;
  failedToEnqueue: number;
  maxParallelism: number;
  perApiKeyConcurrency: number;
  estimatedMinutes: number;
}

/**
 * Enrichment breakdown by status
 */
export interface EnrichmentBreakdown {
  pending: number;
  inProgress: number;
  completed: number;
  completedFallback: number;
  failed: number;
  percentComplete: number;
}

/**
 * Last enriched lead information
 */
export interface LastEnrichedLead {
  businessName: string;
  provider: "findymail" | "icypeas";
  emailCount: number;
  contactCount: number;
}

/**
 * Extended broadcast data with workpool and enrichment info
 */
export interface EnrichmentBroadcastData {
  progress?: {
    discovered: number;
    enriched: number;
    analyzed: number;
    total: number;
  };
  workpool?: WorkpoolMetrics;
  enrichmentBreakdown?: EnrichmentBreakdown;
  lastEnrichedLead?: LastEnrichedLead;
}

/**
 * PostHog Analytics Tracking Hook
 *
 * Provides utility functions for tracking enrichment-related events
 * Mirrors the backend analytics.ts tracking functions
 */

import { usePostHog as usePostHogProvider } from "posthog-js/react";

export function usePostHogTracking() {
  const posthog = usePostHogProvider();

  /**
   * Track enrichment batch start
   */
  const trackEnrichmentBatchStarted = (data: {
    searchId: string;
    totalLeads: number;
    workpoolParallelism: number;
    apiKeysUsed: number;
  }) => {
    if (!posthog) return;

    posthog.capture("enrichment_batch_started", {
      searchId: data.searchId,
      totalLeads: data.totalLeads,
      workpoolParallelism: data.workpoolParallelism,
      apiKeysUsed: data.apiKeysUsed,
    });
  };

  /**
   * Track individual lead enrichment completion
   */
  const trackEnrichmentCompleted = (data: {
    searchId: string;
    leadId: string;
    provider: "findymail" | "icypeas";
    durationMs: number;
    rolesFound: number;
    emailFound: boolean;
    retryAttempt: number;
  }) => {
    if (!posthog) return;

    posthog.capture("lead_enrichment_completed", {
      searchId: data.searchId,
      leadId: data.leadId,
      provider: data.provider,
      durationMs: data.durationMs,
      rolesFound: data.rolesFound,
      emailFound: data.emailFound,
      retryAttempt: data.retryAttempt,
    });
  };

  /**
   * Track individual lead enrichment failure
   */
  const trackEnrichmentFailed = (data: {
    searchId: string;
    leadId: string;
    provider: "findymail" | "icypeas";
    durationMs: number;
    errorType: string;
    retryAttempt: number;
  }) => {
    if (!posthog) return;

    posthog.capture("lead_enrichment_failed", {
      searchId: data.searchId,
      leadId: data.leadId,
      provider: data.provider,
      durationMs: data.durationMs,
      errorType: data.errorType,
      retryAttempt: data.retryAttempt,
    });
  };

  /**
   * Track enrichment progress milestone
   * Useful for tracking 25%, 50%, 75%, 100% completion
   */
  const trackEnrichmentMilestone = (data: {
    searchId: string;
    percentComplete: number;
    totalLeads: number;
    completedLeads: number;
    failedLeads: number;
  }) => {
    if (!posthog) return;

    posthog.capture("enrichment_milestone", {
      searchId: data.searchId,
      percentComplete: data.percentComplete,
      totalLeads: data.totalLeads,
      completedLeads: data.completedLeads,
      failedLeads: data.failedLeads,
    });
  };

  /**
   * Track admin pause/resume actions
   */
  const trackEnrichmentPauseToggle = (data: {
    searchId: string;
    action: "pause" | "resume";
    userId: string;
    totalLeads: number;
    completedLeads: number;
  }) => {
    if (!posthog) return;

    posthog.capture("enrichment_pause_toggle", {
      searchId: data.searchId,
      action: data.action,
      userId: data.userId,
      totalLeads: data.totalLeads,
      completedLeads: data.completedLeads,
    });
  };

  return {
    trackEnrichmentBatchStarted,
    trackEnrichmentCompleted,
    trackEnrichmentFailed,
    trackEnrichmentMilestone,
    trackEnrichmentPauseToggle,
  };
}

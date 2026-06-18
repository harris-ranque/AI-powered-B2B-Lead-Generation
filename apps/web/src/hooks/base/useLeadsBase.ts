import { useQuery, useMutation } from "convex/react";
import { api } from "@genni/convex-types";
import type { Id } from "@genni/convex-types/dataModel";
import { useEffect, useCallback, useState } from "react";
import { createLogger, timeOperation } from "@/utils/logger";
import type { Lead } from "@/lib/types";

const logger = createLogger("useLeads");

const EMPTY_LEADS: Lead[] = [];

// Helper to check if an ID is a temporary optimistic ID (not yet persisted to Convex)
const isTempId = (id: string | undefined): boolean =>
  typeof id === "string" && id.startsWith("temp_");

export function useLeadsBase(searchId?: Id<"searches">) {
  // Skip query for temp IDs to avoid validation errors
  const leadsResult = useQuery(
    api.leads.queries.getLeadsBySearch,
    searchId && !isTempId(searchId) ? { searchId } : "skip",
  );

  const updateLeadMutation = useMutation(api.leads.mutations.updateLead);
  const updateLeadStatusMutation = useMutation(
    api.leads.mutations.updateLeadStatus,
  );
  const addLeadNotesMutation = useMutation(api.leads.mutations.addLeadNotes);
  const deleteLeadMutation = useMutation(api.leads.mutations.deleteLead);

  const [optimisticLeads, setOptimisticLeads] = useState<Lead[]>(EMPTY_LEADS);

  useEffect(() => {
    if (leadsResult !== undefined) {
      setOptimisticLeads(leadsResult);
    }
  }, [leadsResult]);

  const updateOptimisticLeads = (
    updater: Lead[] | ((prev: Lead[]) => Lead[]),
  ) => {
    setOptimisticLeads((prev) =>
      typeof updater === "function" ? (updater as (p: Lead[]) => Lead[])(prev) : updater,
    );
  };

  useEffect(() => {
    if (leadsResult && leadsResult.length > 0) {
      logger.debug("Leads loaded", {
        searchId,
        count: leadsResult.length,
        statuses: leadsResult.reduce(
          (acc, lead) => {
            acc[lead.status] = (acc[lead.status] || 0) + 1;
            return acc;
          },
          {} as Record<string, number>,
        ),
      });
    }
  }, [leadsResult, searchId]);

  const updateLead = useCallback(async (...args: Parameters<typeof updateLeadMutation>) => {
    const { leadId, updates } = args[0];
    logger.info("Updating lead", { leadId, updates });

    updateOptimisticLeads((prev) =>
      prev.map((lead) =>
        lead._id === leadId
          ? { ...lead, ...updates, updatedAt: Date.now() }
          : lead,
      ),
    );

    try {
      return await timeOperation("updateLead", () => updateLeadMutation(...args));
    } catch (error) {
      logger.error("Failed to update lead, server will correct", error);
      throw error;
    }
  }, [updateLeadMutation, updateOptimisticLeads]);

  const updateLeadStatus = useCallback(async (
    ...args: Parameters<typeof updateLeadStatusMutation>
  ) => {
    const { leadId, status } = args[0];
    logger.info("Updating lead status", { leadId, status });

    updateOptimisticLeads((prev) =>
      prev.map((lead) =>
        lead._id === leadId
          ? { ...lead, status, updatedAt: Date.now() }
          : lead,
      ),
    );

    try {
      return await timeOperation("updateLeadStatus", () =>
        updateLeadStatusMutation(...args),
      );
    } catch (error) {
      logger.error("Failed to update lead status, server will correct", error);
      throw error;
    }
  }, [updateLeadStatusMutation, updateOptimisticLeads]);

  const addLeadNotes = useCallback(async (
    ...args: Parameters<typeof addLeadNotesMutation>
  ) => {
    const { leadId, notes } = args[0];
    logger.info("Adding lead notes", { leadId });

    updateOptimisticLeads((prev) =>
      prev.map((lead) =>
        lead._id === leadId
          ? { ...lead, notes, updatedAt: Date.now() }
          : lead,
      ),
    );

    try {
      return await timeOperation("addLeadNotes", () => addLeadNotesMutation(...args));
    } catch (error) {
      logger.error("Failed to add lead notes, server will correct", error);
      throw error;
    }
  }, [addLeadNotesMutation, updateOptimisticLeads]);

  const deleteLead = useCallback(async (...args: Parameters<typeof deleteLeadMutation>) => {
    const { leadId } = args[0];
    logger.warn("Deleting lead", { leadId });

    const originalLeads = optimisticLeads;
    updateOptimisticLeads((prev) => prev.filter((lead) => lead._id !== leadId));

    try {
      return await timeOperation("deleteLead", () => deleteLeadMutation(...args));
    } catch (error) {
      updateOptimisticLeads(originalLeads);
      throw error;
    }
  }, [deleteLeadMutation, updateOptimisticLeads, optimisticLeads]);

  return {
    leads: optimisticLeads,
    updateLead,
    updateLeadStatus,
    addLeadNotes,
    deleteLead,
    isLoading: leadsResult === undefined && searchId !== undefined,
  };
}

export type UseLeadsResult = ReturnType<typeof useLeadsBase>;

export function useLeadBase(leadId: Id<"leads"> | undefined) {
  const lead = useQuery(
    api.leads.queries.getLead,
    leadId ? { leadId } : "skip",
  );

  return {
    lead,
    isLoading: lead === undefined && leadId !== undefined,
  };
}

export type UseLeadResult = ReturnType<typeof useLeadBase>;

// Default stats to prevent crashes when query returns undefined
const DEFAULT_LEAD_STATS = {
  totalLeads: 0,
  totalContacts: 0,
  totalBusinessesDiscovered: 0,
  enrichedLeads: 0,
  analyzedLeads: 0,
  withEmails: 0,
  thisWeek: 0,
  enrichmentRate: 0,
  analysisRate: 0,
  avgRelevanceScore: 0,
  qualifiedLeads: 0,
  contactedLeads: 0,
  conversionRate: 0,
} as const;

export function useUserLeadsBase() {
  const leads = useQuery(api.leads.queries.getUserLeads);
  const rawStats = useQuery(api.leads.queries.getLeadStats);

  return {
    leads,
    // Always provide a valid stats object with defaults for any missing fields
    // This prevents crashes when stats is loading or has missing fields
    stats: rawStats ? { ...DEFAULT_LEAD_STATS, ...rawStats } : DEFAULT_LEAD_STATS,
    // Expose raw stats for components that need to check loading state
    rawStats,
    isLoading: leads === undefined,
    isStatsLoading: rawStats === undefined,
  };
}

export type UseUserLeadsResult = ReturnType<typeof useUserLeadsBase>;

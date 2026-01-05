import { useQuery, useMutation } from "convex/react";
import { api } from "@genni/convex-types";
import type { Id } from "@genni/convex-types/dataModel";
import { useEffect, useCallback, useState } from "react";
import { createLogger, timeOperation } from "@/utils/logger";
import type { Lead } from "@/lib/types";

const logger = createLogger("useLeads");

// Helper to check if an ID is a temporary optimistic ID (not yet persisted to Convex)
const isTempId = (id: string | undefined): boolean =>
  typeof id === "string" && id.startsWith("temp_");

export function useLeadsBase(searchId?: Id<"searches">) {
  // Skip query for temp IDs to avoid validation errors
  const leadsResult = useQuery(
    api.leads.queries.getLeadsBySearch,
    searchId && !isTempId(searchId) ? { searchId } : "skip",
  );

  const leads = leadsResult || [];

  const updateLeadMutation = useMutation(api.leads.mutations.updateLead);
  const updateLeadStatusMutation = useMutation(
    api.leads.mutations.updateLeadStatus,
  );
  const addLeadNotesMutation = useMutation(api.leads.mutations.addLeadNotes);
  const deleteLeadMutation = useMutation(api.leads.mutations.deleteLead);

  const [optimisticLeads, setOptimisticLeads] = useState<Lead[]>(leads);

  useEffect(() => {
    setOptimisticLeads(leads);
  }, [leads]);

  const updateOptimisticLeads = (
    updater: Lead[] | ((prev: Lead[]) => Lead[]),
  ) => {
    setOptimisticLeads((prev) =>
      typeof updater === "function" ? (updater as (p: Lead[]) => Lead[])(prev) : updater,
    );
  };

  useEffect(() => {
    if (leads && leads.length > 0) {
      logger.debug("Leads loaded", {
        searchId,
        count: leads.length,
        statuses: leads.reduce(
          (acc, lead) => {
            acc[lead.status] = (acc[lead.status] || 0) + 1;
            return acc;
          },
          {} as Record<string, number>,
        ),
      });
    }
  }, [leads, searchId]);

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

export function useUserLeadsBase() {
  const leads = useQuery(api.leads.queries.getUserLeads);
  const stats = useQuery(api.leads.queries.getLeadStats);

  return {
    leads,
    stats,
    isLoading: leads === undefined,
  };
}

export type UseUserLeadsResult = ReturnType<typeof useUserLeadsBase>;

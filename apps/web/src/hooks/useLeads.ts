import { useQuery, useMutation } from "convex/react";
import { api } from "@genni/convex-types"
import type { Id } from "@genni/convex-types/dataModel";
import { useEffect } from "react";
import { createLogger, timeOperation } from "@/utils/logger";

const logger = createLogger('useLeads');

export function useLeads(searchId?: Id<"searches">) {
  const leadsResult = useQuery(
    api.leads.queries.getLeadsBySearch,
    searchId ? { searchId } : "skip"
  );
  
  const leads = leadsResult?.leads;
  
  const updateLeadMutation = useMutation(api.leads.mutations.updateLead);
  const updateLeadStatusMutation = useMutation(api.leads.mutations.updateLeadStatus);
  const addLeadNotesMutation = useMutation(api.leads.mutations.addLeadNotes);
  const deleteLeadMutation = useMutation(api.leads.mutations.deleteLead);

  useEffect(() => {
    if (leads) {
      logger.debug('Leads loaded', {
        searchId,
        count: leads.length,
        statuses: leads.reduce((acc, lead) => {
          acc[lead.status] = (acc[lead.status] || 0) + 1;
          return acc;
        }, {} as Record<string, number>)
      });
    }
  }, [leads, searchId]);

  const updateLead = async (...args: Parameters<typeof updateLeadMutation>) => {
    logger.info('Updating lead', { leadId: args[0].leadId });
    return timeOperation('updateLead', () => updateLeadMutation(...args));
  };

  const updateLeadStatus = async (...args: Parameters<typeof updateLeadStatusMutation>) => {
    logger.info('Updating lead status', { leadId: args[0].leadId, status: args[0].status });
    return timeOperation('updateLeadStatus', () => updateLeadStatusMutation(...args));
  };

  const addLeadNotes = async (...args: Parameters<typeof addLeadNotesMutation>) => {
    logger.info('Adding lead notes', { leadId: args[0].leadId });
    return timeOperation('addLeadNotes', () => addLeadNotesMutation(...args));
  };

  const deleteLead = async (...args: Parameters<typeof deleteLeadMutation>) => {
    logger.warn('Deleting lead', { leadId: args[0].leadId });
    return timeOperation('deleteLead', () => deleteLeadMutation(...args));
  };
  
  return {
    leads,
    updateLead,
    updateLeadStatus,
    addLeadNotes,
    deleteLead,
    isLoading: leadsResult === undefined && searchId !== undefined,
  };
}

export function useLead(leadId: Id<"leads"> | undefined) {
  const lead = useQuery(
    api.leads.queries.getLead,
    leadId ? { leadId } : "skip"
  );
  
  return {
    lead,
    isLoading: lead === undefined && leadId !== undefined,
  };
}

export function useUserLeads() {
  const leads = useQuery(api.leads.queries.getUserLeads);
  const stats = useQuery(api.leads.queries.getLeadStats);
  
  return {
    leads,
    stats,
    isLoading: leads === undefined,
  };
}
import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

export function useLeads(searchId?: Id<"searches">) {
  const leads = useQuery(
    api.leads.queries.getLeadsBySearch,
    searchId ? { searchId } : "skip"
  );
  
  const updateLead = useMutation(api.leads.mutations.updateLead);
  const updateLeadStatus = useMutation(api.leads.mutations.updateLeadStatus);
  const addLeadNotes = useMutation(api.leads.mutations.addLeadNotes);
  const deleteLead = useMutation(api.leads.mutations.deleteLead);
  
  return {
    leads,
    updateLead,
    updateLeadStatus,
    addLeadNotes,
    deleteLead,
    isLoading: leads === undefined && searchId !== undefined,
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
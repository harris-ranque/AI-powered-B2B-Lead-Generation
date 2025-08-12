import { useAction, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api"
import type { Id } from "@/@/convex/_generated/dataModel";

export function useEmailGeneration() {
  const generateEmail = useAction(api.crewai.actions.generateEmail);
  const analyzeLeads = useAction(api.crewai.actions.analyzeLeads);
  
  return {
    generateEmail,
    analyzeLeads,
  };
}

export function useEmailSequences(leadId?: Id<"leads">) {
  const sequences = useQuery(
    api.leads.queries.getEmailSequences,
    leadId ? { leadId } : "skip"
  );
  
  return {
    sequences,
    isLoading: sequences === undefined && leadId !== undefined,
  };
}

export function useCrewAIRequests() {
  const requests = useQuery(api.crewai.queries.getUserRequests);
  
  return {
    requests,
    isLoading: requests === undefined,
  };
}

export function useCrewAIRequest(requestId: string | undefined) {
  const request = useQuery(
    api.crewai.queries.getRequest,
    requestId ? { requestId } : "skip"
  );
  
  return {
    request,
    isLoading: request === undefined && requestId !== undefined,
  };
}
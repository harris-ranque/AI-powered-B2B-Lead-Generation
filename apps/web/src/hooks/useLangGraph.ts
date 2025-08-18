import { useAction, useQuery } from "convex/react";
import { api } from "@genni/convex-types"
import type { Id } from "@genni/convex-types/dataModel";

export function useEmailGeneration() {
  const generateEmail = useAction(api.langgraph.actions.generateEmail);
  const analyzeLead = useAction(api.langgraph.actions.analyzeLead);
  
  return {
    generateEmail,
    analyzeLead,
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

export function useLangGraphRequests() {
  const requests = useQuery(api.langgraph.queries.getUserRequests);
  
  return {
    requests,
    isLoading: requests === undefined,
  };
}

export function useLangGraphRequest(requestId: string | undefined) {
  const request = useQuery(
    api.langgraph.queries.getRequest,
    requestId ? { requestId } : "skip"
  );
  
  return {
    request,
    isLoading: request === undefined && requestId !== undefined,
  };
}
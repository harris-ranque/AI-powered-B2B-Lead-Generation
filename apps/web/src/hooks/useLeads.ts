import type { Id } from "@genni/convex-types/dataModel";
import { useUserDataMaybe } from "@/contexts/UserDataContext";
import {
  useLeadsBase,
  useLeadBase,
  useUserLeadsBase,
  type UseLeadsResult,
  type UseLeadResult,
  type UseUserLeadsResult,
} from "./base/useLeadsBase";

export { useLeadsBase, useLeadBase, useUserLeadsBase } from "./base/useLeadsBase";
export type { UseLeadsResult, UseLeadResult, UseUserLeadsResult } from "./base/useLeadsBase";

export function useLeads(searchId?: Id<"searches">): UseLeadsResult {
  return useLeadsBase(searchId);
}

export function useLead(leadId: Id<"leads"> | undefined): UseLeadResult {
  return useLeadBase(leadId);
}

export function useUserLeads(): UseUserLeadsResult {
  const context = useUserDataMaybe();
  return context?.userLeads ?? useUserLeadsBase();
}

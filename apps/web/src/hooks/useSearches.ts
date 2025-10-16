import type { Id } from "@genni/convex-types/dataModel";
import { useUserDataMaybe } from "@/contexts/UserDataContext";
import {
  useSearchesBase,
  useSearchBase,
  useGoogleMapsSearchBase,
  type UseSearchesResult,
  type UseSearchResult,
  type UseGoogleMapsSearchResult,
} from "./base/useSearchesBase";

export {
  useSearchesBase,
  useSearchBase,
  useGoogleMapsSearchBase,
} from "./base/useSearchesBase";
export type {
  UseSearchesResult,
  UseSearchResult,
  UseGoogleMapsSearchResult,
} from "./base/useSearchesBase";

export function useSearches(): UseSearchesResult {
  const context = useUserDataMaybe();
  const fallbackSearches = useSearchesBase();
  return context?.searches ?? fallbackSearches;
}

export function useSearch(searchId: Id<"searches"> | undefined): UseSearchResult {
  return useSearchBase(searchId);
}

export function useGoogleMapsSearch(): UseGoogleMapsSearchResult {
  return useGoogleMapsSearchBase();
}

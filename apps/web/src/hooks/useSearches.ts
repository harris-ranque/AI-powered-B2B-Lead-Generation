import type { Id } from "@genni/convex-types/dataModel";
import { useUserDataMaybe } from "@/contexts/UserDataContext";
import {
  useSearchesBase,
  useSearchBase,
  useGoogleMapsSearchBase,
  type UseSearchesResult,
  type UseSearchResult,
  type UseGoogleMapsSearchResult,
  type UseSearchesOptions,
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
  UseSearchesOptions,
} from "./base/useSearchesBase";

export function useSearches(options?: UseSearchesOptions): UseSearchesResult {
  const context = useUserDataMaybe();
  const fallbackSearches = useSearchesBase(options);
  return context?.searches ?? fallbackSearches;
}

export function useSearch(searchId: Id<"searches"> | undefined): UseSearchResult {
  return useSearchBase(searchId);
}

export function useGoogleMapsSearch(): UseGoogleMapsSearchResult {
  return useGoogleMapsSearchBase();
}

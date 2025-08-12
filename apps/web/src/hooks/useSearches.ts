import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "@/convex/_generated/api"
import type { Id } from "@/@/convex/_generated/dataModel";

export function useSearches() {
  const searches = useQuery(api.search.queries.getUserSearches);
  const createSearch = useMutation(api.search.mutations.createSearch);
  const updateSearchStatus = useMutation(api.search.mutations.updateSearchStatus);
  const updateSearchProgress = useMutation(api.search.mutations.updateSearchProgress);
  const cancelSearch = useMutation(api.search.mutations.cancelSearch);
  const deleteSearch = useMutation(api.search.mutations.deleteSearch);
  const duplicateSearch = useMutation(api.search.mutations.duplicateSearch);
  
  return {
    searches,
    createSearch,
    updateSearchStatus,
    updateSearchProgress,
    cancelSearch,
    deleteSearch,
    duplicateSearch,
    isLoading: searches === undefined,
  };
}

export function useSearch(searchId: Id<"searches"> | undefined) {
  const search = useQuery(
    api.search.queries.getSearch,
    searchId ? { searchId } : "skip"
  );
  
  return {
    search,
    isLoading: search === undefined && searchId !== undefined,
  };
}

export function useGoogleMapsSearch() {
  const searchGoogleMaps = useAction(api.search.actions.searchGoogleMaps);
  
  return {
    searchGoogleMaps,
  };
}
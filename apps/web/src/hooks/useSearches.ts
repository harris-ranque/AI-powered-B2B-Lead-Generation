import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "@/convex/_generated/api"
import type { Id } from "@/@/convex/_generated/dataModel";
import { useEffect } from "react";
import { createLogger, timeOperation } from "@/utils/logger";

const logger = createLogger('useSearches');

export function useSearches() {
  const searches = useQuery(api.search.queries.getUserSearches);
  const createSearchMutation = useMutation(api.search.mutations.createSearch);
  const updateSearchStatusMutation = useMutation(api.search.mutations.updateSearchStatus);
  const updateSearchProgressMutation = useMutation(api.search.mutations.updateSearchProgress);
  const cancelSearchMutation = useMutation(api.search.mutations.cancelSearch);
  const deleteSearchMutation = useMutation(api.search.mutations.deleteSearch);
  const duplicateSearchMutation = useMutation(api.search.mutations.duplicateSearch);

  useEffect(() => {
    if (searches) {
      logger.debug('Searches loaded', {
        count: searches.length,
        statuses: searches.reduce((acc, search) => {
          acc[search.status] = (acc[search.status] || 0) + 1;
          return acc;
        }, {} as Record<string, number>)
      });
    }
  }, [searches]);

  const createSearch = async (...args: Parameters<typeof createSearchMutation>) => {
    logger.info('Creating new search', { query: args[0].query, location: args[0].location });
    return timeOperation('createSearch', () => createSearchMutation(...args));
  };

  const updateSearchStatus = async (...args: Parameters<typeof updateSearchStatusMutation>) => {
    logger.info('Updating search status', { searchId: args[0].searchId, status: args[0].status });
    return timeOperation('updateSearchStatus', () => updateSearchStatusMutation(...args));
  };

  const updateSearchProgress = async (...args: Parameters<typeof updateSearchProgressMutation>) => {
    logger.debug('Updating search progress', { searchId: args[0].searchId, progress: args[0].progress });
    return timeOperation('updateSearchProgress', () => updateSearchProgressMutation(...args));
  };

  const cancelSearch = async (...args: Parameters<typeof cancelSearchMutation>) => {
    logger.warn('Cancelling search', { searchId: args[0].searchId });
    return timeOperation('cancelSearch', () => cancelSearchMutation(...args));
  };

  const deleteSearch = async (...args: Parameters<typeof deleteSearchMutation>) => {
    logger.warn('Deleting search', { searchId: args[0].searchId });
    return timeOperation('deleteSearch', () => deleteSearchMutation(...args));
  };

  const duplicateSearch = async (...args: Parameters<typeof duplicateSearchMutation>) => {
    logger.info('Duplicating search', { searchId: args[0].searchId });
    return timeOperation('duplicateSearch', () => duplicateSearchMutation(...args));
  };
  
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
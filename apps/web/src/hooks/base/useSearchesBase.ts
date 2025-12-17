import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "@genni/convex-types";
import type { Id } from "@genni/convex-types/dataModel";
import { useEffect, useCallback, useState } from "react";
import { createLogger, timeOperation } from "@/utils/logger";
import type { Search } from "@/lib/types";

const logger = createLogger("useSearches");

export function useSearchesBase() {
  const searches = useQuery(api.search.queries.getUserSearches);

  const createSearchMutation = useMutation(
    api.search.mutations.createSearchCompleted,
  );
  const updateSearchStatusMutation = useMutation(
    api.search.mutations.updateSearchStatus,
  );
  const updateSearchProgressMutation = useMutation(
    api.search.mutations.updateSearchProgress,
  );
  const cancelSearchMutation = useMutation(api.search.mutations.cancelSearch);
  const deleteSearchMutation = useMutation(api.search.mutations.deleteSearch);
  const duplicateSearchMutation = useMutation(
    api.search.mutations.duplicateSearch,
  );

  const [optimisticSearches, setOptimisticSearches] = useState<Search[]>(
    searches?.searches || [],
  );

  useEffect(() => {
    if (searches?.searches) {
      setOptimisticSearches(searches.searches);
    }
  }, [searches?.searches]);

  const updateOptimisticSearches = (
    updater: Search[] | ((prev: Search[]) => Search[]),
  ) => {
    setOptimisticSearches((prev) =>
      typeof updater === "function" ? (updater as (p: Search[]) => Search[])(prev) : updater,
    );
  };

  useEffect(() => {
    if (searches?.searches) {
      logger.debug("Searches loaded", {
        count: searches.searches.length,
        statuses: searches.searches.reduce(
          (acc, search) => {
            acc[search.status] = (acc[search.status] || 0) + 1;
            return acc;
          },
          {} as Record<string, number>,
        ),
      });
    }
  }, [searches]);

  const createSearch = useCallback(async (
    ...args: Parameters<typeof createSearchMutation>
  ) => {
    logger.info("Creating new search (autoStart may schedule orchestration)");

    const tempId = `temp_${Date.now()}` as Id<"searches">;
    const optimisticSearch = {
      _id: tempId,
      userId: "" as Id<"users">,
      status: "pending" as const,
      parameters: args[0],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      progress: { discovered: 0, enriched: 0, analyzed: 0, total: 0 },
    };

    updateOptimisticSearches((prev) => [optimisticSearch, ...prev]);

    try {
      const result = await timeOperation("createSearch", () => createSearchMutation(...args));
      return result;
    } catch (error) {
      const errorObj = error instanceof Error ? error : new Error(String(error));
      logger.error("Failed to create search", { parameters: args[0] }, errorObj);
      updateOptimisticSearches((prev) => prev.filter((s) => s._id !== tempId));
      throw error;
    }
  }, [createSearchMutation, updateOptimisticSearches]);

  const updateSearchStatus = useCallback(async (
    ...args: Parameters<typeof updateSearchStatusMutation>
  ) => {
    const { searchId, status } = args[0];
    logger.info("Updating search status", { searchId, status });

    updateOptimisticSearches((prev) =>
      prev.map((search) =>
        search._id === searchId
          ? { ...search, status, updatedAt: Date.now() }
          : search,
      ),
    );

    try {
      return await timeOperation("updateSearchStatus", () =>
        updateSearchStatusMutation(...args),
      );
    } catch (error) {
      logger.error("Failed to update search status, server will correct", error);
      throw error;
    }
  }, [updateSearchStatusMutation, updateOptimisticSearches]);

  const updateSearchProgress = useCallback(async (
    ...args: Parameters<typeof updateSearchProgressMutation>
  ) => {
    const { searchId, progress } = args[0];
    logger.debug("Updating search progress", { searchId, progress });

    updateOptimisticSearches((prev) =>
      prev.map((search) =>
        search._id === searchId
          ? { ...search, progress, updatedAt: Date.now() }
          : search,
      ),
    );

    try {
      return await timeOperation("updateSearchProgress", () =>
        updateSearchProgressMutation(...args),
      );
    } catch (error) {
      logger.debug("Progress update failed, server will correct", error);
      throw error;
    }
  }, [updateSearchProgressMutation, updateOptimisticSearches]);

  const cancelSearch = useCallback(async (
    ...args: Parameters<typeof cancelSearchMutation>
  ) => {
    const { searchId } = args[0];
    logger.warn("Cancelling search", { searchId });

    updateOptimisticSearches((prev) =>
      prev.map((search) =>
        search._id === searchId
          ? { ...search, status: "cancelled" as const, updatedAt: Date.now() }
          : search,
      ),
    );

    try {
      return await timeOperation("cancelSearch", () => cancelSearchMutation(...args));
    } catch (error) {
      const errorObj = error instanceof Error ? error : new Error(String(error));
      logger.error("Failed to cancel search", { searchId }, errorObj);
      updateOptimisticSearches((prev) =>
        prev.map((search) =>
          search._id === searchId
            ? { ...search, status: "in_progress" as const }
            : search,
        ),
      );
      throw error;
    }
  }, [cancelSearchMutation, updateOptimisticSearches]);

  const deleteSearch = useCallback(async (
    ...args: Parameters<typeof deleteSearchMutation>
  ) => {
    const { searchId } = args[0];
    logger.warn("Deleting search", { searchId });

    const originalSearches = optimisticSearches;
    updateOptimisticSearches((prev) => prev.filter((s) => s._id !== searchId));

    try {
      return await timeOperation("deleteSearch", () => deleteSearchMutation(...args));
    } catch (error) {
      const errorObj = error instanceof Error ? error : new Error(String(error));
      logger.error("Failed to delete search", { searchId }, errorObj);
      updateOptimisticSearches(originalSearches);
      throw error;
    }
  }, [deleteSearchMutation, updateOptimisticSearches, optimisticSearches]);

  const duplicateSearch = useCallback(async (
    ...args: Parameters<typeof duplicateSearchMutation>
  ) => {
    const { searchId } = args[0];
    logger.info("Duplicating search", { searchId });

    const originalSearch = optimisticSearches.find((s) => s._id === searchId);
    if (originalSearch) {
      const tempId = `temp_dup_${Date.now()}` as Id<"searches">;
      const duplicatedSearch = {
        ...originalSearch,
        _id: tempId,
        status: "pending" as const,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        progress: { discovered: 0, enriched: 0, analyzed: 0, total: 0 },
      };

      updateOptimisticSearches((prev) => [duplicatedSearch, ...prev]);

      try {
        const result = await timeOperation("duplicateSearch", () =>
          duplicateSearchMutation(...args),
        );
        return result;
      } catch (error) {
        const errorObj = error instanceof Error ? error : new Error(String(error));
        logger.error("Failed to duplicate search", { searchId }, errorObj);
        updateOptimisticSearches((prev) => prev.filter((s) => s._id !== tempId));
        throw error;
      }
    } else {
      return timeOperation("duplicateSearch", () =>
        duplicateSearchMutation(...args),
      );
    }
  }, [duplicateSearchMutation, updateOptimisticSearches, optimisticSearches]);

  return {
    searches: optimisticSearches,
    createSearch,
    updateSearchStatus,
    updateSearchProgress,
    cancelSearch,
    deleteSearch,
    duplicateSearch,
    isLoading: searches === undefined,
  };
}

export type UseSearchesResult = ReturnType<typeof useSearchesBase>;

export function useSearchBase(searchId: Id<"searches"> | undefined) {
  const search = useQuery(
    api.search.queries.getSearch,
    searchId ? { searchId } : "skip",
  );

  return {
    search,
    isLoading: search === undefined && searchId !== undefined,
  };
}

export type UseSearchResult = ReturnType<typeof useSearchBase>;

export function useGoogleMapsSearchBase() {
  const searchGoogleMaps = useAction(api.search.actions.searchGoogleMaps);

  return {
    searchGoogleMaps,
  };
}

export type UseGoogleMapsSearchResult = ReturnType<typeof useGoogleMapsSearchBase>;

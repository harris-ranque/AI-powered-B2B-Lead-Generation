import { useAction } from "convex/react";
import { api } from "@genni/convex-types";
import { createLogger, timeOperation } from "@/utils/logger";

const logger = createLogger("usePlaces");

interface PlacePrediction {
  placeId: string;
  description: string;
  mainText: string;
  secondaryText?: string | null;
  types: string[];
}

interface PlaceDetails {
  placeId: string;
  name?: string | null;
  formattedAddress?: string | null;
  geometry?: {
    location: {
      lat: number;
      lng: number;
    };
  } | null;
  types: string[];
}

export function usePlaces() {
  const getPlacePredictionsAction = useAction(
    api.places.actions.getPlacePredictions,
  );
  const getPlaceDetailsAction = useAction(api.places.actions.getPlaceDetails);

  const getPlacePredictions = async (
    input: string,
    options?: {
      types?: string[];
      location?: string;
      radius?: number;
    },
  ): Promise<PlacePrediction[]> => {
    if (!input.trim()) {
      return [];
    }

    logger.info("Getting place predictions", {
      input: input.substring(0, 100),
      options,
    });

    try {
      const result = await timeOperation("getPlacePredictions", () =>
        getPlacePredictionsAction({
          input,
          types: options?.types,
          location: options?.location,
          radius: options?.radius,
        }),
      );

      if (result.success) {
        logger.debug("Place predictions retrieved", {
          count: result.predictions.length,
          input: input.substring(0, 50),
        });
        return result.predictions;
      } else {
        logger.error("Failed to get place predictions", {
          error: result.error,
          input: input.substring(0, 50),
        });
        throw new Error(result.error || "Failed to get place predictions");
      }
    } catch (error) {
      logger.error("Place predictions request failed", {
        error: error instanceof Error ? error.message : "Unknown error",
        input: input.substring(0, 50),
      });
      throw error;
    }
  };

  const getPlaceDetails = async (
    placeId: string,
    fields?: string[],
  ): Promise<PlaceDetails> => {
    if (!placeId.trim()) {
      throw new Error("Place ID is required");
    }

    logger.info("Getting place details", { placeId, fields });

    try {
      const result = await timeOperation("getPlaceDetails", () =>
        getPlaceDetailsAction({
          placeId,
          fields,
        }),
      );

      if (result.success && result.place) {
        logger.debug("Place details retrieved", {
          placeId,
          name: result.place.name,
        });
        return result.place;
      } else {
        logger.error("Failed to get place details", {
          error: result.error,
          placeId,
        });
        throw new Error(result.error || "Failed to get place details");
      }
    } catch (error) {
      logger.error("Place details request failed", {
        error: error instanceof Error ? error.message : "Unknown error",
        placeId,
      });
      throw error;
    }
  };

  return {
    getPlacePredictions,
    getPlaceDetails,
  };
}

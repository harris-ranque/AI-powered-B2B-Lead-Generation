import { useEffect } from "react";
import { LeadEternityDashboard } from "./LeadEternityDashboard";
import { ConvexErrorBoundary } from "./ConvexErrorBoundary";
import { useLogger } from "@/utils/logger";

export function GenniApp() {
  const logger = useLogger("GenniApp");

  useEffect(() => {
    logger.componentMount("GenniApp");
    logger.info("GenniApp initialized");

    return () => {
      logger.componentUnmount("GenniApp");
    };
  }, []); // Empty deps - logger is now stable via useMemo

  return (
    <div className="min-h-screen bg-background">
      <ConvexErrorBoundary
        onError={(error) => logger.error("Dashboard error", error)}
      >
        <LeadEternityDashboard />
      </ConvexErrorBoundary>
    </div>
  );
}

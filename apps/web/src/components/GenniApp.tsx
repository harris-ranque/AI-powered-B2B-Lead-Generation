import { useEffect } from "react";
import { LeadEternityDashboard } from "./LeadEternityDashboard";
import { useLogger } from "@/utils/logger";

export function GenniApp() {
  const logger = useLogger('GenniApp');

  useEffect(() => {
    logger.componentMount('GenniApp');
    logger.info('GenniApp initialized');
    
    return () => {
      logger.componentUnmount('GenniApp');
    };
  }, [logger]);

  return (
    <div className="min-h-screen bg-background">
      <LeadEternityDashboard />
    </div>
  );
}
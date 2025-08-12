import { useState, useEffect } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GenniSidebar } from "./GenniSidebar";
import { GenniLeadSearch } from "./GenniLeadSearch";
import { Dashboard } from "./Dashboard";
import { BusinessProfile } from "./BusinessProfile";
import { EmailStudio } from "./EmailStudio";
import { SearchHistory } from "./SearchHistory";
import { Performance } from "./Performance";
import { Settings } from "./Settings";
import { LeadEternityDashboard } from "./LeadEternityDashboard";
import { useLogger } from "@/utils/logger";

export function GenniApp() {
  const [currentPage, setCurrentPage] = useState("genni");
  const logger = useLogger('GenniApp');

  useEffect(() => {
    logger.componentMount('GenniApp');
    logger.info('GenniApp initialized', { initialPage: currentPage });
    
    return () => {
      logger.componentUnmount('GenniApp');
    };
  }, []);

  useEffect(() => {
    logger.userAction('Page navigation', { 
      newPage: currentPage,
      timestamp: new Date().toISOString()
    });
  }, [currentPage]);

  const renderPage = () => {
    logger.debug('Rendering page', { currentPage });
    switch (currentPage) {
      case "genni":
        return <LeadEternityDashboard />;
      case "lead-search":
        return <GenniLeadSearch />;
      case "email-studio":
        return <EmailStudio />;
      case "dashboard":
        return <Dashboard />;
      case "business-profile":
        return <BusinessProfile />;
      case "search-history":
        return <SearchHistory />;
      case "performance":
        return <Performance />;
      case "settings":
        return <Settings />;
      default:
        return <LeadEternityDashboard />;
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {currentPage === "genni" ? (
        <LeadEternityDashboard />
      ) : (
        <>
          <GenniSidebar currentPage={currentPage} onPageChange={setCurrentPage} />
          <div className="lg:ml-64">
            {renderPage()}
          </div>
        </>
      )}
    </div>
  );
}
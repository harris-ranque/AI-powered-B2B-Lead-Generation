import { useState } from "react";
import { Sidebar } from "./Sidebar";
import { SearchPage } from "./SearchPage";
import { LeadsPage } from "./LeadsPage";
import { TemplatesPage } from "./TemplatesPage";
import { ActivityPanel } from "./ActivityPanel";

export function LeadGenApp() {
  const [currentPage, setCurrentPage] = useState("search");

  const renderPage = () => {
    switch (currentPage) {
      case "search":
        return <SearchPage />;
      case "leads":
        return <LeadsPage />;
      case "templates":
        return <TemplatesPage />;
      case "analytics":
        return (
          <div className="space-y-8">
            <div className="space-y-2">
              <h1 className="text-3xl font-bold">Analytics</h1>
              <p className="text-muted-foreground text-lg">
                Track your lead generation performance
              </p>
            </div>
            <div className="text-center py-12 text-muted-foreground">
              Analytics dashboard coming soon...
            </div>
          </div>
        );
      case "settings":
        return (
          <div className="space-y-8">
            <div className="space-y-2">
              <h1 className="text-3xl font-bold">Settings</h1>
              <p className="text-muted-foreground text-lg">
                Configure your account preferences
              </p>
            </div>
            <div className="text-center py-12 text-muted-foreground">
              Settings panel coming soon...
            </div>
          </div>
        );
      case "billing":
        return (
          <div className="space-y-8">
            <div className="space-y-2">
              <h1 className="text-3xl font-bold">Billing</h1>
              <p className="text-muted-foreground text-lg">
                Manage your subscription and billing
              </p>
            </div>
            <div className="text-center py-12 text-muted-foreground">
              Billing dashboard coming soon...
            </div>
          </div>
        );
      default:
        return <SearchPage />;
    }
  };

  return (
    <div className="relative min-h-screen">
      <Sidebar currentPage={currentPage} onPageChange={setCurrentPage} />
      
      <div className="lg:ml-64">
        <div className="flex h-screen">
          {/* Main Content */}
          <div className="flex-1 overflow-y-auto p-8">
            {renderPage()}
          </div>
          
          {/* Activity Panel */}
          <div className="hidden xl:block w-80 border-l border-border overflow-y-auto p-6 bg-muted/5">
            <ActivityPanel />
          </div>
        </div>
      </div>
    </div>
  );
}
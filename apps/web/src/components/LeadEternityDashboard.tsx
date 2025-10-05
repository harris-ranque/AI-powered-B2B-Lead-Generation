import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Search,
  BarChart3,
  Settings,
  Bot,
  Sparkles,
  UserCheck,
  Building2,
  Activity,
  Menu,
  AlertTriangle,
} from "lucide-react";
import { PipelineOrchestrator } from "./pipeline/PipelineOrchestrator";
import { PipelineProvider, usePipeline } from "@/pipeline/context";
import { LeadSearchHistory } from "./LeadSearchHistory";
import { BusinessProfileWizard } from "./BusinessProfileWizard";
import { AdminDashboard } from "./AdminDashboard";
import { DashboardHelpWidget } from "./DashboardHelpWidget";
import { Settings as SettingsComponent } from "./Settings";
import {
  DashboardOverview,
  type LeadStatsSummary,
  type UsageSummary,
} from "./DashboardOverview";
import { PerformanceWorkspace } from "./PerformanceWorkspace";
import type { PlanType } from "@/lib/pricing-config";
import type {
  Lead,
  BusinessProfileInput,
} from "@/lib/api-client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { useCredits, useBilling } from "@/hooks/useBilling";
import { useLangGraphRequests } from "@/hooks/useLangGraph";
import { useSearches } from "@/hooks/useSearches";
import { useUserLeads } from "@/hooks/useLeads";
import { UserDataProvider } from "@/contexts/UserDataContext";
import {
  safeTransformEmailRequests,
  isValidTabName,
} from "@/utils/typeValidation";
import { ToastAction } from "@/components/ui/toast";
import { ClerkUserButton } from "@/components/auth/ClerkAuthWrapper";
import { withErrorBoundary } from "@/utils/errorHandling";
import { createLogger } from "@/utils/logger";

const leadDashboardLogger = createLogger("LeadEternityDashboard");

function LeadEternityDashboardContent() {
  const [currentTab, setCurrentTab] = useState("overview");
  const completionAnnouncedRef = useRef(false);
  const [componentError, setComponentError] = useState<string | null>(null);

  const handleComponentError = useCallback(
    (error: unknown, context: string, extra?: Record<string, unknown>) => {
      const errorInstance =
        error instanceof Error ? error : new Error(String(error));

      leadDashboardLogger.error(
        `Lead Eternity dashboard error: ${context}`,
        extra,
        errorInstance,
      );
      setComponentError(`${context}: ${errorInstance.message}`);
    },
    [],
  );

  const dismissComponentError = useCallback(() => {
    setComponentError(null);
  }, []);

  // Real backend integration
  const { user } = useAuth();
  const {
    profile,
    isComplete: hasCompletedOnboarding,
    isLoading: isProfileLoading,
  } = useProfile();
  const { balance } = useCredits();
  // Prevent flashing 0 credits during initial load by falling back to live Convex user data
  const userCredits = (balance?.credits ?? user?.credits) || 0;
  const { purchaseCredits, usage } = useBilling();
  const { requests: emailRequests } = useLangGraphRequests();
  const { searches } = useSearches();
  const { stats: leadStats } = useUserLeads();

  // Derive user plan from user data
  const userPlan = user?.plan || "free";
  const isAdmin = user?.role === "admin" || user?.isAdmin === true;

  const { state, setEmails, markStageComplete, setStage } = usePipeline();

  const transformedEmails = useMemo(() => {
    try {
      return safeTransformEmailRequests(emailRequests);
    } catch (error) {
      handleComponentError(error, "transform-email-requests", {
        requestCount: emailRequests?.page?.length,
      });
      return [];
    }
  }, [emailRequests, handleComponentError]);

  const { toast } = useToast();

  const hasEmailPage = useMemo(() => {
    try {
      return (
        emailRequests &&
        typeof emailRequests === "object" &&
        emailRequests !== null &&
        Array.isArray((emailRequests as Record<string, unknown>).page)
      );
    } catch (error) {
      handleComponentError(error, "derive-email-page-state");
      return false;
    }
  }, [emailRequests, handleComponentError]);

  useEffect(() => {
    try {
      if (transformedEmails.length === 0) {
        completionAnnouncedRef.current = false;
        if (hasEmailPage && state.generatedEmails.length > 0) {
          setEmails([]);
        }
        return;
      }

      const hasDifferences =
        transformedEmails.length !== state.generatedEmails.length ||
        transformedEmails.some((email, index) => {
          const existing = state.generatedEmails[index];
          if (!existing) return true;
          if (email.requestId && existing.requestId) {
            return email.requestId !== existing.requestId;
          }
          return (
            existing.primary_email.subject !== email.primary_email.subject ||
            existing.primary_email.body !== email.primary_email.body
          );
        });

      if (hasDifferences) {
        setEmails(transformedEmails);
      }

      if (!state.completedStages.includes("email_generation")) {
        markStageComplete("email_generation");
      }

      if (
        state.currentStage === "email_generation" &&
        !state.completedStages.includes("review_export")
      ) {
        setStage("review_export");
      }

      if (!completionAnnouncedRef.current) {
        completionAnnouncedRef.current = true;
        setCurrentTab("search-history");
        toast({
          title: "Personalized emails ready",
          description:
            "We generated new outreach emails. Review them in Search History or export a CSV.",
          action: (
            <ToastAction
              altText="Open search history"
              onClick={() => setCurrentTab("search-history")}
            >
              View history
            </ToastAction>
          ),
        });
      }
    } catch (error) {
      handleComponentError(error, "sync-generated-emails", {
        generatedEmails: state.generatedEmails.length,
        transformedEmails: transformedEmails.length,
      });
    }
  }, [
    handleComponentError,
    hasEmailPage,
    markStageComplete,
    setEmails,
    setStage,
    state.completedStages,
    state.currentStage,
    state.generatedEmails,
    toast,
    transformedEmails,
  ]);

  const pipelineEmails = state.generatedEmails;

  const normalizedPlan = useMemo<PlanType>(() => {
    switch (userPlan) {
      case "free":
      case "starter":
        return "starter";
      case "pro":
      case "professional":
        return "professional";
      case "business":
        return "business";
      case "enterprise":
        return "enterprise";
      default:
        return "starter";
    }
  }, [userPlan]);

  const monthlySearchCount = useMemo(() => {
    if (!searches) return 0;
    const now = new Date();
    return searches.filter((search) => {
      if (!search._creationTime) return false;
      const createdAt = new Date(search._creationTime);
      return (
        createdAt.getMonth() === now.getMonth() &&
        createdAt.getFullYear() === now.getFullYear()
      );
    }).length;
  }, [searches]);

  const usageSummary: UsageSummary = useMemo(
    () => ({
      currentPeriodUsage: usage?.currentPeriodUsage || 0,
      totalCreditsUsed: usage?.totalCreditsUsed || 0,
      searchesThisMonth: monthlySearchCount,
      leadsGenerated: leadStats?.totalLeads || 0,
      emailsGenerated: pipelineEmails.length,
      avgCostPerLead: usage?.avgCostPerLead || 0,
    }),
    [leadStats?.totalLeads, monthlySearchCount, pipelineEmails.length, usage],
  );

  const leadStatsSummary: LeadStatsSummary | null = useMemo(() => {
    if (!leadStats) return null;
    return {
      totalLeads: leadStats.totalLeads,
      withEmails: leadStats.withEmails,
      thisWeek: leadStats.thisWeek,
    };
  }, [leadStats]);

  const handleTabChange = useCallback(
    (newTab: string) => {
      const normalizedTab =
        newTab === "credits" || newTab === "dashboard"
          ? "performance"
          : newTab;

      if (isValidTabName(normalizedTab)) {
        leadDashboardLogger.info("Tab changed", { newTab: normalizedTab });
        setCurrentTab(normalizedTab);
        return;
      }

      handleComponentError(
        new Error(`Invalid tab name: ${newTab}`),
        "handle-tab-change",
        { newTab },
      );
      setCurrentTab("overview");
    },
    [handleComponentError],
  );

  const handleGenerateEmail = useCallback(
    (lead: Lead) => {
      try {
        toast({
          title: "Lead Selected",
          description: `${lead.company_name} selected. Email preview is not available here.`,
        });
        leadDashboardLogger.info("Lead selected", {
          company: lead.company_name,
        });
      } catch (error) {
        handleComponentError(error, "handle-generate-email", {
          company: lead.company_name,
        });
      }
    },
    [handleComponentError, toast],
  );

  const handleCompleteOnboarding = useCallback(
    (profileData: BusinessProfileInput) => {
      try {
        handleTabChange("overview");
        toast({
          title: "Welcome to Genni!",
          description:
            "Your business profile has been saved. You're ready to start generating leads!",
        });
        leadDashboardLogger.info("Onboarding completed", {
          businessName: profileData.businessName,
        });
      } catch (error) {
        handleComponentError(error, "handle-complete-onboarding");
      }
    },
    [handleComponentError, handleTabChange, toast],
  );

  const handleSkipOnboarding = useCallback(() => {
    try {
      handleTabChange("overview");
      toast({
        title: "Onboarding Skipped",
        description: "You can complete your business profile later in Settings.",
      });
      leadDashboardLogger.info("Onboarding skipped");
    } catch (error) {
      handleComponentError(error, "handle-skip-onboarding");
    }
  }, [handleComponentError, handleTabChange, toast]);

  const handleUpgradePlan = (planId: string) => {
    // In real app, this would integrate with Stripe
    toast({
      title: "Upgrade Plan",
      description: `Upgrading to ${planId} plan...`,
    });
  };

  const handlePurchaseCredits = useCallback(
    async (amount: number) => {
      try {
        const res = await purchaseCredits({
          credits: amount,
          successUrl: `${window.location.origin}/dashboard?credits_purchased=true`,
          cancelUrl: `${window.location.origin}/dashboard`,
        });
        if (res?.url) {
          window.location.href = res.url;
        } else {
          toast({
            title: "Purchase Started",
            description: `Continue checkout in the opened window.`,
          });
        }
      } catch (error) {
        handleComponentError(error, "handle-purchase-credits", { amount });
        toast({
          title: "Purchase Failed",
          description: "Failed to start purchase. Please try again.",
          variant: "destructive",
        });
      }
    },
    [handleComponentError, purchaseCredits, toast],
  );

  // Avoid flashing onboarding while loading profile
  if (isProfileLoading) {
    return <div className="min-h-screen bg-background" />;
  }

  // Show onboarding if not completed (after loading)
  if (!hasCompletedOnboarding) {
    return (
      <div className="min-h-screen bg-background">
        <BusinessProfileWizard
          onComplete={handleCompleteOnboarding}
          onSkip={handleSkipOnboarding}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {componentError && (
        <div className="px-6 pt-6">
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="flex items-center justify-between gap-4">
              <span>{componentError}</span>
              <Button size="sm" variant="outline" onClick={dismissComponentError}>
                Dismiss
              </Button>
            </AlertDescription>
          </Alert>
        </div>
      )}
      <div className="border-b border-border bg-card">
        <div className="flex items-center px-6 py-4">
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              <Bot className="h-8 w-8 text-primary" />
              <div>
                <h1 className="text-xl font-bold">Genni</h1>
                <p className="text-xs text-muted-foreground">
                  AI-Powered Lead Generation
                </p>
              </div>
            </div>
            <Button
              data-testid="mobile-menu-button"
              variant="outline"
              size="icon"
              className="md:hidden"
              aria-label="Toggle navigation"
            >
              <Menu className="h-4 w-4" />
            </Button>
          </div>

          <div className="ml-auto flex flex-col items-end gap-4 text-right">
            <div className="flex items-center gap-4">
              <Badge variant="secondary" className="bg-green-100 text-green-800">
                <Sparkles className="mr-1 h-3 w-3" />
                AI System Active
              </Badge>

              <div className="text-right text-sm">
                <div className="font-medium">5 AI Agents</div>
                <div className="text-xs text-muted-foreground">
                  Ready for personalization
                </div>
              </div>

              <ClerkUserButton />
            </div>
          </div>
        </div>
      </div>

      <div className="flex">
        <div className="w-64 border-r border-border bg-card flex flex-col">
          <nav className="space-y-2 p-4 flex-1">
            <Button
              variant={currentTab === "overview" ? "default" : "ghost"}
              className="w-full justify-start"
              onClick={() => handleTabChange("overview")}
            >
              <Sparkles className="mr-2 h-4 w-4" />
              Dashboard Overview
            </Button>

            <Button
              variant={currentTab === "pipeline" ? "default" : "ghost"}
              className="w-full justify-start"
              onClick={() => handleTabChange("pipeline")}
            >
              <Search className="mr-2 h-4 w-4" />
              Lead Pipeline
            </Button>

            <Button
              variant={currentTab === "search-history" ? "default" : "ghost"}
              className="w-full justify-start"
              onClick={() => handleTabChange("search-history")}
            >
              <Activity className="mr-2 h-4 w-4" />
              Search History
            </Button>

            <Button
              variant={currentTab === "performance" ? "default" : "ghost"}
              className="w-full justify-start"
              onClick={() => handleTabChange("performance")}
            >
              <BarChart3 className="mr-2 h-4 w-4" />
              Performance Workspace
              <Badge variant="secondary" className="ml-auto text-xs">
                {userCredits}
              </Badge>
            </Button>

            <Button
              variant={currentTab === "profile" ? "default" : "ghost"}
              className="w-full justify-start"
              onClick={() => handleTabChange("profile")}
            >
              <Building2 className="mr-2 h-4 w-4" />
              Business Profile
              {!profile?.isComplete && (
                <Badge variant="outline" className="ml-auto text-xs">
                  Setup
                </Badge>
              )}
            </Button>

            <Button
              variant={currentTab === "settings" ? "default" : "ghost"}
              className="w-full justify-start"
              onClick={() => handleTabChange("settings")}
            >
              <Settings className="mr-2 h-4 w-4" />
              Settings
            </Button>

            {isAdmin && (
              <Button
                variant={currentTab === "admin" ? "default" : "ghost"}
                className="w-full justify-start"
                onClick={() => handleTabChange("admin")}
              >
                <UserCheck className="mr-2 h-4 w-4" />
                Admin Dashboard
                <Badge variant="secondary" className="ml-auto text-xs">
                  Admin
                </Badge>
              </Button>
            )}
          </nav>
          <div className="border-t border-border p-4">
            <DashboardHelpWidget />
          </div>
        </div>

        <div className="flex-1">
          {currentTab === "overview" && (
            <div className="p-6">
              <DashboardOverview
                onNavigate={handleTabChange}
                userName={user?.firstName ?? (user as { first_name?: string })?.first_name ?? user?.name}
                businessName={
                  profile?.companyName ||
                  (profile as { businessName?: string } | null)?.businessName ||
                  null
                }
                planId={normalizedPlan}
                credits={userCredits}
                leadStats={leadStatsSummary}
                emailCount={pipelineEmails.length}
                searches={searches}
                usageSummary={usageSummary}
                pipelineStage={state.currentStage}
                hasCompletedProfile={hasCompletedOnboarding}
                hasNewEmails={pipelineEmails.length > 0}
                isAdmin={isAdmin}
              />
            </div>
          )}

          {currentTab === "pipeline" && (
            <div className="p-6">
              <PipelineOrchestrator
                onGenerateEmail={handleGenerateEmail}
                userCredits={userCredits}
                userPlan={userPlan}
              />
            </div>
          )}

          {currentTab === "profile" && (
            <div className="p-6">
              <div className="mb-6">
                <h2 className="mb-2 text-2xl font-bold">Business Profile</h2>
                <p className="text-muted-foreground">
                  Update your business information to improve AI email
                  personalization.
                </p>
              </div>

              <BusinessProfileWizard
                onComplete={() => {
                  toast({
                    title: "Profile Updated",
                    description:
                      "Your business profile has been updated successfully.",
                  });
                }}
                initialData={profile}
                variant="editor"
              />
            </div>
          )}

          {currentTab === "search-history" && (
            <div className="p-6">
              <div className="mb-6">
                <h2 className="mb-2 text-2xl font-bold">Lead Search History</h2>
                <p className="text-muted-foreground">
                  Review past searches, see lead counts, and export CSVs.
                </p>
              </div>
              <LeadSearchHistory />
            </div>
          )}

          {currentTab === "performance" && (
            <div className="p-6">
              <PerformanceWorkspace
                userCredits={userCredits}
                userPlan={normalizedPlan}
                usageSummary={usageSummary}
                leadStats={leadStatsSummary}
                searches={searches}
                emailCount={pipelineEmails.length}
                onNavigate={handleTabChange}
                onUpgradePlan={handleUpgradePlan}
                onPurchaseCredits={handlePurchaseCredits}
              />
            </div>
          )}

          {currentTab === "settings" && (
            <div className="p-6">
              <div className="mb-6">
                <h2 className="mb-2 text-2xl font-bold">Settings</h2>
                <p className="text-muted-foreground">
                  Configure your Genni platform preferences and AI settings.
                </p>
              </div>
              <SettingsComponent />
            </div>
          )}

          {currentTab === "admin" && isAdmin && (
            <div>
              <AdminDashboard />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

LeadEternityDashboardContent.displayName = "LeadEternityDashboardContent";

const LeadEternityDashboardWithBoundary = withErrorBoundary(
  LeadEternityDashboardContent,
  "Lead Eternity dashboard failed to render",
);

export function LeadEternityDashboard() {
  return (
    <PipelineProvider>
      <UserDataProvider>
        <LeadEternityDashboardWithBoundary />
      </UserDataProvider>
    </PipelineProvider>
  );
}

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useLocation } from "react-router-dom";
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
  CreditCard,
  Palette,
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
  type DashboardTabName,
  type LeadStatsSummary,
  type UsageSummary,
} from "./DashboardOverview";
import { PerformanceWorkspace } from "./PerformanceWorkspace";
import { Dashboard } from "./Dashboard";
import { CreditManager } from "./CreditManager";
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
import { applyAppTheme, getStoredAppTheme, type AppThemeKey } from "@/lib/appTheme";

const leadDashboardLogger = createLogger("LeadEternityDashboard");

function LeadEternityDashboardContent() {
  const [currentTab, setCurrentTab] = useState<DashboardTabName>("overview");
  const [currentTheme, setCurrentTheme] = useState<AppThemeKey>("neon-pulse");
  const [hasSkippedOnboarding, setHasSkippedOnboarding] = useState<boolean>(false);
  const location = useLocation();
  const completionAnnouncedRef = useRef(false);
  const isHandlingHashChangeRef = useRef(false);
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

  // Sync theme and onboarding state from localStorage after mount (prevents hydration errors)
  useEffect(() => {
    const storedTheme = getStoredAppTheme();
    setCurrentTheme(storedTheme);
    applyAppTheme(storedTheme);

    const skipped = localStorage.getItem("genni_onboarding_skipped") === "true";
    setHasSkippedOnboarding(skipped);
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

  const hasNewEmails = transformedEmails.length > 0;

  const { toast } = useToast();

  const openSearchHistory = useCallback(() => {
    setCurrentTab("search-history");

    if (typeof window !== "undefined") {
      if (window.location.hash !== "#lead-history") {
        window.location.hash = "lead-history";
      }
    }
  }, [setCurrentTab]);

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
        toast({
          title: "Personalized emails ready",
          description:
            "We generated new outreach emails. Review them in Search History or export a CSV.",
          action: (
            <ToastAction
              altText="Open search history"
              onClick={openSearchHistory}
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
    openSearchHistory,
  ]);

  const pipelineEmails = state.generatedEmails;

  const updateHashForTab = useCallback((tab: string) => {
    if (typeof window === "undefined") return;

    // Prevent hash updates while we're already handling a hash change
    if (isHandlingHashChangeRef.current) {
      return;
    }

    // Set flag to prevent useEffect from responding to our programmatic changes
    isHandlingHashChangeRef.current = true;

    try {
      if (tab === "search-history") {
        if (window.location.hash !== "#lead-history") {
          window.location.hash = "lead-history";
        }
        return;
      }

      // Always clear hash when navigating away from search-history
      if (window.location.hash) {
        const { pathname, search } = window.location;
        if (typeof window.history?.replaceState === "function") {
          window.history.replaceState(null, "", `${pathname}${search}`);
        } else {
          window.location.hash = "";
        }
      }
    } finally {
      // Reset flag after hash update completes
      // Use setTimeout to ensure effect doesn't run during same tick
      setTimeout(() => {
        isHandlingHashChangeRef.current = false;
      }, 50);
    }
  }, []);

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
    (newTab: DashboardTabName | string) => {
      const candidateTab = newTab as string;

      if (isValidTabName(candidateTab)) {
        leadDashboardLogger.info("Tab changed", { newTab: candidateTab });
        setCurrentTab(candidateTab);
        updateHashForTab(candidateTab);
        return;
      }

      handleComponentError(
        new Error(`Invalid tab name: ${newTab}`),
        "handle-tab-change",
        { newTab },
      );
      setCurrentTab("overview");
      updateHashForTab("overview");
    },
    [handleComponentError, updateHashForTab],
  );

  // Clear hash on initial mount to prevent auto-redirects from previous sessions
  useEffect(() => {
    // Only run on mount
    if (window.location.hash === "#lead-history") {
      // Clear the hash without triggering navigation
      if (typeof window.history?.replaceState === "function") {
        const { pathname, search } = window.location;
        window.history.replaceState(null, "", `${pathname}${search}`);
      }
    }
  }, []); // Empty deps - only run once on mount

  // Listen to hash changes only when explicitly set by user actions
  useEffect(() => {
    // Prevent loops - if we're already handling a hash change, skip
    if (isHandlingHashChangeRef.current) {
      return;
    }

    const hash = location.hash ? location.hash.replace(/^#/, "") : "";
    if (!hash) {
      return;
    }

    // Only respond to hash if we're not already on that tab
    if (hash === "lead-history" && currentTab !== "search-history") {
      isHandlingHashChangeRef.current = true;
      handleTabChange("search-history");
      // Reset the flag after a short delay
      setTimeout(() => {
        isHandlingHashChangeRef.current = false;
      }, 100);
    }
  }, [currentTab, handleTabChange, location.hash]);

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
        // Clear skip flag if it was set
        localStorage.removeItem("genni_onboarding_skipped");
        setHasSkippedOnboarding(false);

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

  const handleOverviewNavigate = useCallback(
    (tab: DashboardTabName) => {
      handleTabChange(tab);
    },
    [handleTabChange],
  );

  const handleOpenLeadHistory = useCallback(() => {
    handleTabChange("search-history");
  }, [handleTabChange]);

  const handleSkipOnboarding = useCallback(() => {
    try {
      // Store skip preference in localStorage to bypass onboarding gate
      localStorage.setItem("genni_onboarding_skipped", "true");
      setHasSkippedOnboarding(true);

      handleTabChange("overview");
      toast({
        title: "Onboarding Skipped",
        description: "You can complete your business profile anytime in Settings to unlock full AI personalization.",
        duration: 5000,
      });
      leadDashboardLogger.info("Onboarding skipped - user can access dashboard with incomplete profile");
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

  const handleToggleTheme = useCallback(() => {
    const newTheme: AppThemeKey = currentTheme === "harborlight" ? "neon-pulse" : "harborlight";
    setCurrentTheme(newTheme);
    applyAppTheme(newTheme);
    toast({
      title: "Theme Changed",
      description: `Switched to ${newTheme === "harborlight" ? "Horizon" : "Neon"} theme`,
    });
  }, [currentTheme, toast]);

  // Avoid flashing onboarding while loading profile
  if (isProfileLoading) {
    return <div className="harborlight-shell min-h-screen bg-background" />;
  }

  // Show onboarding if not completed AND not skipped (after loading)
  if (!hasCompletedOnboarding && !hasSkippedOnboarding) {
    return (
      <div className="harborlight-shell min-h-screen bg-background">
        <BusinessProfileWizard
          onComplete={handleCompleteOnboarding}
          onSkip={handleSkipOnboarding}
        />
      </div>
    );
  }

  return (
    <div className="harborlight-shell min-h-screen bg-background">
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
      <div className="harborlight-topbar border-b border-border">
        <div className="harborlight-topbar-inner flex items-center px-6 py-5">
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-3">
              <Bot className="harborlight-logo-icon h-10 w-10" aria-hidden="true" />
              <div>
                <h1 className="text-2xl font-display font-semibold tracking-tight text-foreground">
                  Genni
                </h1>
                <p className="text-[0.65rem] font-medium uppercase tracking-[0.32em] text-muted-foreground opacity-90">
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

          <div className="ml-auto flex items-center gap-3">
            <Badge variant="secondary" className="ai-activity-badge">
              <Sparkles className="ai-badge-icon h-3 w-3" aria-hidden="true" />
              <span>AI System Active</span>
            </Badge>

            <Button
              variant="outline"
              size="sm"
              onClick={handleToggleTheme}
              className="flex items-center gap-2 h-9"
              aria-label={`Switch to ${currentTheme === "harborlight" ? "Neon" : "Horizon"} theme`}
            >
              <Palette className="h-4 w-4" />
              <span className="text-xs font-medium">
                {currentTheme === "harborlight" ? "Horizon" : "Neon"}
              </span>
            </Button>

            <ClerkUserButton />
          </div>
        </div>
      </div>

      <div className="flex">
        <div className="harborlight-sidebar w-64 border-r border-border bg-card flex flex-col">
          <nav className="harborlight-sidebar-nav space-y-2 p-4">
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
              className="harborlight-nav-item w-full justify-start"
              onClick={() => handleTabChange("pipeline")}
            >
              <Search className="mr-2 h-4 w-4" />
              Lead Pipeline
            </Button>

            <Button
              variant={currentTab === "search-history" ? "default" : "ghost"}
              className="harborlight-nav-item w-full justify-start"
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
              Performance & Credits
            </Button>

            <Button
              variant={currentTab === "profile" ? "default" : "ghost"}
              className="harborlight-nav-item w-full justify-start"
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
              className="harborlight-nav-item w-full justify-start"
              onClick={() => handleTabChange("settings")}
            >
              <Settings className="mr-2 h-4 w-4" />
              Settings
            </Button>

            {isAdmin && (
              <Button
                variant={currentTab === "admin" ? "default" : "ghost"}
                className="harborlight-nav-item w-full justify-start"
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

        <div className="harborlight-main flex-1">
          {currentTab === "overview" && (
            <div className="p-6">
              <DashboardOverview
                onNavigate={(tab) => handleTabChange(tab)}
                userName={user?.name || profile?.contactInfo?.name || undefined}
                businessName={profile?.companyName ?? null}
                planId={normalizedPlan}
                credits={userCredits}
                leadStats={leadStatsSummary}
                emailCount={pipelineEmails.length}
                searches={searches ?? []}
                usageSummary={usageSummary}
                pipelineStage={state.currentStage}
                hasCompletedProfile={hasCompletedOnboarding}
                hasNewEmails={hasNewEmails}
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
                onOpenLeadHistory={handleOpenLeadHistory}
                onNavigateToSettings={() => handleTabChange("settings")}
              />
            </div>
          )}

          {currentTab === "profile" && (
            <div className="p-6">
              <div className="mb-6">
                <h2 className="mb-2 text-3xl font-display font-semibold tracking-tight">
                  Business Profile
                </h2>
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
            <div className="p-6" id="lead-history">
              <div className="mb-6">
                <h2 className="mb-2 text-3xl font-display font-semibold tracking-tight">
                  Lead Search History
                </h2>
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
                userCredits={userCredits || 0}
                userPlan={normalizedPlan}
                usageSummary={usageSummary}
                leadStats={leadStatsSummary}
                searches={searches}
                emailCount={pipelineEmails.length}
                onNavigate={handleOverviewNavigate}
                onUpgradePlan={handleUpgradePlan}
                onPurchaseCredits={handlePurchaseCredits}
              />
            </div>
          )}

          {currentTab === "settings" && (
            <div className="p-6">
              <div className="mb-6">
                <h2 className="mb-2 text-3xl font-display font-semibold tracking-tight">
                  Settings
                </h2>
                <p className="text-muted-foreground">
                  Configure your Genni platform preferences and AI settings.
                </p>
              </div>
              <SettingsComponent />
            </div>
          )}

          {currentTab === "admin" && isAdmin && (
            <div>
              <AdminDashboard isAdmin={isAdmin} />
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

import { useState, useEffect, useMemo, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Search,
  Mail,
  BarChart3,
  Settings,
  Bot,
  Sparkles,
  Target,
  Users,
  TrendingUp,
  CheckCircle,
  CreditCard,
  UserCheck,
  Building2,
  Bug,
  Activity,
  Menu,
} from "lucide-react";
import { PipelineOrchestrator } from "./pipeline/PipelineOrchestrator";
import { PipelineProvider, usePipeline } from "@/pipeline/context";
import { LeadSearchHistory } from "./LeadSearchHistory";
import { BusinessProfileWizard } from "./BusinessProfileWizard";
import { CreditManager } from "./CreditManager";
import { AdminDashboard } from "./AdminDashboard";
import { Dashboard } from "./Dashboard";
import { DashboardHelpWidget } from "./DashboardHelpWidget";
import { Settings as SettingsComponent } from "./Settings";
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

export function LeadEternityDashboard() {
  return (
    <PipelineProvider>
      <UserDataProvider>
        <LeadEternityDashboardContent />
      </UserDataProvider>
    </PipelineProvider>
  );
}

function LeadEternityDashboardContent() {
  const [currentTab, setCurrentTab] = useState("pipeline");
  const completionAnnouncedRef = useRef(false);

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

  const transformedEmails = useMemo(
    () => safeTransformEmailRequests(emailRequests),
    [emailRequests],
  );

  const { toast } = useToast();

  const hasEmailPage =
    emailRequests &&
    typeof emailRequests === "object" &&
    emailRequests !== null &&
    Array.isArray((emailRequests as Record<string, unknown>).page);

  useEffect(() => {
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
  }, [
    markStageComplete,
    setEmails,
    setStage,
    state.completedStages,
    state.currentStage,
    state.generatedEmails,
    toast,
    transformedEmails,
    hasEmailPage,
  ]);

  const pipelineEmails = state.generatedEmails;

  const handleTabChange = (newTab: string) => {
    if (isValidTabName(newTab)) {
      setCurrentTab(newTab);
    } else {
      console.warn(`Invalid tab name: ${newTab}. Defaulting to pipeline.`);
      setCurrentTab("pipeline");
    }
  };

  const handleGenerateEmail = (lead: Lead) => {
    // Keep selection (possible future preview usage), no navigation
    toast({
      title: "Lead Selected",
      description: `${lead.company_name} selected. Email preview is not available here.`,
    });
  };

  const handleCompleteOnboarding = (profileData: BusinessProfileInput) => {
    handleTabChange("pipeline"); // Changed from "search" to valid tab
    toast({
      title: "Welcome to Genni!",
      description:
        "Your business profile has been saved. You're ready to start generating leads!",
    });
  };

  const handleSkipOnboarding = () => {
    handleTabChange("pipeline"); // Changed from "search" to valid tab
    toast({
      title: "Onboarding Skipped",
      description: "You can complete your business profile later in Settings.",
    });
  };

  const handleUpgradePlan = (planId: string) => {
    // In real app, this would integrate with Stripe
    toast({
      title: "Upgrade Plan",
      description: `Upgrading to ${planId} plan...`,
    });
  };

  const handlePurchaseCredits = async (amount: number) => {
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
      toast({
        title: "Purchase Failed",
        description: "Failed to start purchase. Please try again.",
        variant: "destructive",
      });
    }
  };

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
            <DashboardHelpWidget />
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
        <div className="w-64 border-r border-border bg-card">
          <nav className="space-y-2 p-4">
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
              variant={currentTab === "credits" ? "default" : "ghost"}
              className="w-full justify-start"
              onClick={() => handleTabChange("credits")}
            >
              <CreditCard className="mr-2 h-4 w-4" />
              Credits & Billing
              <Badge variant="secondary" className="ml-auto text-xs">
                {userCredits}
              </Badge>
            </Button>

            <Button
              variant={currentTab === "dashboard" ? "default" : "ghost"}
              className="w-full justify-start"
              onClick={() => handleTabChange("dashboard")}
            >
              <BarChart3 className="mr-2 h-4 w-4" />
              Analytics
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

          {/* Recent Activity */}
          <div className="border-t border-border p-4">
            <h3 className="mb-3 text-sm font-semibold">Recent Activity</h3>
            <div className="space-y-3">
              {pipelineEmails.slice(0, 3).map((email, index) => (
                <div key={index} className="text-xs">
                  <div className="mb-1 flex items-center gap-2">
                    <CheckCircle className="h-3 w-3 text-green-500" />
                    <span className="font-medium">Email Generated</span>
                  </div>
                  <div className="truncate text-muted-foreground">
                    {email.primary_email.subject}
                  </div>
                  <div className="text-muted-foreground">
                    {(email.relevance_score * 100).toFixed(0)}% relevance
                  </div>
                </div>
              ))}

              {pipelineEmails.length === 0 && (
                <div className="text-xs text-muted-foreground">
                  No recent activity
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex-1">
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

          {currentTab === "credits" && (
            <div className="p-6">
              <div className="mb-6">
                <h2 className="mb-2 text-2xl font-bold">Credits & Billing</h2>
                <p className="text-muted-foreground">
                  Manage your credits, view usage statistics, and upgrade your
                  plan.
                </p>
              </div>

              <CreditManager
                currentCredits={userCredits || 0}
                currentPlan={userPlan}
                usageStats={{
                  currentPeriodUsage: usage?.currentPeriodUsage || 0,
                  totalCreditsUsed: usage?.totalCreditsUsed || 0,
                  searchesThisMonth:
                    searches?.filter((s) => {
                      const now = new Date();
                      const searchDate = new Date(s._creationTime);
                      return (
                        searchDate.getMonth() === now.getMonth() &&
                        searchDate.getFullYear() === now.getFullYear()
                      );
                    }).length || 0,
                  leadsGenerated: leadStats?.totalLeads || 0,
                  emailsGenerated: pipelineEmails.length,
                  avgCostPerLead: usage?.avgCostPerLead || 0,
                }}
                onUpgrade={handleUpgradePlan}
                onPurchaseCredits={handlePurchaseCredits}
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

          {currentTab === "dashboard" && (
            <div className="p-6">
              <div className="mb-6">
                <h2 className="mb-2 text-2xl font-bold">Analytics Dashboard</h2>
                <p className="text-muted-foreground">
                  Track your lead generation performance and AI email
                  effectiveness.
                </p>
              </div>
              <Dashboard />
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

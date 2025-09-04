import { useState } from "react";
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
  Activity
} from "lucide-react";
import { EnhancedLeadSearch } from "./EnhancedLeadSearch";
import { PipelineOrchestrator } from "./pipeline/PipelineOrchestrator";
import { PipelineProvider } from "@/pipeline/context";
import { AIEmailGenerator } from "./AIEmailGenerator";
import { BusinessProfileWizard } from "./BusinessProfileWizard";
import { CreditManager } from "./CreditManager";
import { AdminDashboard } from "./AdminDashboard";
import { Dashboard } from "./Dashboard";
import { Settings as SettingsComponent } from "./Settings";
import { DebugDashboard } from "./DebugDashboard";
import { PerformanceMonitoringDashboard } from "./PerformanceMonitoringDashboard";
import type { Lead, EmailGenerationResult, BusinessProfileInput } from "@/lib/api-client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { useCredits, useBilling } from "@/hooks/useBilling";
import { useLangGraphRequests } from "@/hooks/useLangGraph";
import { useSearches } from "@/hooks/useSearches";
import { useUserLeads } from "@/hooks/useLeads";

export function LeadEternityDashboard() {
  const [currentTab, setCurrentTab] = useState("pipeline");
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  
  // Real backend integration
  const { user, isAuthenticated } = useAuth();
  const { profile, isComplete: hasCompletedOnboarding } = useProfile();
  const { balance } = useCredits();
  const userCredits = balance?.credits || 0;
  const { purchaseCredits, usage } = useBilling();
  const { requests: emailRequests } = useLangGraphRequests();
  const { searches } = useSearches();
  const { stats: leadStats } = useUserLeads();
  
  // Derive user plan from user data
  const userPlan = user?.plan || 'free';
  const isAdmin = user?.role === 'admin' || user?.isAdmin === true;
  
  // Convert email requests to EmailGenerationResult format for compatibility
  const generatedEmails = emailRequests?.page?.filter(req => req.status === 'completed').map(req => ({
    primary_email: {
      subject: req.result?.subject || 'Generated Email',
      body: req.result?.body || '',
    },
    follow_up_emails: req.result?.followUps || [],
    relevance_score: req.result?.relevanceScore || 0.8,
    personalization_notes: req.result?.notes || [],
    estimated_response_rate: req.result?.estimatedResponseRate || 0.15,
  })) || [];
  
  const { toast } = useToast();

  const handleGenerateEmail = (lead: Lead) => {
    setSelectedLead(lead);
    setCurrentTab("email-generator");
    toast({
      title: "Lead Selected",
      description: `Selected ${lead.company_name} for AI email generation.`,
    });
  };

  const handleEmailGenerated = (result: EmailGenerationResult) => {
    setGeneratedEmails(prev => [result, ...prev]);
    toast({
      title: "Email Generated Successfully!",
      description: `High-quality personalized email created for ${selectedLead?.company_name}.`,
    });
  };

  const handleCompleteOnboarding = (profileData: BusinessProfileInput) => {
    setCurrentTab("search");
    toast({
      title: "Welcome to Genni!",
      description: "Your business profile has been saved. You're ready to start generating leads!",
    });
  };

  const handleSkipOnboarding = () => {
    setCurrentTab("search");
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
      await purchaseCredits({ amount });
      toast({
        title: "Credits Purchased",
        description: `Added ${amount} credits to your account.`,
      });
    } catch (error) {
      toast({
        title: "Purchase Failed",
        description: "Failed to purchase credits. Please try again.",
        variant: "destructive",
      });
    }
  };

  // Show onboarding if not completed
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
    <PipelineProvider>
      <div className="min-h-screen bg-background">
        <div className="border-b border-border bg-card">
          <div className="flex h-16 items-center px-6">
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2">
                <Bot className="h-8 w-8 text-primary" />
                <div>
                  <h1 className="text-xl font-bold">Genni</h1>
                  <p className="text-xs text-muted-foreground">AI-Powered Lead Generation</p>
                </div>
              </div>
            </div>
            
            <div className="ml-auto flex items-center space-x-4">
              <Badge variant="secondary" className="bg-green-100 text-green-800">
                <Sparkles className="h-3 w-3 mr-1" />
                AI System Active
              </Badge>
              
              <div className="text-right text-sm">
                <div className="font-medium">5 AI Agents</div>
                <div className="text-xs text-muted-foreground">Ready for personalization</div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex">
          <div className="w-64 border-r border-border bg-card">
            <nav className="p-4 space-y-2">
            <Button
              variant={currentTab === "pipeline" ? "default" : "ghost"}
              className="w-full justify-start"
              onClick={() => setCurrentTab("pipeline")}
            >
              <Search className="h-4 w-4 mr-2" />
              Lead Pipeline
            </Button>
            
            <Button
              variant={currentTab === "email-generator" ? "default" : "ghost"}
              className="w-full justify-start"
              onClick={() => setCurrentTab("email-generator")}
            >
              <Bot className="h-4 w-4 mr-2" />
              AI Email Generator
            </Button>
            
            <Button
              variant={currentTab === "profile" ? "default" : "ghost"}
              className="w-full justify-start"
              onClick={() => setCurrentTab("profile")}
            >
              <Building2 className="h-4 w-4 mr-2" />
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
              onClick={() => setCurrentTab("credits")}
            >
              <CreditCard className="h-4 w-4 mr-2" />
              Credits & Billing
              <Badge variant="secondary" className="ml-auto text-xs">
                {userCredits}
              </Badge>
            </Button>
            
            <Button
              variant={currentTab === "dashboard" ? "default" : "ghost"}
              className="w-full justify-start"
              onClick={() => setCurrentTab("dashboard")}
            >
              <BarChart3 className="h-4 w-4 mr-2" />
              Analytics
            </Button>
            
            <Button
              variant={currentTab === "settings" ? "default" : "ghost"}
              className="w-full justify-start"
              onClick={() => setCurrentTab("settings")}
            >
              <Settings className="h-4 w-4 mr-2" />
              Settings
            </Button>

            {isAdmin && (
              <Button
                variant={currentTab === "admin" ? "default" : "ghost"}
                className="w-full justify-start"
                onClick={() => setCurrentTab("admin")}
              >
                <UserCheck className="h-4 w-4 mr-2" />
                Admin Dashboard
                <Badge variant="secondary" className="ml-auto text-xs">
                  Admin
                </Badge>
              </Button>
            )}
            
            {isAdmin && (
              <Button
                variant={currentTab === "debug" ? "default" : "ghost"}
                className="w-full justify-start"
                onClick={() => setCurrentTab("debug")}
              >
                <Bug className="h-4 w-4 mr-2" />
                Debug Panel
                <Badge variant="outline" className="ml-auto text-xs">
                  Dev
                </Badge>
              </Button>
            )}
            
            {isAdmin && (
              <Button
                variant={currentTab === "performance" ? "default" : "ghost"}
                className="w-full justify-start"
                onClick={() => setCurrentTab("performance")}
              >
                <Activity className="h-4 w-4 mr-2" />
                Performance
                <Badge variant="outline" className="ml-auto text-xs">
                  Admin
                </Badge>
              </Button>
            )}
          </nav>

          {/* Recent Activity */}
          <div className="p-4 border-t border-border">
            <h3 className="text-sm font-semibold mb-3">Recent Activity</h3>
            <div className="space-y-3">
              {generatedEmails.slice(0, 3).map((email, index) => (
                <div key={index} className="text-xs">
                  <div className="flex items-center gap-2 mb-1">
                    <CheckCircle className="h-3 w-3 text-green-500" />
                    <span className="font-medium">Email Generated</span>
                  </div>
                  <div className="text-muted-foreground truncate">
                    {email.primary_email.subject}
                  </div>
                  <div className="text-muted-foreground">
                    {(email.relevance_score * 100).toFixed(0)}% relevance
                  </div>
                </div>
              ))}
              
              {generatedEmails.length === 0 && (
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
                <h2 className="text-2xl font-bold mb-2">Business Profile</h2>
                <p className="text-muted-foreground">
                  Update your business information to improve AI email personalization.
                </p>
              </div>
              
              <BusinessProfileWizard 
                onComplete={(profileData) => {
                  toast({
                    title: "Profile Updated",
                    description: "Your business profile has been updated successfully.",
                  });
                }}
                initialData={profile}
              />
            </div>
          )}

          {currentTab === "credits" && (
            <div className="p-6">
              <div className="mb-6">
                <h2 className="text-2xl font-bold mb-2">Credits & Billing</h2>
                <p className="text-muted-foreground">
                  Manage your credits, view usage statistics, and upgrade your plan.
                </p>
              </div>
              
              <CreditManager
                currentCredits={userCredits || 0}
                currentPlan={userPlan}
                usageStats={{
                  currentPeriodUsage: usage?.currentPeriodUsage || 0,
                  totalCreditsUsed: usage?.totalCreditsUsed || 0,
                  searchesThisMonth: searches?.filter(s => {
                    const now = new Date();
                    const searchDate = new Date(s._creationTime);
                    return searchDate.getMonth() === now.getMonth() && searchDate.getFullYear() === now.getFullYear();
                  }).length || 0,
                  leadsGenerated: leadStats?.totalLeads || 0,
                  emailsGenerated: generatedEmails.length,
                  avgCostPerLead: usage?.avgCostPerLead || 0
                }}
                onUpgrade={handleUpgradePlan}
                onPurchaseCredits={handlePurchaseCredits}
              />
            </div>
          )}

          {currentTab === "email-generator" && (
            <div className="p-6">
              <div className="mb-6">
                <h2 className="text-2xl font-bold mb-2">AI Email Generator</h2>
                <p className="text-muted-foreground">
                  Generate highly personalized emails using our 5-agent AI system for maximum conversion.
                </p>
              </div>

              {selectedLead ? (
                <AIEmailGenerator 
                  selectedLead={selectedLead} 
                  onEmailGenerated={handleEmailGenerated}
                />
              ) : (
                <Alert>
                  <Bot className="h-4 w-4" />
                  <AlertDescription>
                    Select a lead from the Lead Search to generate a personalized AI email.
                  </AlertDescription>
                </Alert>
              )}
              
            </div>
          )}

          {currentTab === "dashboard" && (
            <div className="p-6">
              <div className="mb-6">
                <h2 className="text-2xl font-bold mb-2">Analytics Dashboard</h2>
                <p className="text-muted-foreground">
                  Track your lead generation performance and AI email effectiveness.
                </p>
              </div>
              <Dashboard />
            </div>
          )}

          {currentTab === "settings" && (
            <div className="p-6">
              <div className="mb-6">
                <h2 className="text-2xl font-bold mb-2">Settings</h2>
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
          
          {currentTab === "debug" && isAdmin && (
            <div className="p-6">
              <div className="mb-6">
                <h2 className="text-2xl font-bold mb-2">Debug Dashboard</h2>
                <p className="text-muted-foreground">
                  Advanced debugging tools for correlation tracking, performance monitoring, and system diagnostics.
                </p>
              </div>
              <DebugDashboard />
            </div>
          )}
          
          {currentTab === "performance" && isAdmin && (
            <div className="p-6">
              <div className="mb-6">
                <h2 className="text-2xl font-bold mb-2">Performance Monitoring</h2>
                <p className="text-muted-foreground">
                  Real-time system metrics, performance analysis, and comprehensive monitoring dashboard.
                </p>
              </div>
              <PerformanceMonitoringDashboard />
            </div>
          )}
        </div>
        </div>
      </div>
    </PipelineProvider>
  );
}
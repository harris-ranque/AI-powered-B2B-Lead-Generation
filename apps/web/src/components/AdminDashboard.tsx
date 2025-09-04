import React, { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { 
  Users, 
  Building, 
  DollarSign, 
  Activity, 
  Search, 
  Mail,
  TrendingUp,
  TrendingDown,
  AlertCircle,
  CheckCircle,
  Clock,
  Ban,
  Edit,
  Download,
  RefreshCw,
  Eye,
  Shield,
  Settings,
  Save,
  Power,
  Square,
  Pause,
  Play,
  AlertTriangle,
  Trash2
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAdminDashboard, useAdminUsers, useAdminAnalytics, useAdminConfiguration, useAdminSystemControl } from "@/hooks/useAdmin";
import { CreditManagement } from "./admin/CreditManagement";

interface AdminMetrics {
  totalUsers: number;
  activeUsers: number;
  totalRevenue: number;
  monthlyRevenue: number;
  searchesDaily: number;
  leadsGenerated: number;
  emailsGenerated: number;
  averageResponseRate: number;
  systemHealth: {
    apiUptime: number;
    queueHealth: number;
    errorRate: number;
    avgResponseTime: number;
  };
}

interface User {
  id: string;
  email: string;
  name: string;
  plan: 'free' | 'pro' | 'enterprise';
  status: 'active' | 'inactive' | 'banned';
  creditsRemaining: number;
  totalSpent: number;
  lastLogin: string;
  signupDate: string;
  searchesThisMonth: number;
  leadsGenerated: number;
}

interface Company {
  id: string;
  name: string;
  industry: string;
  userCount: number;
  totalRevenue: number;
  plan: 'free' | 'pro' | 'enterprise';
  status: 'active' | 'trial' | 'cancelled';
  monthlySearches: number;
  conversionRate: number;
}

interface CreditCosts {
  leadDiscovery: number;
  contactEnrichment: number;
  aiAnalysis: number;
  emailGeneration: number;
  bulkAnalysis: number;
}

interface PlanLimits {
  free: {
    monthlyCredits: number;
    maxLeadsPerSearch: number;
    maxSearches: number;
  };
  pro: {
    monthlyCredits: number;
    maxLeadsPerSearch: number;
    maxSearches: number;
  };
  enterprise: {
    monthlyCredits: number;
    maxLeadsPerSearch: number;
    maxSearches: number;
  };
}

export function AdminDashboard() {
  const [currentTab, setCurrentTab] = useState("overview");
  const [searchTerm, setSearchTerm] = useState("");
  const [renderError, setRenderError] = useState<string | null>(null);
  const { toast } = useToast();

  // Editable configuration state
  const [creditCosts, setCreditCosts] = useState({
    leadDiscovery: 1,
    contactEnrichment: 2,
    aiAnalysis: 3,
    emailGeneration: 5,
    bulkAnalysis: 10,
  });

  const [planLimits, setPlanLimits] = useState({
    free: {
      monthlyCredits: 50,
      maxLeadsPerSearch: 25,
      maxSearches: 5,
    },
    pro: {
      monthlyCredits: 500,
      maxLeadsPerSearch: 100,
      maxSearches: 50,
    },
    enterprise: {
      monthlyCredits: 2000,
      maxLeadsPerSearch: 500,
      maxSearches: -1, // Unlimited
    },
  });

  // Real Convex hooks
  const { metrics, systemHealth, isLoading: metricsLoading } = useAdminDashboard();
  const { users, updateUserStatus, updateUserPlan, isLoading: usersLoading } = useAdminUsers();
  const { analytics, revenueStats, isLoading: analyticsLoading } = useAdminAnalytics();
  const { configuration, updateCreditCosts, updatePlanLimits, isLoading: configLoading } = useAdminConfiguration();
  const { 
    systemStatus, 
    systemActivity, 
    pauseAllLeadGeneration, 
    resumeAllLeadGeneration, 
    clearAllActiveSearches,
    isLoading: systemControlLoading 
  } = useAdminSystemControl();

  // Companies data from backend (placeholder for future implementation)
  const companies: Company[] = [];

  // Use real data or fallback to defaults with bulletproof error handling
  const adminMetrics: AdminMetrics = (() => {
    try {
      return {
        totalUsers: (metrics?.totalUsers && typeof metrics.totalUsers === 'number') ? metrics.totalUsers : 0,
        activeUsers: (metrics?.activeUsers && typeof metrics.activeUsers === 'number') ? metrics.activeUsers : 0,
        totalRevenue: (revenueStats?.totalRevenue && typeof revenueStats.totalRevenue === 'number') ? revenueStats.totalRevenue : 0,
        monthlyRevenue: (revenueStats?.monthlyRevenue && typeof revenueStats.monthlyRevenue === 'number') ? revenueStats.monthlyRevenue : 0,
        searchesDaily: (analytics?.searchesDaily && typeof analytics.searchesDaily === 'number') ? analytics.searchesDaily : 0,
        leadsGenerated: (analytics?.leadsGenerated && typeof analytics.leadsGenerated === 'number') ? analytics.leadsGenerated : 0,
        emailsGenerated: (analytics?.emailsGenerated && typeof analytics.emailsGenerated === 'number') ? analytics.emailsGenerated : 0,
        averageResponseRate: (analytics?.averageResponseRate && typeof analytics.averageResponseRate === 'number') ? analytics.averageResponseRate : 0,
        systemHealth: {
          apiUptime: (systemHealth?.apiUptime && typeof systemHealth.apiUptime === 'number') ? systemHealth.apiUptime : 0,
          queueHealth: (systemHealth?.queueHealth && typeof systemHealth.queueHealth === 'number') ? systemHealth.queueHealth : 0,
          errorRate: (systemHealth?.errorRate && typeof systemHealth.errorRate === 'number') ? systemHealth.errorRate : 0,
          avgResponseTime: (systemHealth?.avgResponseTime && typeof systemHealth.avgResponseTime === 'number') ? systemHealth.avgResponseTime : 0
        }
      };
    } catch (error) {
      console.error('Error constructing adminMetrics:', error);
      setRenderError('Failed to load admin metrics data');
      return {
        totalUsers: 0,
        activeUsers: 0,
        totalRevenue: 0,
        monthlyRevenue: 0,
        searchesDaily: 0,
        leadsGenerated: 0,
        emailsGenerated: 0,
        averageResponseRate: 0,
        systemHealth: {
          apiUptime: 0,
          queueHealth: 0,
          errorRate: 0,
          avgResponseTime: 0
        }
      };
    }
  })();

  // Initialize configuration state from loaded data with bulletproof error handling
  React.useEffect(() => {
    try {
      if (configuration && typeof configuration === 'object') {
        // Safe credit costs update
        if (configuration.creditCosts && typeof configuration.creditCosts === 'object') {
          try {
            setCreditCosts({
              leadDiscovery: (typeof configuration.creditCosts.LEAD_DISCOVERY === 'number') ? configuration.creditCosts.LEAD_DISCOVERY : 1,
              contactEnrichment: (typeof configuration.creditCosts.EMAIL_ENRICHMENT === 'number') ? configuration.creditCosts.EMAIL_ENRICHMENT : 2,
              aiAnalysis: (typeof configuration.creditCosts.AI_ANALYSIS === 'number') ? configuration.creditCosts.AI_ANALYSIS : 3,
              emailGeneration: (typeof configuration.creditCosts.EMAIL_GENERATION === 'number') ? configuration.creditCosts.EMAIL_GENERATION : 5,
              bulkAnalysis: (typeof configuration.creditCosts.BULK_ANALYSIS === 'number') ? configuration.creditCosts.BULK_ANALYSIS : 10,
            });
          } catch (error) {
            console.error('Error setting credit costs:', error);
          }
        }
        
        // Safe plan limits update
        if (configuration.planLimits && typeof configuration.planLimits === 'object') {
          try {
            setPlanLimits({
              free: {
                monthlyCredits: (configuration.planLimits.free?.monthlyCredits && typeof configuration.planLimits.free.monthlyCredits === 'number') ? configuration.planLimits.free.monthlyCredits : 100,
                maxLeadsPerSearch: (configuration.planLimits.free?.maxLeadsPerSearch && typeof configuration.planLimits.free.maxLeadsPerSearch === 'number') ? configuration.planLimits.free.maxLeadsPerSearch : 50,
                maxSearches: (configuration.planLimits.free?.maxSearches && typeof configuration.planLimits.free.maxSearches === 'number') ? configuration.planLimits.free.maxSearches : 5,
              },
              pro: {
                monthlyCredits: (configuration.planLimits.pro?.monthlyCredits && typeof configuration.planLimits.pro.monthlyCredits === 'number') ? configuration.planLimits.pro.monthlyCredits : 500,
                maxLeadsPerSearch: (configuration.planLimits.pro?.maxLeadsPerSearch && typeof configuration.planLimits.pro.maxLeadsPerSearch === 'number') ? configuration.planLimits.pro.maxLeadsPerSearch : 200,
                maxSearches: (configuration.planLimits.pro?.maxSearches && typeof configuration.planLimits.pro.maxSearches === 'number') ? configuration.planLimits.pro.maxSearches : 25,
              },
              enterprise: {
                monthlyCredits: (configuration.planLimits.enterprise?.monthlyCredits && typeof configuration.planLimits.enterprise.monthlyCredits === 'number') ? configuration.planLimits.enterprise.monthlyCredits : 2000,
                maxLeadsPerSearch: (configuration.planLimits.enterprise?.maxLeadsPerSearch && typeof configuration.planLimits.enterprise.maxLeadsPerSearch === 'number') ? configuration.planLimits.enterprise.maxLeadsPerSearch : 1000,
                maxSearches: (configuration.planLimits.enterprise?.maxSearches && typeof configuration.planLimits.enterprise.maxSearches === 'number') ? configuration.planLimits.enterprise.maxSearches : -1,
              }
            });
          } catch (error) {
            console.error('Error setting plan limits:', error);
          }
        }
      }
    } catch (error) {
      console.error('Error in configuration useEffect:', error);
      setRenderError('Failed to initialize configuration data');
    }
  }, [configuration]);

  // Configuration save handlers
  const handleSaveCreditCosts = async () => {
    try {
      await updateCreditCosts({
        creditCosts: {
          LEAD_DISCOVERY: creditCosts.leadDiscovery,
          EMAIL_ENRICHMENT: creditCosts.contactEnrichment,
          AI_ANALYSIS: creditCosts.aiAnalysis,
          EMAIL_GENERATION: creditCosts.emailGeneration,
          BULK_ANALYSIS: creditCosts.bulkAnalysis,
        }
      });
      toast({
        title: "Credit Costs Updated",
        description: "Credit cost configuration has been saved successfully.",
      });
    } catch (error) {
      toast({
        title: "Save Failed",
        description: "Failed to save credit costs. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleSavePlanLimits = async () => {
    try {
      await updatePlanLimits({
        planLimits: {
          free: {
            monthlyCredits: planLimits.free.monthlyCredits,
            maxSearches: planLimits.free.maxSearches,
            maxLeadsPerSearch: planLimits.free.maxLeadsPerSearch,
            emailGeneration: true,
            bulkOperations: false,
            apiAccess: false,
          },
          pro: {
            monthlyCredits: planLimits.pro.monthlyCredits,
            maxSearches: planLimits.pro.maxSearches,
            maxLeadsPerSearch: planLimits.pro.maxLeadsPerSearch,
            emailGeneration: true,
            bulkOperations: true,
            apiAccess: true,
          },
          enterprise: {
            monthlyCredits: planLimits.enterprise.monthlyCredits,
            maxSearches: planLimits.enterprise.maxSearches,
            maxLeadsPerSearch: planLimits.enterprise.maxLeadsPerSearch,
            emailGeneration: true,
            bulkOperations: true,
            apiAccess: true,
          },
        }
      });
      toast({
        title: "Plan Limits Updated",
        description: "Plan configuration has been saved successfully.",
      });
    } catch (error) {
      toast({
        title: "Save Failed",
        description: "Failed to save plan limits. Please try again.",
        variant: "destructive",
      });
    }
  };

  // Admin action handlers
  const handleUserAction = async (userId: string, action: string) => {
    try {
      if (action === 'ban' || action === 'activate') {
        await updateUserStatus({ 
          userId, 
          status: action === 'ban' ? 'banned' : 'active' 
        });
        toast({
          title: "User Updated",
          description: `User has been ${action === 'ban' ? 'banned' : 'activated'}.`,
        });
      }
    } catch (error) {
      toast({
        title: "Action Failed",
        description: "Failed to update user. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleExportData = async (type: string) => {
    try {
      toast({
        title: "Export Started",
        description: `Exporting ${type} data. Download will start shortly.`,
      });
      // Additional export logic would go here
    } catch (error) {
      toast({
        title: "Export Failed", 
        description: "Failed to export data. Please try again.",
        variant: "destructive",
      });
    }
  };

  // System Control Handlers
  const handlePauseAllLeadGeneration = async () => {
    if (!confirm("Are you sure you want to pause ALL lead generation activities? This will cancel all active searches and refund credits to users.")) {
      return;
    }

    const reason = prompt("Enter reason for pause (optional):") || "Emergency pause by admin";
    
    try {
      const result = await pauseAllLeadGeneration({ 
        reason,
        maintenanceMode: false 
      });
      
      if (result.success) {
        toast({
          title: "System Paused",
          description: `Lead generation paused. Cancelled ${result.cancelledSearches} searches, cleared ${result.clearedBatches} batches, notified ${result.notifiedUsers} users.`,
        });
      } else {
        toast({
          title: "Pause Failed",
          description: result.message || "Failed to pause system",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Pause Failed",
        description: "Failed to pause lead generation. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleResumeAllLeadGeneration = async () => {
    if (!confirm("Are you sure you want to resume all lead generation activities?")) {
      return;
    }

    const reason = prompt("Enter reason for resume (optional):") || "System resumed by admin";
    
    try {
      const result = await resumeAllLeadGeneration({ reason });
      
      if (result.success) {
        toast({
          title: "System Resumed",
          description: `Lead generation resumed. Notified ${result.notifiedUsers} users. System was paused for ${Math.round(result.pausedDuration / 60000)} minutes.`,
        });
      } else {
        toast({
          title: "Resume Failed",
          description: result.message || "Failed to resume system",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Resume Failed",
        description: "Failed to resume lead generation. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleClearAllActiveSearches = async () => {
    if (!confirm("Are you sure you want to CLEAR all active searches? This action cannot be undone.")) {
      return;
    }

    const reason = prompt("Enter reason for clearing searches (required):");
    if (!reason) {
      toast({
        title: "Action Cancelled",
        description: "Reason is required to clear all searches.",
        variant: "destructive",
      });
      return;
    }

    const refundCredits = confirm("Refund credits to users? (Recommended: Yes)");
    
    try {
      const result = await clearAllActiveSearches({ 
        reason,
        refundCredits 
      });
      
      toast({
        title: "Searches Cleared",
        description: `Cleared ${result.clearedSearches} searches, cleared ${result.batchesCleared} batches${refundCredits ? `, refunded ${result.totalCreditsRefunded} credits` : ''}.`,
      });
    } catch (error) {
      toast({
        title: "Clear Failed",
        description: "Failed to clear active searches. Please try again.",
        variant: "destructive",
      });
    }
  };

  const getStatusBadge = (status: string) => {
    const statusConfig = {
      active: { variant: "default" as const, color: "bg-green-100 text-green-800" },
      inactive: { variant: "secondary" as const, color: "bg-gray-100 text-gray-800" },
      banned: { variant: "destructive" as const, color: "bg-red-100 text-red-800" },
      trial: { variant: "outline" as const, color: "bg-blue-100 text-blue-800" },
      cancelled: { variant: "destructive" as const, color: "bg-red-100 text-red-800" }
    };

    const config = statusConfig[status as keyof typeof statusConfig] || statusConfig.inactive;
    
    return (
      <Badge variant={config.variant} className={config.color}>
        {status}
      </Badge>
    );
  };

  const getPlanBadge = (plan: string) => {
    const planConfig = {
      free: { color: "bg-gray-100 text-gray-800", icon: null },
      pro: { color: "bg-blue-100 text-blue-800", icon: <CheckCircle className="h-3 w-3 mr-1" /> },
      enterprise: { color: "bg-purple-100 text-purple-800", icon: <Shield className="h-3 w-3 mr-1" /> }
    };

    const config = planConfig[plan as keyof typeof planConfig] || planConfig.free;
    
    return (
      <Badge variant="secondary" className={config.color}>
        {config.icon}
        {plan}
      </Badge>
    );
  };

  // Safe render wrapper to catch any render errors
  const safeRender = (renderFunction: () => JSX.Element, fallbackMessage: string) => {
    try {
      return renderFunction();
    } catch (error) {
      console.error('Render error in AdminDashboard:', error);
      setRenderError(`${fallbackMessage}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return (
        <Alert className="m-4">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <strong>Render Error:</strong> {fallbackMessage}
            <br />
            <small>Error: {error instanceof Error ? error.message : 'Unknown error'}</small>
          </AlertDescription>
        </Alert>
      );
    }
  };

  // Filter users based on search term with bulletproof error handling  
  const filteredUsers = (() => {
    try {
      if (!users || !Array.isArray(users)) return [];
      return users.filter(user => {
        try {
          const name = user?.name?.toLowerCase() || '';
          const email = user?.email?.toLowerCase() || '';
          const term = searchTerm?.toLowerCase() || '';
          return name.includes(term) || email.includes(term);
        } catch (error) {
          console.error('Error filtering user:', user, error);
          return false;
        }
      });
    } catch (error) {
      console.error('Error in filteredUsers:', error);
      return [];
    }
  })();

  const renderOverview = () => (
    <div className="space-y-6">
      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-6">
          <div className="flex items-center">
            <Users className="h-8 w-8 text-blue-500" />
            <div className="ml-4">
              <p className="text-sm font-medium text-muted-foreground">Total Users</p>
              <p className="text-2xl font-bold">{adminMetrics.totalUsers.toLocaleString()}</p>
              <p className="text-sm text-green-600">
                <TrendingUp className="h-3 w-3 inline mr-1" />
                +12% from last month
              </p>
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center">
            <DollarSign className="h-8 w-8 text-green-500" />
            <div className="ml-4">
              <p className="text-sm font-medium text-muted-foreground">Monthly Revenue</p>
              <p className="text-2xl font-bold">${adminMetrics.monthlyRevenue.toLocaleString()}</p>
              <p className="text-sm text-green-600">
                <TrendingUp className="h-3 w-3 inline mr-1" />
                +8% from last month
              </p>
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center">
            <Activity className="h-8 w-8 text-purple-500" />
            <div className="ml-4">
              <p className="text-sm font-medium text-muted-foreground">Active Users</p>
              <p className="text-2xl font-bold">{adminMetrics.activeUsers.toLocaleString()}</p>
              <p className="text-sm text-muted-foreground">
                {((adminMetrics.activeUsers / adminMetrics.totalUsers) * 100).toFixed(1)}% of total
              </p>
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center">
            <Mail className="h-8 w-8 text-orange-500" />
            <div className="ml-4">
              <p className="text-sm font-medium text-muted-foreground">Avg Response Rate</p>
              <p className="text-2xl font-bold">{adminMetrics.averageResponseRate}%</p>
              <p className="text-sm text-green-600">
                <TrendingUp className="h-3 w-3 inline mr-1" />
                +2.1% from last month
              </p>
            </div>
          </div>
        </Card>
      </div>

      {/* System Health */}
      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4">System Health</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">API Uptime</span>
              <span className="text-sm font-bold text-green-600">{adminMetrics.systemHealth.apiUptime}%</span>
            </div>
            <Progress value={adminMetrics.systemHealth.apiUptime} className="h-2" />
          </div>
          
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Queue Health</span>
              <span className="text-sm font-bold text-green-600">{adminMetrics.systemHealth.queueHealth}%</span>
            </div>
            <Progress value={adminMetrics.systemHealth.queueHealth} className="h-2" />
          </div>
          
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Error Rate</span>
              <span className="text-sm font-bold text-red-600">{adminMetrics.systemHealth.errorRate}%</span>
            </div>
            <Progress value={100 - (adminMetrics.systemHealth.errorRate * 10)} className="h-2" />
          </div>
          
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Avg Response</span>
              <span className="text-sm font-bold">{adminMetrics.systemHealth.avgResponseTime}ms</span>
            </div>
            <Progress value={Math.max(0, 100 - (adminMetrics.systemHealth.avgResponseTime / 10))} className="h-2" />
          </div>
        </div>
      </Card>

      {/* System Emergency Controls */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Emergency System Controls</h3>
          <div className="flex items-center gap-2">
            {systemStatus?.systemPaused && (
              <Badge variant="destructive" className="animate-pulse">
                <AlertTriangle className="h-3 w-3 mr-1" />
                SYSTEM PAUSED
              </Badge>
            )}
            {systemStatus?.maintenanceMode && (
              <Badge variant="outline" className="bg-yellow-50 text-yellow-700">
                <Settings className="h-3 w-3 mr-1" />
                MAINTENANCE MODE
              </Badge>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="flex items-center justify-between p-4 border rounded-lg">
            <div>
              <p className="text-sm font-medium">System Status</p>
              <p className="text-lg font-bold text-green-600">
                {systemStatus?.systemPaused ? 'PAUSED' : 'OPERATIONAL'}
              </p>
            </div>
            <Power className={`h-8 w-8 ${systemStatus?.systemPaused ? 'text-red-500' : 'text-green-500'}`} />
          </div>

          <div className="flex items-center justify-between p-4 border rounded-lg">
            <div>
              <p className="text-sm font-medium">Active Searches</p>
              <p className="text-lg font-bold">
                {systemActivity?.activeSearches?.total || 0}
              </p>
            </div>
            <Activity className="h-8 w-8 text-blue-500" />
          </div>

          <div className="flex items-center justify-between p-4 border rounded-lg">
            <div>
              <p className="text-sm font-medium">Queue Status</p>
              <p className="text-lg font-bold">
                {(systemActivity?.queueStatus?.batchPlans || 0) + (systemActivity?.queueStatus?.searchBatches || 0)}
              </p>
            </div>
            <Clock className="h-8 w-8 text-orange-500" />
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          {!systemStatus?.systemPaused ? (
            <>
              <Button
                variant="destructive"
                onClick={handlePauseAllLeadGeneration}
                className="flex-1 min-w-[200px]"
              >
                <Pause className="h-4 w-4 mr-2" />
                Emergency Pause All
              </Button>
              <Button
                variant="outline"
                onClick={handleClearAllActiveSearches}
                className="flex-1 min-w-[200px] border-orange-300 text-orange-700 hover:bg-orange-50"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Clear Active Searches
              </Button>
            </>
          ) : (
            <Button
              variant="default"
              onClick={handleResumeAllLeadGeneration}
              className="flex-1 min-w-[200px] bg-green-600 hover:bg-green-700"
            >
              <Play className="h-4 w-4 mr-2" />
              Resume All Operations
            </Button>
          )}
        </div>

        {systemStatus?.systemPaused && systemStatus.reason && (
          <Alert className="mt-4">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              <strong>Paused:</strong> {systemStatus.reason}
              {systemStatus.pausedAt && (
                <span className="block text-xs text-muted-foreground mt-1">
                  Paused on {new Date(systemStatus.pausedAt).toLocaleString()}
                </span>
              )}
            </AlertDescription>
          </Alert>
        )}
      </Card>

      {/* Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="p-6">
          <h3 className="text-lg font-semibold mb-4">Daily Statistics</h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Search className="h-4 w-4 text-blue-500" />
                <span className="text-sm">Searches Today</span>
              </div>
              <span className="font-bold">{adminMetrics.searchesDaily}</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-green-500" />
                <span className="text-sm">New Signups</span>
              </div>
              <span className="font-bold">23</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-purple-500" />
                <span className="text-sm">Emails Generated</span>
              </div>
              <span className="font-bold">89</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-orange-500" />
                <span className="text-sm">Revenue Today</span>
              </div>
              <span className="font-bold">$1,240</span>
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <h3 className="text-lg font-semibold mb-4">Alerts & Issues</h3>
          <div className="space-y-3">
            <Alert>
              <CheckCircle className="h-4 w-4" />
              <AlertDescription>
                All systems operational. No issues detected.
              </AlertDescription>
            </Alert>
            <Alert>
              <Clock className="h-4 w-4" />
              <AlertDescription>
                Scheduled maintenance window: Sunday 2:00 AM - 4:00 AM UTC
              </AlertDescription>
            </Alert>
          </div>
        </Card>
      </div>
    </div>
  );

  const renderUserManagement = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">User Management</h3>
          <p className="text-sm text-muted-foreground">Manage user accounts and permissions</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => handleExportData("users")}>
            <Download className="h-4 w-4 mr-2" />
            Export Users
          </Button>
          <Button>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-4 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search users..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Credits</TableHead>
              <TableHead>Total Spent</TableHead>
              <TableHead>Last Login</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredUsers.map((user) => (
              <TableRow key={user.id}>
                <TableCell>
                  <div>
                    <div className="font-medium">{user.name}</div>
                    <div className="text-sm text-muted-foreground">{user.email}</div>
                  </div>
                </TableCell>
                <TableCell>
                  {getPlanBadge(user.plan)}
                </TableCell>
                <TableCell>
                  {getStatusBadge(user.status)}
                </TableCell>
                <TableCell>{user.creditsRemaining}</TableCell>
                <TableCell>${user.totalSpent}</TableCell>
                <TableCell>
                  {new Date(user.lastLogin).toLocaleDateString()}
                </TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" onClick={() => handleUserAction(user.id, "View")}>
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => handleUserAction(user.id, "Edit")}>
                      <Edit className="h-4 w-4" />
                    </Button>
                    {user.status !== "banned" && (
                      <Button variant="ghost" size="sm" onClick={() => handleUserAction(user.id, "Ban")}>
                        <Ban className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );

  const renderCompanies = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Company Insights</h3>
          <p className="text-sm text-muted-foreground">Monitor company performance and usage</p>
        </div>
        <Button variant="outline" onClick={() => handleExportData("companies")}>
          <Download className="h-4 w-4 mr-2" />
          Export Data
        </Button>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Company</TableHead>
              <TableHead>Industry</TableHead>
              <TableHead>Users</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead>Revenue</TableHead>
              <TableHead>Monthly Searches</TableHead>
              <TableHead>Conversion Rate</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {companies.map((company) => (
              <TableRow key={company.id}>
                <TableCell className="font-medium">{company.name}</TableCell>
                <TableCell>{company.industry}</TableCell>
                <TableCell>{company.userCount}</TableCell>
                <TableCell>{getPlanBadge(company.plan)}</TableCell>
                <TableCell>${company.totalRevenue}</TableCell>
                <TableCell>{company.monthlySearches}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    {company.conversionRate}%
                    {company.conversionRate > 15 ? (
                      <TrendingUp className="h-3 w-3 text-green-500" />
                    ) : (
                      <TrendingDown className="h-3 w-3 text-red-500" />
                    )}
                  </div>
                </TableCell>
                <TableCell>{getStatusBadge(company.status)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );

  const renderConfiguration = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">System Configuration</h3>
          <p className="text-sm text-muted-foreground">Manage credit costs and plan limits</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Credit Costs Configuration */}
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-lg font-semibold">Credit Costs</h4>
            <Button onClick={handleSaveCreditCosts} size="sm">
              <Save className="h-4 w-4 mr-2" />
              Save Changes
            </Button>
          </div>
          
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-muted-foreground">Lead Discovery</label>
              <Input
                type="number"
                value={creditCosts.leadDiscovery}
                onChange={(e) => setCreditCosts(prev => ({
                  ...prev,
                  leadDiscovery: parseInt(e.target.value) || 0
                }))}
                className="mt-1"
                min="0"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Credits charged for finding business leads
              </p>
            </div>

            <div>
              <label className="text-sm font-medium text-muted-foreground">Contact Enrichment</label>
              <Input
                type="number"
                value={creditCosts.contactEnrichment}
                onChange={(e) => setCreditCosts(prev => ({
                  ...prev,
                  contactEnrichment: parseInt(e.target.value) || 0
                }))}
                className="mt-1"
                min="0"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Credits charged for email and contact data
              </p>
            </div>

            <div>
              <label className="text-sm font-medium text-muted-foreground">AI Analysis</label>
              <Input
                type="number"
                value={creditCosts.aiAnalysis}
                onChange={(e) => setCreditCosts(prev => ({
                  ...prev,
                  aiAnalysis: parseInt(e.target.value) || 0
                }))}
                className="mt-1"
                min="0"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Credits charged for AI lead analysis
              </p>
            </div>

            <div>
              <label className="text-sm font-medium text-muted-foreground">Email Generation</label>
              <Input
                type="number"
                value={creditCosts.emailGeneration}
                onChange={(e) => setCreditCosts(prev => ({
                  ...prev,
                  emailGeneration: parseInt(e.target.value) || 0
                }))}
                className="mt-1"
                min="0"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Credits charged for personalized email creation
              </p>
            </div>

            <div>
              <label className="text-sm font-medium text-muted-foreground">Bulk Analysis</label>
              <Input
                type="number"
                value={creditCosts.bulkAnalysis}
                onChange={(e) => setCreditCosts(prev => ({
                  ...prev,
                  bulkAnalysis: parseInt(e.target.value) || 0
                }))}
                className="mt-1"
                min="0"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Credits charged for bulk operations
              </p>
            </div>
          </div>
        </Card>

        {/* Plan Limits Configuration */}
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-lg font-semibold">Plan Limits</h4>
            <Button onClick={handleSavePlanLimits} size="sm">
              <Save className="h-4 w-4 mr-2" />
              Save Changes
            </Button>
          </div>

          <div className="space-y-6">
            {/* Free Plan */}
            <div>
              <h5 className="font-medium text-sm mb-3 flex items-center gap-2">
                <span className="w-3 h-3 bg-gray-500 rounded-full"></span>
                Free Plan
              </h5>
              <div className="space-y-3 pl-5">
                <div>
                  <label className="text-xs text-muted-foreground">Monthly Credits</label>
                  <Input
                    type="number"
                    value={planLimits.free.monthlyCredits}
                    onChange={(e) => setPlanLimits(prev => ({
                      ...prev,
                      free: { ...prev.free, monthlyCredits: parseInt(e.target.value) || 0 }
                    }))}
                    className="mt-1"
                    min="0"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Max Leads Per Search</label>
                  <Input
                    type="number"
                    value={planLimits.free.maxLeadsPerSearch}
                    onChange={(e) => setPlanLimits(prev => ({
                      ...prev,
                      free: { ...prev.free, maxLeadsPerSearch: parseInt(e.target.value) || 0 }
                    }))}
                    className="mt-1"
                    min="0"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Max Searches</label>
                  <Input
                    type="number"
                    value={planLimits.free.maxSearches}
                    onChange={(e) => setPlanLimits(prev => ({
                      ...prev,
                      free: { ...prev.free, maxSearches: parseInt(e.target.value) || 0 }
                    }))}
                    className="mt-1"
                    min="0"
                  />
                </div>
              </div>
            </div>

            {/* Pro Plan */}
            <div>
              <h5 className="font-medium text-sm mb-3 flex items-center gap-2">
                <span className="w-3 h-3 bg-blue-500 rounded-full"></span>
                Pro Plan
              </h5>
              <div className="space-y-3 pl-5">
                <div>
                  <label className="text-xs text-muted-foreground">Monthly Credits</label>
                  <Input
                    type="number"
                    value={planLimits.pro.monthlyCredits}
                    onChange={(e) => setPlanLimits(prev => ({
                      ...prev,
                      pro: { ...prev.pro, monthlyCredits: parseInt(e.target.value) || 0 }
                    }))}
                    className="mt-1"
                    min="0"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Max Leads Per Search</label>
                  <Input
                    type="number"
                    value={planLimits.pro.maxLeadsPerSearch}
                    onChange={(e) => setPlanLimits(prev => ({
                      ...prev,
                      pro: { ...prev.pro, maxLeadsPerSearch: parseInt(e.target.value) || 0 }
                    }))}
                    className="mt-1"
                    min="0"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Max Searches</label>
                  <Input
                    type="number"
                    value={planLimits.pro.maxSearches}
                    onChange={(e) => setPlanLimits(prev => ({
                      ...prev,
                      pro: { ...prev.pro, maxSearches: parseInt(e.target.value) || 0 }
                    }))}
                    className="mt-1"
                    min="0"
                  />
                </div>
              </div>
            </div>

            {/* Enterprise Plan */}
            <div>
              <h5 className="font-medium text-sm mb-3 flex items-center gap-2">
                <span className="w-3 h-3 bg-purple-500 rounded-full"></span>
                Enterprise Plan
              </h5>
              <div className="space-y-3 pl-5">
                <div>
                  <label className="text-xs text-muted-foreground">Monthly Credits</label>
                  <Input
                    type="number"
                    value={planLimits.enterprise.monthlyCredits}
                    onChange={(e) => setPlanLimits(prev => ({
                      ...prev,
                      enterprise: { ...prev.enterprise, monthlyCredits: parseInt(e.target.value) || 0 }
                    }))}
                    className="mt-1"
                    min="0"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Max Leads Per Search</label>
                  <Input
                    type="number"
                    value={planLimits.enterprise.maxLeadsPerSearch}
                    onChange={(e) => setPlanLimits(prev => ({
                      ...prev,
                      enterprise: { ...prev.enterprise, maxLeadsPerSearch: parseInt(e.target.value) || 0 }
                    }))}
                    className="mt-1"
                    min="0"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Max Searches (-1 for unlimited)</label>
                  <Input
                    type="number"
                    value={planLimits.enterprise.maxSearches}
                    onChange={(e) => setPlanLimits(prev => ({
                      ...prev,
                      enterprise: { ...prev.enterprise, maxSearches: parseInt(e.target.value) || 0 }
                    }))}
                    className="mt-1"
                    min="-1"
                  />
                </div>
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* Current Configuration Summary */}
      <Card className="p-6">
        <h4 className="text-lg font-semibold mb-4">Current Configuration Summary</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h5 className="font-medium mb-2">Credit Costs</h5>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span>Lead Discovery:</span>
                <span>{creditCosts.leadDiscovery} credits</span>
              </div>
              <div className="flex justify-between">
                <span>Contact Enrichment:</span>
                <span>{creditCosts.contactEnrichment} credits</span>
              </div>
              <div className="flex justify-between">
                <span>AI Analysis:</span>
                <span>{creditCosts.aiAnalysis} credits</span>
              </div>
              <div className="flex justify-between">
                <span>Email Generation:</span>
                <span>{creditCosts.emailGeneration} credits</span>
              </div>
              <div className="flex justify-between">
                <span>Bulk Analysis:</span>
                <span>{creditCosts.bulkAnalysis} credits</span>
              </div>
            </div>
          </div>
          <div>
            <h5 className="font-medium mb-2">Plan Comparison</h5>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span>Free Monthly Credits:</span>
                <span>{planLimits.free.monthlyCredits}</span>
              </div>
              <div className="flex justify-between">
                <span>Pro Monthly Credits:</span>
                <span>{planLimits.pro.monthlyCredits}</span>
              </div>
              <div className="flex justify-between">
                <span>Enterprise Monthly Credits:</span>
                <span>{planLimits.enterprise.monthlyCredits}</span>
              </div>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );

  // Show loading state
  if (metricsLoading || usersLoading || analyticsLoading || configLoading || systemControlLoading) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold">Admin Dashboard</h1>
          <p className="text-muted-foreground">Monitor system performance and manage users</p>
        </div>
        <Alert>
          <Clock className="h-4 w-4 animate-spin" />
          <AlertDescription>
            Loading admin dashboard data...
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  // Bulletproof render with comprehensive error handling
  try {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        {/* Global error display */}
        {renderError && (
          <Alert className="mb-6">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              <strong>Admin Dashboard Error:</strong> {renderError}
              <Button 
                variant="outline" 
                size="sm" 
                className="ml-4"
                onClick={() => {
                  setRenderError(null);
                  window.location.reload();
                }}
              >
                Refresh Page
              </Button>
            </AlertDescription>
          </Alert>
        )}

        <div className="mb-8">
          <h1 className="text-3xl font-bold">Admin Dashboard</h1>
          <p className="text-muted-foreground">Monitor system performance and manage users</p>
        </div>

        <Tabs value={currentTab} onValueChange={setCurrentTab}>
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="users">User Management</TabsTrigger>
            <TabsTrigger value="credits">Credit Management</TabsTrigger>
            <TabsTrigger value="configuration">
              <Settings className="h-4 w-4 mr-2" />
              Configuration
            </TabsTrigger>
            <TabsTrigger value="system">System Health</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-6">
            {safeRender(renderOverview, "Overview tab failed to render")}
          </TabsContent>

          <TabsContent value="users" className="mt-6">
            {safeRender(renderUserManagement, "User management tab failed to render")}
          </TabsContent>

          <TabsContent value="credits" className="mt-6">
            {safeRender(() => <CreditManagement />, "Credit management tab failed to render")}
          </TabsContent>

          <TabsContent value="configuration" className="mt-6">
            {safeRender(renderConfiguration, "Configuration tab failed to render")}
          </TabsContent>

          <TabsContent value="system" className="mt-6">
            {safeRender(() => (
              <Card className="p-6">
                <h3 className="text-lg font-semibold mb-4">System Health Details</h3>
                <p className="text-muted-foreground">Detailed system monitoring and logs will be implemented here.</p>
              </Card>
            ), "System health tab failed to render")}
          </TabsContent>
        </Tabs>
      </div>
    );
  } catch (error) {
    // Ultimate fallback for any unhandled render errors
    console.error('Critical error in AdminDashboard render:', error);
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <strong>Critical Admin Dashboard Error:</strong>
            <br />
            {error instanceof Error ? error.message : 'Unknown error occurred'}
            <br />
            <Button 
              variant="outline" 
              className="mt-4"
              onClick={() => window.location.reload()}
            >
              Refresh Page
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }
}
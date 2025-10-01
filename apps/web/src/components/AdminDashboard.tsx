import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bug,
  CheckCircle,
  Cloud,
  Code,
  CreditCard,
  Database,
  DollarSign,
  ExternalLink,
  GitBranch,
  Globe,
  Key,
  Mail,
  MapPin,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  Server,
  Settings,
  ShieldAlert,
  Users,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  useAdminAnalytics,
  useAdminConfiguration,
  useAdminDashboard,
  useAdminSystemControl,
  useAdminUsers,
} from "@/hooks/useAdmin";
import type { Id, Doc } from "@genni/convex-types/dataModel";
import { CreditManagement } from "./admin/CreditManagement";
import { AdminDocsPanel } from "./admin/AdminDocsPanel";

type CreditCostForm = {
  leadDiscovery: number;
  emailEnrichment: number;
  aiAnalysis: number;
  emailGeneration: number;
  bulkAnalysis: number;
};

type PlanKey = "free" | "pro" | "enterprise";

type PlanLimitFields = {
  monthlyCredits: number;
  maxSearches: number;
  maxLeadsPerSearch: number;
  emailGeneration: boolean;
  bulkOperations: boolean;
  apiAccess: boolean;
};

type PlanLimitsForm = Record<PlanKey, PlanLimitFields>;

type PlanCatalogEntry = {
  _id: Id<"planConfigurations">;
  planId: string;
  planName?: string;
  monthlyPrice?: number;
  yearlyPrice?: number;
  limits?: {
    monthlySearches?: number;
    maxLeadsPerSearch?: number;
    monthlyEnrichments?: number;
    monthlyExports?: number;
    emailGeneration?: boolean;
    bulkOperations?: boolean;
    apiAccess?: boolean;
    requiresOwnApiKeys?: boolean;
    supportLevel?: string;
  };
  features?: string[];
  isActive?: boolean;
  isVisible?: boolean;
  sortOrder?: number;
};

type AdminUser = Doc<"users"> & {
  processingPaused?: boolean;
  pauseReason?: string;
};

type AdminPlan = "starter" | "professional" | "business" | "enterprise";

type SystemActivity = {
  activitySummary?: {
    totalSearches: number;
    failedSearches: number;
    successRate: number;
  };
  systemLogs?: Array<{
    id: string;
    type: string;
    action: string;
    timestamp: number;
  }>;
  recentSearches?: Array<{
    id: Id<"searches">;
    status: string;
    createdAt: number;
    name?: string;
  }>;
  failedOperations?: number;
};

type SystemStatus = {
  maintenanceMode?: boolean;
  leadGenerationPaused?: boolean;
  orchestrationSettings?: {
    pauseReason?: string;
    pausedAt?: number;
  };
  processingQueue?: {
    processing: number;
    queued: number;
    total: number;
  };
  systemLoad?: {
    status: "low" | "medium" | "high";
    activeProcesses: number;
  };
};

type SystemHealth = {
  status?: string;
  failures?: { searches?: number; langGraphRequests?: number };
  processing?: { activeSearches?: number; stuckSearches?: number };
};

// External Services Configuration
interface ExternalService {
  id: string;
  name: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  url: string;
  status?: 'operational' | 'degraded' | 'down' | 'maintenance' | 'coming-soon';
  category: 'infrastructure' | 'monitoring' | 'api' | 'development';
  quickActions?: Array<{
    label: string;
    url: string;
    icon?: React.ComponentType<{ className?: string }>;
  }>;
}

// URL Validation Helper
const validateUrl = (url: string): boolean => {
  try {
    const parsedUrl = new URL(url);
    return parsedUrl.protocol === 'https:' && parsedUrl.hostname.length > 0;
  } catch {
    return false;
  }
};

// Safe External Services Configuration with Production URLs
const getExternalServices = (): ExternalService[] => {
  try {
    const services: ExternalService[] = [
      // Infrastructure & Deployment
      {
        id: 'railway',
        name: 'Railway',
        description: 'Application deployment platform hosting frontend and LangGraph worker',
        icon: Server,
        url: 'https://railway.app/dashboard',
        status: 'operational',
        category: 'infrastructure',
        quickActions: [
          { label: 'View Deployments', url: 'https://railway.app/project' },
          { label: 'Check Logs', url: 'https://railway.app/project' },
          { label: 'Variables', url: 'https://railway.app/project' },
        ]
      },
      {
        id: 'convex',
        name: 'Convex',
        description: 'Real-time backend database with functions and webhooks',
        icon: Database,
        url: 'https://dashboard.convex.dev',
        status: 'operational',
        category: 'infrastructure',
        quickActions: [
          { label: 'Dashboard', url: 'https://dashboard.convex.dev' },
          { label: 'Functions', url: 'https://dashboard.convex.dev' },
          { label: 'Data', url: 'https://dashboard.convex.dev' },
        ]
      },
      {
        id: 'github',
        name: 'GitHub',
        description: 'Source code repository, CI/CD, and project management',
        icon: GitBranch,
        url: 'https://github.com/settings/repositories',
        status: 'operational',
        category: 'development',
        quickActions: [
          { label: 'Repository', url: 'https://github.com' },
          { label: 'Issues', url: 'https://github.com/issues' },
          { label: 'Actions', url: 'https://github.com/actions' },
        ]
      },

      // Monitoring & Analytics
      {
        id: 'posthog',
        name: 'PostHog',
        description: 'User analytics, feature flags, and product insights',
        icon: BarChart3,
        url: 'https://app.posthog.com',
        status: 'operational',
        category: 'monitoring',
        quickActions: [
          { label: 'Analytics', url: 'https://app.posthog.com/insights' },
          { label: 'Feature Flags', url: 'https://app.posthog.com/feature_flags' },
          { label: 'Dashboards', url: 'https://app.posthog.com/dashboard' },
        ]
      },
      {
        id: 'sentry',
        name: 'Sentry',
        description: 'Error monitoring, performance tracking, and debugging',
        icon: Bug,
        url: 'https://sentry.io/organizations/',
        status: 'operational',
        category: 'monitoring',
        quickActions: [
          { label: 'Issues', url: 'https://sentry.io/organizations/' },
          { label: 'Performance', url: 'https://sentry.io/organizations/' },
          { label: 'Releases', url: 'https://sentry.io/organizations/' },
        ]
      },
      {
        id: 'langsmith',
        name: 'LangSmith',
        description: 'LangChain debugging, tracing, and performance monitoring',
        icon: Activity,
        url: 'https://smith.langchain.com',
        status: 'operational',
        category: 'monitoring',
        quickActions: [
          { label: 'Projects', url: 'https://smith.langchain.com/projects' },
          { label: 'Traces', url: 'https://smith.langchain.com/traces' },
          { label: 'Settings', url: 'https://smith.langchain.com/settings' },
        ]
      },

      // APIs & External Services
      {
        id: 'google-cloud',
        name: 'Google Cloud Console',
        description: 'Google Maps API for business location discovery and geocoding',
        icon: MapPin,
        url: 'https://console.cloud.google.com',
        status: 'operational',
        category: 'api',
        quickActions: [
          { label: 'APIs & Services', url: 'https://console.cloud.google.com/apis' },
          { label: 'Billing', url: 'https://console.cloud.google.com/billing' },
          { label: 'IAM', url: 'https://console.cloud.google.com/iam-admin' },
        ]
      },
      {
        id: 'icypeas',
        name: 'IcyPeas',
        description: 'Email enrichment and B2B contact data provider (primary)',
        icon: Cloud,
        url: 'https://www.icypeas.com',
        status: 'operational',
        category: 'api',
        quickActions: [
          { label: 'Dashboard', url: 'https://app.icypeas.com' },
          { label: 'API Docs', url: 'https://api-doc.icypeas.com' },
          { label: 'Credits', url: 'https://app.icypeas.com/credits' },
        ]
      },
      {
        id: 'findymail',
        name: 'FindyMail',
        description: 'Email enrichment and contact data verification (backup to IcyPeas)',
        icon: Mail,
        url: 'https://app.findymail.com',
        status: 'operational',
        category: 'api',
        quickActions: [
          { label: 'Dashboard', url: 'https://app.findymail.com/dashboard' },
          { label: 'Credits', url: 'https://app.findymail.com/credits' },
          { label: 'API Docs', url: 'https://docs.findymail.com' },
        ]
      },
      {
        id: 'resend',
        name: 'Resend',
        description: 'Email delivery infrastructure for transactional emails (coming soon)',
        icon: Mail,
        url: 'https://resend.com',
        status: 'coming-soon',
        category: 'api',
        quickActions: [
          { label: 'Dashboard', url: 'https://resend.com/dashboard' },
          { label: 'Docs', url: 'https://resend.com/docs' },
          { label: 'API Keys', url: 'https://resend.com/api-keys' },
        ]
      },
      {
        id: 'stripe',
        name: 'Stripe',
        description: 'Payment processing, subscriptions, and billing management',
        icon: CreditCard,
        url: 'https://dashboard.stripe.com',
        status: 'operational',
        category: 'api',
        quickActions: [
          { label: 'Dashboard', url: 'https://dashboard.stripe.com' },
          { label: 'Customers', url: 'https://dashboard.stripe.com/customers' },
          { label: 'Payments', url: 'https://dashboard.stripe.com/payments' },
          { label: 'Subscriptions', url: 'https://dashboard.stripe.com/subscriptions' },
        ]
      },
      {
        id: 'clerk',
        name: 'Clerk',
        description: 'Authentication, user management, and session handling',
        icon: Key,
        url: 'https://dashboard.clerk.com',
        status: 'operational',
        category: 'api',
        quickActions: [
          { label: 'Dashboard', url: 'https://dashboard.clerk.com' },
          { label: 'Users', url: 'https://dashboard.clerk.com/users' },
          { label: 'Sessions', url: 'https://dashboard.clerk.com/sessions' },
          { label: 'Webhooks', url: 'https://dashboard.clerk.com/webhooks' },
        ]
      },
    ];

    // Validate all URLs before returning
    return services.filter(service => {
      const isMainUrlValid = validateUrl(service.url);
      const areQuickActionsValid = service.quickActions?.every(action => validateUrl(action.url)) ?? true;

      if (!isMainUrlValid || !areQuickActionsValid) {
        console.warn(`Invalid URL configuration for service: ${service.name}`);
        return false;
      }
      return true;
    });
  } catch (error) {
    console.error('Error initializing external services configuration:', error);
    return [];
  }
};

const TAB_KEYS = [
  "overview",
  "users",
  "credits",
  "configuration",
  "system",
  "services",
  "docs",
] as const;

const DEFAULT_CREDIT_COSTS: CreditCostForm = {
  leadDiscovery: 1,
  emailEnrichment: 2,
  aiAnalysis: 3,
  emailGeneration: 5,
  bulkAnalysis: 10,
};

const DEFAULT_PLAN_LIMITS: PlanLimitsForm = {
  free: {
    monthlyCredits: 50,
    maxSearches: 5,
    maxLeadsPerSearch: 25,
    emailGeneration: true,
    bulkOperations: false,
    apiAccess: false,
  },
  pro: {
    monthlyCredits: 500,
    maxSearches: 50,
    maxLeadsPerSearch: 100,
    emailGeneration: true,
    bulkOperations: true,
    apiAccess: true,
  },
  enterprise: {
    monthlyCredits: 2000,
    maxSearches: -1,
    maxLeadsPerSearch: 500,
    emailGeneration: true,
    bulkOperations: true,
    apiAccess: true,
  },
};

const PLAN_OPTIONS: { value: AdminPlan; label: string }[] = [
  { value: "starter", label: "Starter" },
  { value: "professional", label: "Professional" },
  { value: "business", label: "Business" },
  { value: "enterprise", label: "Enterprise" },
];

const PLAN_LABELS: Record<string, string> = PLAN_OPTIONS.reduce(
  (acc, plan) => ({ ...acc, [plan.value]: plan.label }),
  {},
);

function formatNumber(value: number | undefined) {
  if (value === undefined || Number.isNaN(value)) return "–";
  return new Intl.NumberFormat("en-US").format(value);
}

function formatCurrency(value: number | undefined) {
  if (value === undefined || Number.isNaN(value)) return "–";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatPercentage(value: number | undefined) {
  if (value === undefined || Number.isNaN(value)) return "–";
  return `${value.toFixed(1)}%`;
}

function formatTimestamp(timestamp?: number) {
  if (!timestamp) return "Unknown";
  try {
    return formatDistanceToNow(new Date(timestamp), { addSuffix: true });
  } catch {
    return "Unknown";
  }
}

function isAdminPlan(value: string): value is AdminPlan {
  return PLAN_OPTIONS.some((plan) => plan.value === value);
}

function getUserCreatedAt(user: AdminUser): number | undefined {
  if (typeof user.createdAt === "number") {
    return user.createdAt;
  }
  const withCreationTime = user as { _creationTime?: unknown };
  return typeof withCreationTime._creationTime === "number"
    ? withCreationTime._creationTime
    : undefined;
}

// External Services Panel Component
function ExternalServicesPanel() {
  const { toast } = useToast();
  const externalServices = React.useMemo(() => getExternalServices(), []);

  const getStatusBadgeColor = (status?: string): string => {
    switch (status) {
      case 'operational':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'degraded':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'down':
        return 'bg-red-100 text-red-800 border-red-200';
      case 'maintenance':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'coming-soon':
        return 'bg-purple-100 text-purple-800 border-purple-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const safeOpenUrl = (url: string, serviceName: string) => {
    try {
      if (!validateUrl(url)) {
        toast({
          title: "Invalid URL",
          description: `Cannot open ${serviceName}: Invalid URL configuration.`,
          variant: "destructive",
        });
        return;
      }
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (error) {
      console.error(`Failed to open URL for ${serviceName}:`, error);
      toast({
        title: "Error Opening Service",
        description: `Failed to open ${serviceName}. Please try again.`,
        variant: "destructive",
      });
    }
  };

  if (!externalServices || externalServices.length === 0) {
    return (
      <div className="space-y-6">
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            No external services configured. Please contact system administrator.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const servicesByCategory = externalServices.reduce((acc, service) => {
    if (!service || !service.category) {
      console.warn('Invalid service configuration:', service);
      return acc;
    }
    if (!acc[service.category]) acc[service.category] = [];
    acc[service.category].push(service);
    return acc;
  }, {} as Record<string, ExternalService[]>);

  const categoryTitles: Record<string, string> = {
    infrastructure: 'Infrastructure & Deployment',
    monitoring: 'Monitoring & Analytics',
    api: 'APIs & External Services',
    development: 'Development Tools'
  };

  const operationalServices = externalServices.filter(s => s?.status === 'operational').length;
  const totalQuickActions = externalServices.reduce((sum, service) => sum + (service?.quickActions?.length || 0), 0);

  return (
    <div className="space-y-8">
      {/* Header Section */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold">External Services</h3>
          <p className="text-sm text-muted-foreground">
            Quick access to all external service dashboards and management consoles
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
            <CheckCircle className="h-3 w-3 mr-1" />
            {operationalServices} of {externalServices.length} Operational
          </Badge>
        </div>
      </div>

      {/* Services by Category */}
      {Object.entries(servicesByCategory).map(([category, services]) => {
        const categoryTitle = categoryTitles[category] || category;

        return (
          <div key={category} className="space-y-4">
            <h4 className="text-md font-medium text-muted-foreground border-b pb-2">
              {categoryTitle} ({services.length})
            </h4>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {services.map((service) => {
                const IconComponent = service.icon;

                return (
                  <Card key={service.id} className="p-6 hover:shadow-lg transition-shadow duration-200 border-2">
                    <div className="space-y-4">
                      {/* Header */}
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          <div className="p-2 bg-blue-50 rounded-lg border border-blue-200">
                            <IconComponent className="h-6 w-6 text-blue-600" />
                          </div>
                          <div>
                            <h5 className="font-semibold text-lg">{service.name}</h5>
                            {service.status && (
                              <Badge
                                variant="outline"
                                className={`mt-1 text-xs ${getStatusBadgeColor(service.status)}`}
                              >
                                {service.status === 'coming-soon' ? 'Coming Soon' : service.status.charAt(0).toUpperCase() + service.status.slice(1)}
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Description */}
                      <p className="text-sm text-muted-foreground leading-relaxed line-clamp-3">
                        {service.description}
                      </p>

                      {/* Actions */}
                      <div className="space-y-2">
                        {/* Primary Action */}
                        <Button
                          className="w-full"
                          onClick={() => safeOpenUrl(service.url, service.name)}
                          disabled={!validateUrl(service.url) || service.status === 'coming-soon'}
                          aria-label={`Open ${service.name} in new tab`}
                        >
                          <ExternalLink className="h-4 w-4 mr-2" aria-hidden="true" />
                          {service.status === 'coming-soon' ? 'Coming Soon' : `Open ${service.name}`}
                        </Button>

                        {/* Quick Actions */}
                        {service.quickActions && service.quickActions.length > 0 && service.status !== 'coming-soon' && (
                          <div className="flex flex-wrap gap-1">
                            {service.quickActions.map((action, index) => (
                              <Button
                                key={`${service.id}-${index}`}
                                variant="ghost"
                                size="sm"
                                className="text-xs h-7"
                                onClick={() => safeOpenUrl(action.url, `${service.name} ${action.label}`)}
                                disabled={!validateUrl(action.url)}
                                aria-label={`Open ${service.name} ${action.label} in new tab`}
                              >
                                {action.icon && <action.icon className="h-3 w-3 mr-1" aria-hidden="true" />}
                                {action.label}
                              </Button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Service Summary Stats */}
      <Card className="p-6 border-2">
        <h4 className="text-lg font-semibold mb-4">Service Overview</h4>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="text-center p-3 bg-blue-50 rounded-lg border border-blue-200">
            <div className="text-2xl font-bold text-blue-600">
              {externalServices.length}
            </div>
            <div className="text-sm text-muted-foreground">Total Services</div>
          </div>
          <div className="text-center p-3 bg-green-50 rounded-lg border border-green-200">
            <div className="text-2xl font-bold text-green-600">
              {operationalServices}
            </div>
            <div className="text-sm text-muted-foreground">Operational</div>
          </div>
          <div className="text-center p-3 bg-purple-50 rounded-lg border border-purple-200">
            <div className="text-2xl font-bold text-purple-600">
              {Object.keys(servicesByCategory).length}
            </div>
            <div className="text-sm text-muted-foreground">Categories</div>
          </div>
          <div className="text-center p-3 bg-orange-50 rounded-lg border border-orange-200">
            <div className="text-2xl font-bold text-orange-600">
              {totalQuickActions}
            </div>
            <div className="text-sm text-muted-foreground">Quick Actions</div>
          </div>
        </div>
      </Card>
    </div>
  );
}

export function AdminDashboard() {
  const location = useLocation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const historySyncDisabledRef = useRef(false);
  const lastSyncedSearchRef = useRef<string | null>(null);

  const {
    metrics,
    systemHealth,
    isLoading: metricsLoading,
  } = useAdminDashboard();
  const {
    users,
    updateUserStatus,
    updateUserPlan,
    pauseUserProcessing,
    resumeUserProcessing,
    isLoading: usersLoading,
  } = useAdminUsers();
  const {
    analytics,
    revenueStats,
    usageStats,
    isLoading: analyticsLoading,
  } = useAdminAnalytics();
  const {
    configuration,
    updateCreditCosts,
    updatePlanLimits,
    listPlanConfigurations,
    isLoading: configurationLoading,
  } = useAdminConfiguration();
  const {
    systemStatus,
    systemActivity,
    systemConfiguration,
    pauseAllLeadGeneration,
    resumeAllLeadGeneration,
    clearAllActiveSearches,
    triggerLangGraphHealthCheck,
    isLoading: systemLoading,
  } = useAdminSystemControl();

  const [currentTab, setCurrentTab] = useState<(typeof TAB_KEYS)[number]>("overview");
  const [searchTerm, setSearchTerm] = useState("");
  const [creditCostsForm, setCreditCostsForm] = useState<CreditCostForm>(DEFAULT_CREDIT_COSTS);
  const [planLimitsForm, setPlanLimitsForm] = useState<PlanLimitsForm>(DEFAULT_PLAN_LIMITS);
  const [savingCreditCosts, setSavingCreditCosts] = useState(false);
  const [savingPlanLimits, setSavingPlanLimits] = useState(false);
  const [updatingUserId, setUpdatingUserId] = useState<Id<"users"> | null>(null);
  const [processingUserId, setProcessingUserId] = useState<Id<"users"> | null>(null);
  const [systemActionPending, setSystemActionPending] = useState(false);
  const [healthCheckPending, setHealthCheckPending] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const fromQuery = params.get("tab");
    const fromHash = location.hash ? location.hash.replace(/^#/, "") : null;
    const candidate = (fromQuery || fromHash) as (typeof TAB_KEYS)[number] | null;

    // Only update state if URL has a valid tab that differs from current state
    if (candidate && TAB_KEYS.includes(candidate) && candidate !== currentTab) {
      setCurrentTab(candidate);
    }
  }, [location.search, location.hash]); // Removed currentTab from deps to prevent loop

  useEffect(() => {
    // Skip if history sync is disabled
    if (historySyncDisabledRef.current) {
      return;
    }

    const params = new URLSearchParams(location.search);
    const currentTabInUrl = params.get("tab");

    // Skip if URL already matches current tab
    if (currentTabInUrl === currentTab) {
      lastSyncedSearchRef.current = params.toString();
      return;
    }

    // Update URL to match current tab
    params.set("tab", currentTab);
    const nextSearch = params.toString();

    // Prevent redundant navigation
    if (lastSyncedSearchRef.current === nextSearch) {
      return;
    }

    try {
      navigate(
        {
          pathname: location.pathname,
          search: nextSearch ? `?${nextSearch}` : "",
        },
        { replace: true },
      );
      lastSyncedSearchRef.current = nextSearch;
    } catch (error) {
      if (error instanceof DOMException && error.name === "SecurityError") {
        historySyncDisabledRef.current = true;
        console.warn(
          "Failed to sync admin tab to URL due to browser security restrictions.",
          error,
        );
      } else {
        throw error;
      }
    }
  }, [currentTab, location.pathname, navigate]); // Removed location.search from deps to prevent loop

  useEffect(() => {
    if (configuration?.creditCosts) {
      setCreditCostsForm({
        leadDiscovery:
          typeof configuration.creditCosts.LEAD_DISCOVERY === "number"
            ? configuration.creditCosts.LEAD_DISCOVERY
            : DEFAULT_CREDIT_COSTS.leadDiscovery,
        emailEnrichment:
          typeof configuration.creditCosts.EMAIL_ENRICHMENT === "number"
            ? configuration.creditCosts.EMAIL_ENRICHMENT
            : DEFAULT_CREDIT_COSTS.emailEnrichment,
        aiAnalysis:
          typeof configuration.creditCosts.AI_ANALYSIS === "number"
            ? configuration.creditCosts.AI_ANALYSIS
            : DEFAULT_CREDIT_COSTS.aiAnalysis,
        emailGeneration:
          typeof configuration.creditCosts.EMAIL_GENERATION === "number"
            ? configuration.creditCosts.EMAIL_GENERATION
            : DEFAULT_CREDIT_COSTS.emailGeneration,
        bulkAnalysis:
          typeof configuration.creditCosts.BULK_ANALYSIS === "number"
            ? configuration.creditCosts.BULK_ANALYSIS
            : DEFAULT_CREDIT_COSTS.bulkAnalysis,
      });
    }
  }, [configuration?.creditCosts]);

  useEffect(() => {
    if (configuration?.planLimits) {
      setPlanLimitsForm({
        free: {
          monthlyCredits:
            typeof configuration.planLimits.free?.monthlyCredits === "number"
              ? configuration.planLimits.free.monthlyCredits
              : DEFAULT_PLAN_LIMITS.free.monthlyCredits,
          maxSearches:
            typeof configuration.planLimits.free?.maxSearches === "number"
              ? configuration.planLimits.free.maxSearches
              : DEFAULT_PLAN_LIMITS.free.maxSearches,
          maxLeadsPerSearch:
            typeof configuration.planLimits.free?.maxLeadsPerSearch === "number"
              ? configuration.planLimits.free.maxLeadsPerSearch
              : DEFAULT_PLAN_LIMITS.free.maxLeadsPerSearch,
          emailGeneration:
            typeof configuration.planLimits.free?.emailGeneration === "boolean"
              ? configuration.planLimits.free.emailGeneration
              : DEFAULT_PLAN_LIMITS.free.emailGeneration,
          bulkOperations:
            typeof configuration.planLimits.free?.bulkOperations === "boolean"
              ? configuration.planLimits.free.bulkOperations
              : DEFAULT_PLAN_LIMITS.free.bulkOperations,
          apiAccess:
            typeof configuration.planLimits.free?.apiAccess === "boolean"
              ? configuration.planLimits.free.apiAccess
              : DEFAULT_PLAN_LIMITS.free.apiAccess,
        },
        pro: {
          monthlyCredits:
            typeof configuration.planLimits.pro?.monthlyCredits === "number"
              ? configuration.planLimits.pro.monthlyCredits
              : DEFAULT_PLAN_LIMITS.pro.monthlyCredits,
          maxSearches:
            typeof configuration.planLimits.pro?.maxSearches === "number"
              ? configuration.planLimits.pro.maxSearches
              : DEFAULT_PLAN_LIMITS.pro.maxSearches,
          maxLeadsPerSearch:
            typeof configuration.planLimits.pro?.maxLeadsPerSearch === "number"
              ? configuration.planLimits.pro.maxLeadsPerSearch
              : DEFAULT_PLAN_LIMITS.pro.maxLeadsPerSearch,
          emailGeneration:
            typeof configuration.planLimits.pro?.emailGeneration === "boolean"
              ? configuration.planLimits.pro.emailGeneration
              : DEFAULT_PLAN_LIMITS.pro.emailGeneration,
          bulkOperations:
            typeof configuration.planLimits.pro?.bulkOperations === "boolean"
              ? configuration.planLimits.pro.bulkOperations
              : DEFAULT_PLAN_LIMITS.pro.bulkOperations,
          apiAccess:
            typeof configuration.planLimits.pro?.apiAccess === "boolean"
              ? configuration.planLimits.pro.apiAccess
              : DEFAULT_PLAN_LIMITS.pro.apiAccess,
        },
        enterprise: {
          monthlyCredits:
            typeof configuration.planLimits.enterprise?.monthlyCredits === "number"
              ? configuration.planLimits.enterprise.monthlyCredits
              : DEFAULT_PLAN_LIMITS.enterprise.monthlyCredits,
          maxSearches:
            typeof configuration.planLimits.enterprise?.maxSearches === "number"
              ? configuration.planLimits.enterprise.maxSearches
              : DEFAULT_PLAN_LIMITS.enterprise.maxSearches,
          maxLeadsPerSearch:
            typeof configuration.planLimits.enterprise?.maxLeadsPerSearch === "number"
              ? configuration.planLimits.enterprise.maxLeadsPerSearch
              : DEFAULT_PLAN_LIMITS.enterprise.maxLeadsPerSearch,
          emailGeneration:
            typeof configuration.planLimits.enterprise?.emailGeneration === "boolean"
              ? configuration.planLimits.enterprise.emailGeneration
              : DEFAULT_PLAN_LIMITS.enterprise.emailGeneration,
          bulkOperations:
            typeof configuration.planLimits.enterprise?.bulkOperations === "boolean"
              ? configuration.planLimits.enterprise.bulkOperations
              : DEFAULT_PLAN_LIMITS.enterprise.bulkOperations,
          apiAccess:
            typeof configuration.planLimits.enterprise?.apiAccess === "boolean"
              ? configuration.planLimits.enterprise.apiAccess
              : DEFAULT_PLAN_LIMITS.enterprise.apiAccess,
        },
      });
    }
  }, [configuration?.planLimits]);

  const filteredUsers = useMemo(() => {
    if (!searchTerm.trim()) return users as AdminUser[];
    const query = searchTerm.toLowerCase();
    return (users as AdminUser[]).filter((user) => {
      const haystack = [user.email, user.name, user.plan, user.role]
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.toLowerCase());
      return haystack.some((value) => value.includes(query));
    });
  }, [users, searchTerm]);

  const planDistribution = useMemo(() => {
    const distribution = metrics?.users?.planDistribution as
      | Record<string, number>
      | undefined;
    if (!distribution) return [] as Array<[string, number]>;
    return Object.entries(distribution).sort((a, b) => b[1] - a[1]);
  }, [metrics?.users?.planDistribution]);

  const activity = (systemActivity || {}) as SystemActivity;
  const status = (systemStatus || {}) as SystemStatus;
  const health = (systemHealth || {}) as SystemHealth;

  const handleToggleUserActive = async (user: AdminUser) => {
    setUpdatingUserId(user._id);
    try {
      await updateUserStatus({
        userId: user._id,
        isActive: !user.isActive,
      });
      toast({
        title: "User status updated",
        description: `${user.email} is now ${!user.isActive ? "active" : "suspended"}.`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to update user";
      toast({ title: "Update failed", description: message, variant: "destructive" });
    } finally {
      setUpdatingUserId(null);
    }
  };

  const handleUserPlanChange = async (user: AdminUser, plan: AdminPlan) => {
    setUpdatingUserId(user._id);
    try {
      await updateUserPlan({ userId: user._id, plan });
      toast({
        title: "Plan updated",
        description: `${user.email} moved to ${PLAN_LABELS[plan]}.`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to update plan";
      toast({ title: "Update failed", description: message, variant: "destructive" });
    } finally {
      setUpdatingUserId(null);
    }
  };

  const handlePauseProcessing = async (user: AdminUser) => {
    setProcessingUserId(user._id);
    try {
      const reason = window.prompt("Reason for pausing processing?", user.pauseReason || "");
      await pauseUserProcessing({ userId: user._id, reason: reason || undefined });
      toast({
        title: "Processing paused",
        description: `${user.email} will no longer run new searches until resumed.`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to pause processing";
      toast({ title: "Action failed", description: message, variant: "destructive" });
    } finally {
      setProcessingUserId(null);
    }
  };

  const handleResumeProcessing = async (user: AdminUser) => {
    setProcessingUserId(user._id);
    try {
      await resumeUserProcessing({ userId: user._id });
      toast({
        title: "Processing resumed",
        description: `${user.email} can run new searches again.`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to resume processing";
      toast({ title: "Action failed", description: message, variant: "destructive" });
    } finally {
      setProcessingUserId(null);
    }
  };

  const handleSaveCreditCosts = async () => {
    setSavingCreditCosts(true);
    try {
      await updateCreditCosts({
        creditCosts: {
          LEAD_DISCOVERY: creditCostsForm.leadDiscovery,
          EMAIL_ENRICHMENT: creditCostsForm.emailEnrichment,
          AI_ANALYSIS: creditCostsForm.aiAnalysis,
          EMAIL_GENERATION: creditCostsForm.emailGeneration,
          BULK_ANALYSIS: creditCostsForm.bulkAnalysis,
        },
      });
      toast({ title: "Credit costs updated", description: "New costs saved successfully." });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to save credit costs";
      toast({ title: "Save failed", description: message, variant: "destructive" });
    } finally {
      setSavingCreditCosts(false);
    }
  };

  const handleSavePlanLimits = async () => {
    setSavingPlanLimits(true);
    try {
      await updatePlanLimits({ planLimits: planLimitsForm });
      toast({ title: "Plan limits updated", description: "Limits saved successfully." });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to save plan limits";
      toast({ title: "Save failed", description: message, variant: "destructive" });
    } finally {
      setSavingPlanLimits(false);
    }
  };

  const handlePauseLeadGeneration = async () => {
    if (!window.confirm("Pause all lead generation and cancel active searches?")) {
      return;
    }
    const reason = window.prompt("Reason for pausing the system?", "Emergency stop");
    setSystemActionPending(true);
    try {
      const result = await pauseAllLeadGeneration({ reason: reason || undefined });
      toast({
        title: "Lead generation paused",
        description:
          result && typeof result.cancelledSearches === "number"
            ? `Cancelled ${result.cancelledSearches} searches`
            : "System is now paused.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to pause system";
      toast({ title: "Action failed", description: message, variant: "destructive" });
    } finally {
      setSystemActionPending(false);
    }
  };

  const handleResumeLeadGeneration = async () => {
    setSystemActionPending(true);
    try {
      const result = await resumeAllLeadGeneration();
      toast({
        title: "Lead generation resumed",
        description: result?.message || "System resumed successfully.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to resume system";
      toast({ title: "Action failed", description: message, variant: "destructive" });
    } finally {
      setSystemActionPending(false);
    }
  };

  const handleClearActiveSearches = async () => {
    if (!window.confirm("Clear all active searches and refund credits?")) {
      return;
    }
    const reason = window.prompt("Reason for clearing active searches?", "Administrative cleanup");
    setSystemActionPending(true);
    try {
      const result = await clearAllActiveSearches({ reason: reason || undefined });
      toast({
        title: "Active searches cleared",
        description:
          result && typeof result.clearedCount === "number"
            ? `Cleared ${result.clearedCount} searches`
            : "Cleanup completed.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to clear searches";
      toast({ title: "Action failed", description: message, variant: "destructive" });
    } finally {
      setSystemActionPending(false);
    }
  };

  const handleTriggerHealthCheck = async () => {
    setHealthCheckPending(true);
    try {
      const result = await triggerLangGraphHealthCheck();
      toast({
        title: "Health check triggered",
        description: result?.message || "Health check initiated successfully.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to trigger health check";
      toast({ title: "Action failed", description: message, variant: "destructive" });
    } finally {
      setHealthCheckPending(false);
    }
  };

  const overviewLoading = metricsLoading || analyticsLoading;
  const configurationSaving = savingCreditCosts || savingPlanLimits;

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Admin Dashboard</h1>
          <p className="text-muted-foreground">
            Monitor platform health, manage users, and configure system policies.
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            variant="outline"
            onClick={handlePauseLeadGeneration}
            disabled={systemActionPending}
          >
            <PauseCircle className="mr-2 h-4 w-4" /> Pause lead gen
          </Button>
          <Button
            variant="outline"
            onClick={handleResumeLeadGeneration}
            disabled={systemActionPending}
          >
            <PlayCircle className="mr-2 h-4 w-4" /> Resume lead gen
          </Button>
          <Button
            variant="outline"
            onClick={handleClearActiveSearches}
            disabled={systemActionPending}
          >
            <RefreshCw className="mr-2 h-4 w-4" /> Clear active searches
          </Button>
        </div>
      </div>

      <Tabs value={currentTab} onValueChange={(value) => setCurrentTab(value as (typeof TAB_KEYS)[number])}>
        <TabsList className="grid w-full grid-cols-2 md:grid-cols-7">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="credits">Credits</TabsTrigger>
          <TabsTrigger value="configuration">Configuration</TabsTrigger>
          <TabsTrigger value="system">System</TabsTrigger>
          <TabsTrigger value="services">Services</TabsTrigger>
          <TabsTrigger value="docs">Docs</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total users</CardTitle>
                <Users className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                {overviewLoading ? (
                  <Skeleton className="h-9 w-24" />
                ) : (
                  <div className="text-2xl font-bold">
                    {formatNumber(metrics?.users?.total)}
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  Active users: {formatNumber(metrics?.users?.active)}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Monthly revenue</CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                {overviewLoading ? (
                  <Skeleton className="h-9 w-24" />
                ) : (
                  <div className="text-2xl font-bold">
                    {formatCurrency(revenueStats?.revenueThisMonth)}
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  Purchases this week: {formatCurrency(revenueStats?.revenueThisWeek)}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Search volume</CardTitle>
                <Activity className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                {overviewLoading ? (
                  <Skeleton className="h-9 w-24" />
                ) : (
                  <div className="text-2xl font-bold">
                    {formatNumber(usageStats?.totalSearches)}
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  Avg leads per search: {formatNumber(usageStats?.averageLeadsPerSearch)}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">System health</CardTitle>
                <ShieldAlert className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                {systemLoading ? (
                  <Skeleton className="h-9 w-32" />
                ) : (
                  <div className="flex items-center gap-2 text-2xl font-bold">
                    {health.status || "Unknown"}
                    {health.failures?.searches ? (
                      <Badge variant="destructive">{health.failures.searches} failures</Badge>
                    ) : null}
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  Active searches: {formatNumber(health.processing?.activeSearches)}
                </p>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Plan distribution</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {planDistribution.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No plan data available.</p>
                ) : (
                  planDistribution.map(([plan, count]) => (
                    <div key={plan} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">
                          {PLAN_LABELS[plan] || plan}
                        </Badge>
                        <span className="text-sm text-muted-foreground">{count} users</span>
                      </div>
                      <span className="text-sm font-medium">
                        {formatPercentage(
                          metrics?.users?.total
                            ? (count / metrics.users.total) * 100
                            : undefined,
                        )}
                      </span>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Engagement</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <BarChart3 className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">User growth (30d)</span>
                  </div>
                  <span className="text-sm font-medium">
                    {formatNumber(analytics?.growth?.userGrowth30d)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <BarChart3 className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">Search growth (30d)</span>
                  </div>
                  <span className="text-sm font-medium">
                    {formatNumber(analytics?.growth?.searchGrowth30d)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <BarChart3 className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">Credit spend (30d)</span>
                  </div>
                  <span className="text-sm font-medium">
                    {formatNumber(metrics?.credits?.spent30d)} credits
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="users" className="space-y-4">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-2xl font-semibold">User management</h2>
              <p className="text-sm text-muted-foreground">
                Suspend accounts, adjust plans, and control processing per user.
              </p>
            </div>
            <Input
              className="md:w-64"
              placeholder="Search by email, name, or plan"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
            />
          </div>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Credits</TableHead>
                    <TableHead>Processing</TableHead>
                    <TableHead className="w-[220px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {usersLoading ? (
                    <TableRow>
                      <TableCell colSpan={6}>
                        <div className="p-6 text-center text-sm text-muted-foreground">
                          Loading users…
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : filteredUsers.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6}>
                        <div className="p-6 text-center text-sm text-muted-foreground">
                          No users match your filters.
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredUsers.map((user) => (
                      <TableRow key={user._id}>
                        <TableCell>
                          <div className="space-y-1">
                            <div className="font-medium">{user.email}</div>
                            {user.name ? (
                              <div className="text-xs text-muted-foreground">{user.name}</div>
                            ) : null}
                            <div className="text-xs text-muted-foreground">
                              Joined {formatTimestamp(getUserCreatedAt(user))}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Select
                            value={isAdminPlan(user.plan) ? user.plan : undefined}
                            onValueChange={(value) => handleUserPlanChange(user, value as AdminPlan)}
                            disabled={updatingUserId === user._id}
                          >
                            <SelectTrigger className="w-[160px]">
                              <SelectValue placeholder={user.plan || "Select plan"} />
                            </SelectTrigger>
                            <SelectContent>
                              {PLAN_OPTIONS.map((plan) => (
                                <SelectItem key={plan.value} value={plan.value}>
                                  {plan.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Badge variant={user.isActive ? "default" : "destructive"}>
                            {user.isActive ? "Active" : "Suspended"}
                          </Badge>
                        </TableCell>
                        <TableCell>{formatNumber(user.credits)}</TableCell>
                        <TableCell>
                          {user.processingPaused ? (
                            <Badge variant="outline">Paused</Badge>
                          ) : (
                            <Badge variant="outline" className="bg-green-500/10 text-green-600">
                              Running
                            </Badge>
                          )}
                          {user.pauseReason ? (
                            <div className="text-xs text-muted-foreground mt-1">
                              {user.pauseReason}
                            </div>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleToggleUserActive(user)}
                              disabled={updatingUserId === user._id}
                            >
                              {user.isActive ? "Suspend" : "Activate"}
                            </Button>
                            {user.processingPaused ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleResumeProcessing(user)}
                                disabled={processingUserId === user._id}
                              >
                                Resume
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handlePauseProcessing(user)}
                                disabled={processingUserId === user._id}
                              >
                                Pause
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="credits" className="space-y-4">
          <CreditManagement />
        </TabsContent>

        <TabsContent value="configuration" className="space-y-6">
          <div>
            <h2 className="text-2xl font-semibold">System configuration</h2>
            <p className="text-sm text-muted-foreground">
              Tune credit pricing, plan limits, and review plan catalog entries.
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Credit costs</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {Object.entries(creditCostsForm).map(([key, value]) => (
                  <div key={key} className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">
                      {key.replace(/([A-Z])/g, " $1").replace(/^\w/, (s) => s.toUpperCase())}
                    </label>
                    <Input
                      type="number"
                      value={value}
                      min={0}
                      onChange={(event) =>
                        setCreditCostsForm((current) => ({
                          ...current,
                          [key]: Number.parseInt(event.target.value, 10) || 0,
                        }))
                      }
                    />
                  </div>
                ))}
                <Button onClick={handleSaveCreditCosts} disabled={savingCreditCosts}>
                  Save credit costs
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Orchestration</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm">Lead generation paused</span>
                  <Badge variant={status.leadGenerationPaused ? "destructive" : "outline"}>
                    {status.leadGenerationPaused ? "Paused" : "Running"}
                  </Badge>
                </div>
                {status.orchestrationSettings?.pauseReason ? (
                  <div className="text-xs text-muted-foreground">
                    Reason: {status.orchestrationSettings.pauseReason}
                  </div>
                ) : null}
                {status.orchestrationSettings?.pausedAt ? (
                  <div className="text-xs text-muted-foreground">
                    Since {formatTimestamp(status.orchestrationSettings.pausedAt)}
                  </div>
                ) : null}
                <div className="space-y-2">
                  <div className="text-sm font-medium">Processing queue</div>
                  <div className="text-xs text-muted-foreground">
                    Processing: {formatNumber(status.processingQueue?.processing)} • Queued: {" "}
                    {formatNumber(status.processingQueue?.queued)}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Plan limits</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {(Object.keys(planLimitsForm) as PlanKey[]).map((planKey) => {
                const plan = planLimitsForm[planKey];
                return (
                  <div key={planKey} className="grid gap-4 md:grid-cols-3">
                    <div>
                      <h3 className="text-lg font-semibold capitalize">{planKey}</h3>
                      <p className="text-xs text-muted-foreground">
                        Configure the maximum usage for the {planKey} tier.
                      </p>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">
                        Monthly credits
                      </label>
                      <Input
                        type="number"
                        value={plan.monthlyCredits}
                        onChange={(event) =>
                          setPlanLimitsForm((current) => ({
                            ...current,
                            [planKey]: {
                              ...current[planKey],
                              monthlyCredits:
                                Number.parseInt(event.target.value, 10) || current[planKey].monthlyCredits,
                            },
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">
                        Max searches (-1 = unlimited)
                      </label>
                      <Input
                        type="number"
                        value={plan.maxSearches}
                        onChange={(event) =>
                          setPlanLimitsForm((current) => ({
                            ...current,
                            [planKey]: {
                              ...current[planKey],
                              maxSearches: Number.parseInt(event.target.value, 10) || 0,
                            },
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">
                        Max leads per search
                      </label>
                      <Input
                        type="number"
                        value={plan.maxLeadsPerSearch}
                        onChange={(event) =>
                          setPlanLimitsForm((current) => ({
                            ...current,
                            [planKey]: {
                              ...current[planKey],
                              maxLeadsPerSearch: Number.parseInt(event.target.value, 10) || 0,
                            },
                          }))
                        }
                      />
                    </div>
                    <div className="flex items-center justify-between border rounded-md p-3">
                      <span className="text-sm">Email generation</span>
                      <Switch
                        checked={plan.emailGeneration}
                        onCheckedChange={(checked) =>
                          setPlanLimitsForm((current) => ({
                            ...current,
                            [planKey]: { ...current[planKey], emailGeneration: checked },
                          }))
                        }
                      />
                    </div>
                    <div className="flex items-center justify-between border rounded-md p-3">
                      <span className="text-sm">Bulk operations</span>
                      <Switch
                        checked={plan.bulkOperations}
                        onCheckedChange={(checked) =>
                          setPlanLimitsForm((current) => ({
                            ...current,
                            [planKey]: { ...current[planKey], bulkOperations: checked },
                          }))
                        }
                      />
                    </div>
                    <div className="flex items-center justify-between border rounded-md p-3">
                      <span className="text-sm">API access</span>
                      <Switch
                        checked={plan.apiAccess}
                        onCheckedChange={(checked) =>
                          setPlanLimitsForm((current) => ({
                            ...current,
                            [planKey]: { ...current[planKey], apiAccess: checked },
                          }))
                        }
                      />
                    </div>
                  </div>
                );
              })}
              <Button onClick={handleSavePlanLimits} disabled={savingPlanLimits}>
                Save plan limits
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Plan catalog</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {configurationLoading ? (
                <Skeleton className="h-10 w-full" />
              ) : Array.isArray(listPlanConfigurations) && listPlanConfigurations.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Plan</TableHead>
                      <TableHead>Monthly</TableHead>
                      <TableHead>Yearly</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Features</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(listPlanConfigurations as PlanCatalogEntry[]).map((plan) => (
                      <TableRow key={plan._id}>
                        <TableCell>
                          <div className="font-medium">{plan.planName || plan.planId}</div>
                          <div className="text-xs text-muted-foreground">ID: {plan.planId}</div>
                        </TableCell>
                        <TableCell>{formatCurrency(plan.monthlyPrice)}</TableCell>
                        <TableCell>{formatCurrency(plan.yearlyPrice)}</TableCell>
                        <TableCell>
                          <Badge variant={plan.isActive ? "default" : "outline"}>
                            {plan.isActive ? "Active" : "Inactive"}
                          </Badge>
                          {!plan.isVisible ? (
                            <div className="text-xs text-muted-foreground">Hidden</div>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <div className="text-xs text-muted-foreground max-w-xs">
                            {(plan.features || []).slice(0, 5).join(", ") || "—"}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-sm text-muted-foreground">No plan catalog entries available.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="system" className="space-y-6">
          <div>
            <h2 className="text-2xl font-semibold">System status</h2>
            <p className="text-sm text-muted-foreground">
              Monitor processing queues, recent failures, and operational activity.
            </p>
          </div>

          {/* LangGraph Worker Health Status */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle>LangGraph Worker Health</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  Real-time monitoring of AI worker service connectivity and performance
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleTriggerHealthCheck}
                disabled={healthCheckPending}
              >
                <RefreshCw className={`mr-2 h-4 w-4 ${healthCheckPending ? "animate-spin" : ""}`} />
                {healthCheckPending ? "Checking..." : "Check Now"}
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              {systemConfiguration?.orchestrationSettings?.langGraphHealth ? (
                <>
                  {/* Health Status Badge */}
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Status</span>
                    <Badge
                      variant={
                        systemConfiguration.orchestrationSettings.langGraphHealth.status === "healthy"
                          ? "default"
                          : systemConfiguration.orchestrationSettings.langGraphHealth.status === "degraded"
                          ? "outline"
                          : "destructive"
                      }
                      className={
                        systemConfiguration.orchestrationSettings.langGraphHealth.status === "healthy"
                          ? "bg-green-500"
                          : systemConfiguration.orchestrationSettings.langGraphHealth.status === "degraded"
                          ? "bg-yellow-500 text-white"
                          : ""
                      }
                    >
                      {systemConfiguration.orchestrationSettings.langGraphHealth.status.toUpperCase()}
                    </Badge>
                  </div>

                  {/* Last Checked / Last Success */}
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-muted-foreground">Last Checked</span>
                      <div className="font-medium">
                        {formatTimestamp(systemConfiguration.orchestrationSettings.langGraphHealth.lastCheckedAt)}
                      </div>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Last Success</span>
                      <div className="font-medium">
                        {formatTimestamp(systemConfiguration.orchestrationSettings.langGraphHealth.lastSuccessAt)}
                      </div>
                    </div>
                  </div>

                  {/* Consecutive Failures */}
                  {systemConfiguration.orchestrationSettings.langGraphHealth.consecutiveFailures > 0 && (
                    <Alert variant="destructive">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertDescription>
                        {systemConfiguration.orchestrationSettings.langGraphHealth.consecutiveFailures} consecutive failures detected
                        {systemConfiguration.orchestrationSettings.langGraphHealth.lastError && (
                          <div className="mt-1 text-xs">Error: {systemConfiguration.orchestrationSettings.langGraphHealth.lastError}</div>
                        )}
                      </AlertDescription>
                    </Alert>
                  )}

                  {/* Service Statuses */}
                  {systemConfiguration.orchestrationSettings.langGraphHealth.services && (
                    <div>
                      <h4 className="text-sm font-medium mb-2">Service Status</h4>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <div className="flex items-center gap-2 text-sm">
                          <div
                            className={`w-2 h-2 rounded-full ${
                              systemConfiguration.orchestrationSettings.langGraphHealth.services.fastapi
                                ? "bg-green-500"
                                : "bg-red-500"
                            }`}
                          />
                          <span>FastAPI</span>
                        </div>
                        <div className="flex items-center gap-2 text-sm">
                          <div
                            className={`w-2 h-2 rounded-full ${
                              systemConfiguration.orchestrationSettings.langGraphHealth.services.langgraph
                                ? "bg-green-500"
                                : "bg-red-500"
                            }`}
                          />
                          <span>LangGraph</span>
                        </div>
                        <div className="flex items-center gap-2 text-sm">
                          <div
                            className={`w-2 h-2 rounded-full ${
                              systemConfiguration.orchestrationSettings.langGraphHealth.services.openai
                                ? "bg-green-500"
                                : "bg-red-500"
                            }`}
                          />
                          <span>OpenAI</span>
                        </div>
                        <div className="flex items-center gap-2 text-sm">
                          <div
                            className={`w-2 h-2 rounded-full ${
                              systemConfiguration.orchestrationSettings.langGraphHealth.services.convex
                                ? "bg-green-500"
                                : "bg-red-500"
                            }`}
                          />
                          <span>Convex</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Performance Metrics */}
                  {systemConfiguration.orchestrationSettings.langGraphHealth.performance && (
                    <div>
                      <h4 className="text-sm font-medium mb-2">Performance Metrics</h4>
                      <div className="grid grid-cols-3 gap-4 text-sm">
                        <div>
                          <span className="text-muted-foreground">Active Tasks</span>
                          <div className="font-medium">
                            {systemConfiguration.orchestrationSettings.langGraphHealth.performance.activeTasks || 0}
                          </div>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Queue Size</span>
                          <div className="font-medium">
                            {systemConfiguration.orchestrationSettings.langGraphHealth.performance.queueSize || 0}
                          </div>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Memory Usage</span>
                          <div className="font-medium">
                            {systemConfiguration.orchestrationSettings.langGraphHealth.performance.memoryUsage
                              ? `${Math.round(systemConfiguration.orchestrationSettings.langGraphHealth.performance.memoryUsage)}%`
                              : "N/A"}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-sm text-muted-foreground">
                  No health data available. Health checks run every 2 minutes.
                </div>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle>Processing queue</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="text-2xl font-bold">
                  {formatNumber(status.processingQueue?.total)}
                </div>
                <div className="text-xs text-muted-foreground">
                  Processing: {formatNumber(status.processingQueue?.processing)} • Queued: {" "}
                  {formatNumber(status.processingQueue?.queued)}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>System load</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="text-2xl font-bold capitalize">
                  {status.systemLoad?.status || "unknown"}
                </div>
                <div className="text-xs text-muted-foreground">
                  Active orchestration processes: {formatNumber(status.systemLoad?.activeProcesses)}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Activity summary</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="text-2xl font-bold">
                  {formatNumber(activity.activitySummary?.totalSearches)}
                </div>
                <div className="text-xs text-muted-foreground">
                  Success rate: {formatPercentage(activity.activitySummary?.successRate)}
                </div>
                {activity.activitySummary?.failedSearches ? (
                  <div className="flex items-center gap-2 text-xs text-red-600">
                    <AlertTriangle className="h-3 w-3" /> {activity.activitySummary.failedSearches} failures last hour
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Recent system logs</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {activity.systemLogs && activity.systemLogs.length > 0 ? (
                activity.systemLogs.slice(0, 10).map((log) => (
                  <div key={log.id} className="flex items-center justify-between text-sm">
                    <div>
                      <div className="font-medium capitalize">{log.action.replace(/_/g, " ")}</div>
                      <div className="text-xs text-muted-foreground">{log.type}</div>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatTimestamp(log.timestamp)}
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">No recent log entries.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent searches</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {activity.recentSearches && activity.recentSearches.length > 0 ? (
                activity.recentSearches.slice(0, 10).map((search) => (
                  <div key={search.id} className="flex items-center justify-between text-sm">
                    <div>
                      <div className="font-medium">{search.name || search.id}</div>
                      <div className="text-xs text-muted-foreground">Status: {search.status}</div>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatTimestamp(search.createdAt)}
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">No searches in the last hour.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="services" className="space-y-4">
          <ExternalServicesPanel />
        </TabsContent>

        <TabsContent value="docs" className="space-y-4">
          <AdminDocsPanel />
        </TabsContent>
      </Tabs>

      {configurationSaving ? (
        <Alert>
          <AlertDescription>Saving configuration changes…</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

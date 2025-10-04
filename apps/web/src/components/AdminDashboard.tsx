import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  BrainCircuit,
  CheckCircle,
  CircuitBoard,
  Code,
  Database,
  DollarSign,
  ExternalLink,
  Globe,
  KeyRound,
  Layers,
  LineChart,
  Mail,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  Search,
  Server,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Users,
  Workflow,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
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
import { withErrorBoundary } from "@/utils/errorHandling";
import { createLogger } from "@/utils/logger";

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
type ExternalService = {
  name: string;
  description: string;
  href: string;
  icon: LucideIcon;
  docsLabel?: string;
  requiresKey?: boolean;
  envVars?: string[];
  notes?: string;
};

type ExternalServiceGroup = {
  title: string;
  description: string;
  services: ExternalService[];
};

// URL Validation Helper
const validateUrl = (url: string): boolean => {
  try {
    const parsedUrl = new URL(url);
    return parsedUrl.protocol === 'https:' && parsedUrl.hostname.length > 0;
  } catch {
    return false;
  }
};

const EXTERNAL_SERVICE_GROUPS: ExternalServiceGroup[] = [
  {
    title: "AI & Workflow Stack",
    description: "Core frameworks and research providers powering Genni's AI pipeline.",
    services: [
      {
        name: "LangChain",
        description: "Primary orchestration framework for tool-augmented AI agents and pipelines.",
        href: "https://python.langchain.com/docs/",
        icon: Workflow,
        docsLabel: "LangChain docs",
      },
      {
        name: "LangGraph",
        description: "Graph-native runtime for stateful agent workflows used by the worker service.",
        href: "https://langchain-ai.github.io/langgraph/",
        icon: BrainCircuit,
        docsLabel: "LangGraph guides",
      },
      {
        name: "OpenAI Platform",
        description: "GPT models that power analysis and outreach. Required for AI generation steps.",
        href: "https://platform.openai.com/",
        icon: Sparkles,
        docsLabel: "OpenAI console",
        requiresKey: true,
        envVars: ["OPENAI_API_KEY"],
      },
      {
        name: "Tavily Search API",
        description: "Tier 1 fast research provider used for business context discovery.",
        href: "https://docs.tavily.com/",
        icon: Search,
        requiresKey: true,
        envVars: ["TAVILY_API_KEY"],
      },
      {
        name: "Exa Semantic Search",
        description: "Tier 2 semantic and competitor research escalations inside the AI workflow.",
        href: "https://exa.ai/docs",
        icon: Layers,
        requiresKey: true,
        envVars: ["EXA_API_KEY"],
      },
      {
        name: "Perplexity API",
        description: "Tier 3 comprehensive research for premium users and deep analysis flows.",
        href: "https://docs.perplexity.ai/",
        icon: BrainCircuit,
        requiresKey: true,
        envVars: ["PERPLEXITY_API_KEY"],
      },
    ],
  },
  {
    title: "Data & Enrichment Services",
    description: "Providers that supply company intelligence and lead enrichment data.",
    services: [
      {
        name: "FindyMail",
        description: "Primary email and contact enrichment provider with batch support.",
        href: "https://findymail.com/app/api",
        icon: Mail,
        requiresKey: true,
        envVars: ["FINDYMAIL_API_KEY"],
      },
      {
        name: "IcyPeas",
        description: "Fallback enrichment provider for intent data and supplemental signals.",
        href: "https://www.icypeas.com/docs",
        icon: CircuitBoard,
        requiresKey: true,
        envVars: ["ICYPEAS_API_KEY"],
        notes: "Optional escalation provider when FindyMail coverage is limited.",
      },
      {
        name: "Google Maps Platform",
        description: "Location search and discovery foundation for lead sourcing.",
        href: "https://console.cloud.google.com/google/maps-apis",
        icon: Globe,
        requiresKey: true,
        envVars: ["GOOGLE_MAPS_API_KEY"],
      },
      {
        name: "Convex",
        description: "Realtime database and backend functions powering Genni's application state.",
        href: "https://www.convex.dev/",
        icon: Database,
        docsLabel: "Convex dashboard",
        requiresKey: true,
        envVars: ["CONVEX_URL", "VITE_CONVEX_URL"],
      },
    ],
  },
  {
    title: "Infrastructure & Operations",
    description: "Hosting, observability, and operational tooling for the Genni platform.",
    services: [
      {
        name: "Railway",
        description: "Deployment platform for the web app and LangGraph worker services.",
        href: "https://railway.app/dashboard",
        icon: Server,
        docsLabel: "Railway dashboard",
      },
      {
        name: "LangSmith",
        description: "Tracing and evaluation suite for monitoring LangChain and LangGraph runs.",
        href: "https://smith.langchain.com/",
        icon: LineChart,
        requiresKey: true,
        envVars: ["LANGSMITH_API_KEY"],
      },
      {
        name: "Sentry",
        description: "Error tracking and performance monitoring for frontend and worker services.",
        href: "https://sentry.io/",
        icon: ShieldCheck,
        requiresKey: true,
        envVars: ["SENTRY_DSN"],
      },
      {
        name: "Clerk",
        description: "Authentication and user management platform integrated with Convex.",
        href: "https://dashboard.clerk.com/",
        icon: KeyRound,
        requiresKey: true,
        envVars: ["CLERK_PUBLISHABLE_KEY", "CLERK_SECRET_KEY"],
      },
      {
        name: "Resend",
        description: "Transactional email delivery for outreach and operational messaging.",
        href: "https://resend.com/dashboard",
        icon: Mail,
        requiresKey: true,
        envVars: ["RESEND_API_KEY"],
      },
      {
        name: "PostHog",
        description: "Product analytics and feature flagging for user behavior insights.",
        href: "https://app.posthog.com/",
        icon: BarChart3,
        requiresKey: true,
        envVars: ["VITE_POSTHOG_KEY", "VITE_POSTHOG_HOST"],
      },
    ],
  },
];

const getExternalServices = (): ExternalService[] => {
  try {
    return EXTERNAL_SERVICE_GROUPS.flatMap((group) =>
      group.services.filter((service) => {
        const isValid = validateUrl(service.href);

        if (!isValid) {
          console.warn(`Invalid URL configuration for service: ${service.name}`);
        }

        return isValid;
      }),
    );
  } catch (error) {
    console.error("Error initializing external services configuration:", error);
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

const adminDashboardLogger = createLogger("AdminDashboard");

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
  const serviceGroups = React.useMemo(() => {
    return EXTERNAL_SERVICE_GROUPS.map((group) => ({
      ...group,
      services: group.services.filter((service) => validateUrl(service.href)),
    })).filter((group) => group.services.length > 0);
  }, []);

  const servicesRequiringKeys = React.useMemo(
    () => externalServices.filter((service) => service.requiresKey).length,
    [externalServices],
  );

  const trackedEnvVars = React.useMemo(() => {
    const envVarSet = new Set<string>();
    externalServices.forEach((service) => {
      service.envVars?.forEach((envVar) => envVarSet.add(envVar));
    });
    return envVarSet;
  }, [externalServices]);

  const servicesWithDocs = React.useMemo(
    () => externalServices.filter((service) => Boolean(service.docsLabel)).length,
    [externalServices],
  );

  const safeOpenUrl = (url: string, targetLabel: string) => {
    try {
      if (!validateUrl(url)) {
        toast({
          title: "Invalid URL",
          description: `Cannot open ${targetLabel}: Invalid URL configuration.`,
          variant: "destructive",
        });
        return;
      }
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      console.error(`Failed to open URL for ${targetLabel}:`, error);
      toast({
        title: "Error Opening Service",
        description: `Failed to open ${targetLabel}. Please try again.`,
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
            No external services configured. Please contact the system administrator.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold">External Services</h3>
          <p className="text-sm text-muted-foreground">
            Centralized directory of credentials, documentation, and operational notes for Genni's integrations.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="border-green-200 bg-green-50 text-green-700">
            <CheckCircle className="mr-1 h-3 w-3" aria-hidden="true" />
            {externalServices.length} services documented
          </Badge>
          <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
            <KeyRound className="mr-1 h-3 w-3" aria-hidden="true" />
            {servicesRequiringKeys} require API keys
          </Badge>
          <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700">
            <Database className="mr-1 h-3 w-3" aria-hidden="true" />
            {trackedEnvVars.size} env vars tracked
          </Badge>
        </div>
      </div>

      {serviceGroups.map((group) => (
        <div key={group.title} className="space-y-4">
          <div>
            <h4 className="text-md font-semibold">{group.title}</h4>
            <p className="text-sm text-muted-foreground">{group.description}</p>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
            {group.services.map((service) => {
              const IconComponent = service.icon;
              const primaryButtonLabel = service.docsLabel ?? `Open ${service.name}`;

              return (
                <Card key={service.name} className="border-2 p-6 transition-shadow duration-200 hover:shadow-lg">
                  <div className="space-y-4">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className="rounded-lg border border-blue-200 bg-blue-50 p-2">
                          <IconComponent className="h-6 w-6 text-blue-600" aria-hidden="true" />
                        </div>
                        <div className="space-y-1">
                          <h5 className="text-lg font-semibold">{service.name}</h5>
                          {service.requiresKey ? (
                            <Badge
                              variant="outline"
                              className="flex w-fit items-center gap-1 border-amber-200 bg-amber-50 text-[11px] uppercase tracking-wide text-amber-700"
                            >
                              <KeyRound className="h-3 w-3" aria-hidden="true" />
                              Requires API Key
                            </Badge>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    <p className="text-sm leading-relaxed text-muted-foreground">{service.description}</p>

                    {service.envVars && service.envVars.length > 0 ? (
                      <div className="space-y-2">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Environment variables
                        </p>
                        <div className="flex flex-wrap gap-1">
                          {service.envVars.map((envVar) => (
                            <Badge
                              key={envVar}
                              variant="secondary"
                              className="font-mono text-[11px] uppercase tracking-tight"
                            >
                              {envVar}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {service.notes ? (
                      <div className="rounded-md border border-dashed border-muted-foreground/20 bg-muted/40 p-3">
                        <p className="text-xs text-muted-foreground">{service.notes}</p>
                      </div>
                    ) : null}

                    <div className="flex flex-wrap gap-2">
                      <Button
                        className="flex-1"
                        onClick={() => safeOpenUrl(service.href, service.docsLabel ?? service.name)}
                        aria-label={`Open ${service.docsLabel ?? service.name} in a new tab`}
                      >
                        <ExternalLink className="mr-2 h-4 w-4" aria-hidden="true" />
                        {primaryButtonLabel}
                      </Button>
                      {service.docsLabel ? (
                        <Badge variant="outline" className="h-9 items-center justify-center px-3 text-xs">
                          {service.docsLabel.toLowerCase().includes("docs") ? "Docs" : "Console"}
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      ))}

      <Card className="border-2 p-6">
        <h4 className="mb-4 text-lg font-semibold">Service Overview</h4>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-center">
            <div className="text-2xl font-bold text-blue-600">{externalServices.length}</div>
            <div className="text-sm text-muted-foreground">Total services</div>
          </div>
          <div className="rounded-lg border border-violet-200 bg-violet-50 p-3 text-center">
            <div className="text-2xl font-bold text-violet-600">{serviceGroups.length}</div>
            <div className="text-sm text-muted-foreground">Service groups</div>
          </div>
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-center">
            <div className="text-2xl font-bold text-amber-600">{servicesRequiringKeys}</div>
            <div className="text-sm text-muted-foreground">Require API keys</div>
          </div>
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-center">
            <div className="text-2xl font-bold text-emerald-600">{servicesWithDocs}</div>
            <div className="text-sm text-muted-foreground">Custom docs labels</div>
          </div>
        </div>
      </Card>
    </div>
  );
}

function AdminDashboardComponent() {
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
  const [componentError, setComponentError] = useState<string | null>(null);

  const handleComponentError = useCallback(
    (error: unknown, context: string, extra?: Record<string, unknown>) => {
      const errorInstance =
        error instanceof Error ? error : new Error(String(error));
      adminDashboardLogger.error(
        `Admin dashboard error: ${context}`,
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
      historySyncDisabledRef.current = true;
      handleComponentError(error, "sync-tab-to-url", {
        pathname: location.pathname,
        attemptedSearch: nextSearch,
      });
    }
  }, [
    currentTab,
    handleComponentError,
    location.pathname,
    navigate,
  ]);

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
      handleComponentError(error, "toggle-user-active", { userId: user._id });
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
      handleComponentError(error, "update-user-plan", {
        userId: user._id,
        plan,
      });
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
      handleComponentError(error, "pause-processing", { userId: user._id });
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
      handleComponentError(error, "resume-processing", { userId: user._id });
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
      handleComponentError(error, "save-credit-costs", {
        creditCosts: creditCostsForm,
      });
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
      handleComponentError(error, "save-plan-limits", { planLimits: planLimitsForm });
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
      handleComponentError(error, "pause-lead-generation", { reason });
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
      handleComponentError(error, "resume-lead-generation");
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
      handleComponentError(error, "clear-active-searches", { reason });
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
      handleComponentError(error, "trigger-health-check");
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
      {componentError && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="flex items-center justify-between gap-4">
            <span>{componentError}</span>
            <Button size="sm" variant="outline" onClick={dismissComponentError}>
              Dismiss
            </Button>
          </AlertDescription>
        </Alert>
      )}
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
                  No health data available. Health checks run when a lead generation
                  workflow begins.
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

AdminDashboardComponent.displayName = "AdminDashboard";

export const AdminDashboard = withErrorBoundary(
  AdminDashboardComponent,
  "Admin dashboard failed to render",
);

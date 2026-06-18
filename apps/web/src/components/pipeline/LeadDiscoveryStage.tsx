import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { LocationAutocomplete } from "@/components/ui/location-autocomplete";
import { usePipeline } from "@/pipeline/context";
import { SourceRegistry } from "@/pipeline/sources/SourceRegistry";
import { FileUploadArea } from "./FileUploadArea";
import { EstimatedCostCard } from "./EstimatedCostCard";
import { useSearches, useGoogleMapsSearch } from "@/hooks/useSearches";
import { useQuery, useMutation } from "convex/react";
import { api } from "@genni/convex-types";
import {
  Search,
  MapPin,
  Building,
  Users,
  Sparkles,
  AlertTriangle,
  Upload,
  FileText,
  Mail,
  ChevronDown,
  ChevronUp,
  X,
  Plus,
  Filter,
  Info,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import {
  Collapsible,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import { toStandardCase } from "@/utils/string";
import { EnterpriseApiKeyBlocker } from "./EnterpriseApiKeyBlocker";
import { createLogger } from "@/utils/logger";
import { normalizeError } from "@/utils/errorUtils";
import { useAnalytics } from "@/hooks/useAnalytics";
import { useApiError, type ApiError } from "@/hooks/useApiError";
import { ApiErrorAlert } from "@/components/errors/ApiErrorAlert";

interface LeadDiscoveryStageProps {
  userCredits: number;
  userPlan: "free" | "pro" | "enterprise";
  onNavigateToSettings?: () => void;
}

const MIN_RADIUS_MILES = 1;
const MAX_RADIUS_MILES = 31;
const DEFAULT_RADIUS_MILES = 15;
const RADIUS_STEP_MILES = 1;
const DEFAULT_ROLE_SELECTION = ["CEO", "Founder", "Owner"] as const;
const ROLE_SUGGESTIONS = [
  "CEO",
  "Founder",
  "Owner",
  "President",
  "COO",
  "VP of Sales",
  "Head of Marketing",
  "Managing Partner",
  "Sales",
  "Marketing",
  "Manager",
] as const;
const MAX_SELECTED_ROLES = 3;
const ENTERPRISE_REQUIRED_PROVIDERS = [
  "openai",
  "google_places",
  "findymail",
  "tavily",
  "perplexity",
] as const;

const discoveryLogger = createLogger("LeadDiscoveryStage");

export function LeadDiscoveryStage({
  userCredits,
  userPlan,
  onNavigateToSettings,
}: LeadDiscoveryStageProps) {
  const {
    state,
    setSearchId,
    setLeads,
    markStageComplete,
    progressToNextStage,
    setProcessing,
  } = usePipeline();
  const { createSearch } = useSearches();
  const { searchGoogleMaps } = useGoogleMapsSearch();
  const { toast } = useToast();
  const analytics = useAnalytics();
  const { handleApiError, clearError, isUserActionable, navigateToAction } = useApiError();
  const createSearchFromCSV = useMutation(api.leads.mutations.createSearchFromCSV);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [showApiKeyBlocker, setShowApiKeyBlocker] = useState(false);
  const [stageError, setStageError] = useState<string | null>(null);
  const [apiError, setApiError] = useState<ApiError | null>(null);

  // Fetch user preferences for de-duplication settings
  const userPreferences = useQuery(api.users.queries.getUserPreferences);

  // Fetch API key status for enterprise users
  const apiKeyStatus = useQuery(api.userApiKeys.queries.getApiKeyStatus);

  // Check if enterprise user has all required API keys
  const isEnterprise = userPlan === "enterprise";
  const keysLoaded = apiKeyStatus !== undefined;
  const missingApiKeys =
    apiKeyStatus?.missingRequiredProviders ??
    (isEnterprise ? [...ENTERPRISE_REQUIRED_PROVIDERS] : []);
  const hasAllApiKeys = !isEnterprise
    ? true
    : keysLoaded
    ? apiKeyStatus.hasRequiredKeys
    : false;

  // Google Maps form state
  const [location, setLocation] = useState("");
  const [locationPlaceId, setLocationPlaceId] = useState<string | null>(null);
  const [industry, setIndustry] = useState("");
  const [leadsCount, setLeadsCount] = useState([50]);
  const [radius, setRadius] = useState([DEFAULT_RADIUS_MILES]);
  const [selectedRoles, setSelectedRoles] = useState<string[]>([
    ...DEFAULT_ROLE_SELECTION,
  ]);
  const [customRole, setCustomRole] = useState("");
  const [roleError, setRoleError] = useState<string | null>(null);

  // Filtering options state
  const [filteringExpanded, setFilteringExpanded] = useState(false);
  const [filterPlaceNames, setFilterPlaceNames] = useState(
    userPreferences?.enablePlaceNameDedup ?? false
  );
  const [filterEmails, setFilterEmails] = useState(
    userPreferences?.enableEmailDedup ?? true
  );
  const [filterAddresses, setFilterAddresses] = useState(
    userPreferences?.enableAddressDedup ?? true
  );
  const [skipCompaniesWithExistingEmails, setSkipCompaniesWithExistingEmails] =
    useState(false);

  // Upload form state
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>(
    {},
  );

  const selectedSource = SourceRegistry.getSource(state.selectedSource!);
  const hasActiveSearch = Boolean(state.searchId);
  const [showConfiguration, setShowConfiguration] = useState(!hasActiveSearch);

  useEffect(() => {
    if (hasActiveSearch) {
      setShowConfiguration(false);
    }
  }, [hasActiveSearch]);

  // Sync filtering options with user preferences
  useEffect(() => {
    if (userPreferences) {
      setFilterPlaceNames(userPreferences.enablePlaceNameDedup ?? false);
      setFilterEmails(userPreferences.enableEmailDedup ?? true);
      setFilterAddresses(userPreferences.enableAddressDedup ?? true);
    }
  }, [userPreferences]);

  const canAddMoreRoles = selectedRoles.length < MAX_SELECTED_ROLES;

  useEffect(() => {
    if (selectedRoles.length > 0) {
      setRoleError(null);
    }
  }, [selectedRoles.length]);

  useEffect(() => {
    if (!isEnterprise) {
      setShowApiKeyBlocker(false);
      return;
    }

    if (!apiKeyStatus) {
      return;
    }

    setShowApiKeyBlocker(!apiKeyStatus.hasRequiredKeys);
  }, [apiKeyStatus, isEnterprise]);

  const tryAddRole = (role: string) => {
    const formatted = toStandardCase(role);
    if (!formatted) {
      setRoleError("Role name cannot be empty.");
      return false;
    }

    if (
      selectedRoles.some(
        (existing) => existing.toLowerCase() === formatted.toLowerCase(),
      )
    ) {
      return false;
    }

    if (!canAddMoreRoles) {
      setRoleError(`You can target up to ${MAX_SELECTED_ROLES} roles.`);
      return false;
    }

    setSelectedRoles((prev) => [...prev, formatted]);
    setRoleError(null);
    return true;
  };

  const handleToggleRole = (role: string) => {
    const formatted = toStandardCase(role);
    if (!formatted) {
      return;
    }

    const exists = selectedRoles.some(
      (existing) => existing.toLowerCase() === formatted.toLowerCase(),
    );

    if (exists) {
      if (selectedRoles.length <= 1) {
        setRoleError("At least one role is required to find contacts.");
        return;
      }

      setSelectedRoles((prev) =>
        prev.filter(
          (existing) => existing.toLowerCase() !== formatted.toLowerCase(),
        ),
      );
      setRoleError(null);
      return;
    }

    tryAddRole(formatted);
  };

  const handleAddCustomRole = () => {
    if (tryAddRole(customRole)) {
      setCustomRole("");
    }
  };

  const handleCustomRoleKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>,
  ) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleAddCustomRole();
    }
  };

  const validateAndEstimateCost = () => {
    if (!selectedSource) return { isValid: false, estimatedCost: 0 };

    if (state.selectedSource === "google_maps") {
      const params = {
        location,
        industry,
        leadsCount: leadsCount[0],
        radius: radius[0],
        includeEmails: true, // Always enabled
        aiAnalysis: true, // Always enabled
        roles: selectedRoles,
      };
      return selectedSource.validate(params);
    } else if (state.selectedSource === "csv_upload") {
      const params = {
        file: uploadFile,
        columns: columnMapping,
      };
      return selectedSource.validate(params);
    }

    return { isValid: false, estimatedCost: 0 };
  };

  const validation = validateAndEstimateCost();
  const estimatedCost = validation.estimatedCost || 0;
  const validationWarnings = validation.warnings ?? [];
  const warningsToShow = isEnterprise
    ? validationWarnings.filter(
        (warning) => !warning.toLowerCase().includes("credit"),
      )
    : validationWarnings;
  const isStartDisabled =
    !validation.isValid ||
    state.isProcessing ||
    (!isEnterprise && estimatedCost > userCredits);

  const handleStartDiscovery = async () => {
    if (!validation.isValid) return;

    setStageError(null);
    setApiError(null);
    setProcessing(true);

    try {
      if (state.selectedSource === "google_maps") {
        const formattedIndustry = toStandardCase(industry);
        const formattedLocation = toStandardCase(location);
        if (formattedIndustry !== industry) {
          setIndustry(formattedIndustry);
        }
        if (formattedLocation !== location) {
          setLocation(formattedLocation);
        }
        const searchNameParts = [formattedIndustry, formattedLocation].filter(
          Boolean,
        );
        const searchName = searchNameParts.join(" in ");

        const sanitizedRoles = selectedRoles
          .map((role) => toStandardCase(role))
          .filter(
            (role, index, array) =>
              role.length > 0 &&
              array.findIndex(
                (item) => item.toLowerCase() === role.toLowerCase(),
              ) === index,
          )
          .slice(0, MAX_SELECTED_ROLES);

        const rolesForSearch =
          sanitizedRoles.length > 0
            ? sanitizedRoles
            : [...DEFAULT_ROLE_SELECTION];

        // Create search using existing Convex integration with auto-start
        const searchResult = await createSearch({
          name: searchName,
          parameters: {
            location: formattedLocation,
            locationPlaceId: locationPlaceId || undefined,
            maxResults: leadsCount[0],
            radius: radius[0],
            keywords: [formattedIndustry],
            roles: rolesForSearch,
            deduplication: {
              enablePlaceNameDedup: filterPlaceNames,
              enableEmailDedup: filterEmails,
              enableAddressDedup: filterAddresses,
              skipCompaniesWithExistingEmails,
            },
          },
          autoStart: true, // This will trigger the orchestrator automatically
        });

        if (searchResult) {
          setSearchId(searchResult.searchId);
          markStageComplete("lead_discovery");

          // Track search creation in analytics
          analytics.trackSearchCreated({
            search_id: searchResult.searchId,
            source: 'google_maps',
            keywords: formattedIndustry,
            location: formattedLocation,
            radius: radius[0],
            total_leads: leadsCount[0],
          });

          toast({
            title: "Search Started",
            description: `Discovering ${leadsCount[0]} leads in ${formattedLocation}...`,
          });

          // Auto-progress after a short delay for visual feedback
          setTimeout(() => {
            progressToNextStage();
          }, 1000);
        }
      } else if (state.selectedSource === "csv_upload" && uploadFile) {
        // Handle CSV upload - now returns { leads, stats } directly
        const fetchResult = await selectedSource!.fetch({
          file: uploadFile,
          columns: columnMapping,
        });

        // Type guard: CSV upload returns CSVFetchResult, not Lead[]
        if (!('stats' in fetchResult)) {
          throw new Error("Invalid CSV fetch result");
        }

        const { leads, stats } = fetchResult;

        // Call backend mutation to create search and insert leads
        const result = await createSearchFromCSV({
          fileName: uploadFile.name,
          fileSize: uploadFile.size,
          columnMapping,
          leads: leads.map((lead) => ({
            businessName: lead.businessName,
            address: lead.address,
            placeId: lead.placeId,
            location: lead.location,
            phone: lead.phone ?? undefined, // Convert null to undefined for Convex
            website: lead.website ?? undefined, // Convert null to undefined for Convex
            category: lead.category ?? undefined, // Convert null to undefined for Convex
            dataSource: lead.dataSource,
            enrichmentStatus: lead.enrichmentStatus,
            contactInfo: lead.contactInfo,
            costEstimate: lead.raw_data?.costEstimate || {
              cost: 2,
              reason: "Default cost",
              skipEnrichment: false,
            },
          })),
          statistics: stats,
        });

        // Store search ID for pipeline
        setSearchId(result.searchId);
        setLeads(leads);
        markStageComplete("lead_discovery");

        toast({
          title: "Leads Imported Successfully",
          description: `Imported ${leads.length} leads (${stats.estimatedCost} credits deducted).`,
        });

        setTimeout(() => {
          progressToNextStage();
        }, 1000);
      }
    } catch (error) {
      const normalizedError = normalizeError(
        error,
        "Failed to start lead discovery. Please try again.",
      );
      const errorInstance =
        error instanceof Error ? error : new Error(String(error));
      discoveryLogger.error(
        "Lead discovery start failed",
        {
          code: normalizedError.code,
          statusCode: normalizedError.statusCode,
          source: state.selectedSource,
          searchId: state.searchId,
        },
        errorInstance,
      );

      // Check if we have a structured API error
      if (normalizedError.apiError) {
        setApiError(normalizedError.apiError);
        setStageError(null);

        // Track structured error in analytics
        analytics.trackSearchFailed({
          search_id: state.searchId,
          source: state.selectedSource as 'google_maps' | 'manual',
        });

        // Show API key blocker for authentication errors on enterprise
        if (
          isEnterprise &&
          (normalizedError.apiError.category === "authentication" ||
            normalizedError.apiError.category === "authorization")
        ) {
          setShowApiKeyBlocker(true);
        }
      } else {
        // Fall back to generic error handling
        setStageError(normalizedError.message);
        setApiError(null);
        toast({
          title: "Discovery Failed",
          description: normalizedError.message,
          variant: "destructive",
        });

        if (
          isEnterprise &&
          normalizedError.message.toLowerCase().includes("api key")
        ) {
          setShowApiKeyBlocker(true);
        }
      }
    } finally {
      setProcessing(false);
    }
  };

  const handleRequestStart = () => {
    if (isStartDisabled) return;

    // For enterprise users, check if all API keys are configured
    if (isEnterprise && !hasAllApiKeys) {
      setShowApiKeyBlocker(true);
      return;
    }

    setIsConfirmOpen(true);
  };

  const handleGoToSettings = () => {
    setShowApiKeyBlocker(false);
    if (onNavigateToSettings) {
      onNavigateToSettings();
    }
  };

  const handleConfirmStart = async () => {
    setIsConfirmOpen(false);
    await handleStartDiscovery();
  };

  if (!selectedSource) {
    return (
      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>Please select a data source first.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto w-full">
      {/* Header */}
      <div className="space-y-2 text-center">
        <h3 className="text-xl font-semibold flex items-center justify-center gap-2">
          <selectedSource.icon className="h-5 w-5" />
          {selectedSource.name} Discovery
        </h3>
        <p className="text-muted-foreground">{selectedSource.description}</p>
      </div>

      {/* Structured API Error Display */}
      {apiError && (
        <ApiErrorAlert
          error={apiError}
          onDismiss={() => setApiError(null)}
          onRetry={() => {
            setApiError(null);
            handleStartDiscovery();
          }}
          onAction={(action) => {
            if (action === "check_api_key") {
              onNavigateToSettings?.();
            }
          }}
        />
      )}

      {/* Generic Error Display (fallback) */}
      {stageError && !apiError && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span>{stageError}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setStageError(null)}
            >
              Dismiss
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {hasActiveSearch && !showConfiguration && (
        <Card className="glass-card border-dashed">
          <CardContent className="flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1 text-left">
              <h4 className="font-semibold text-base">Discovery running</h4>
              <p className="text-sm text-muted-foreground">
                We kicked off your Google Maps search. Monitor the live progress
                below or reopen the setup to adjust parameters.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowConfiguration(true)}
              className="self-stretch sm:self-auto"
            >
              <ChevronUp className="mr-2 h-4 w-4" />
              Adjust search
            </Button>
          </CardContent>
        </Card>
      )}

      <Collapsible open={showConfiguration}>
        <CollapsibleContent className="space-y-6">
          {/* Source-specific form */}
          <Card className="glass-card">
            <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle className="text-lg">Configure Your Search</CardTitle>
              {hasActiveSearch && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowConfiguration(false)}
                  className="text-muted-foreground"
                >
                  <ChevronDown className="mr-1 h-4 w-4" />
                  Hide setup
                </Button>
              )}
            </CardHeader>
            <CardContent className="space-y-6">
              {state.selectedSource === "google_maps" && (
                <>
              {/* Location & Industry */}
              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <MapPin className="h-4 w-4" />
                    Location
                  </Label>
                  <LocationAutocomplete
                    value={location}
                    onValueChange={setLocation}
                    onLocationSelect={(details) => {
                      setLocation(details.description);
                      setLocationPlaceId(details.placeId);
                    }}
                    placeholder="e.g., San Francisco, Austin TX, 90210"
                    className="transition-neo"
                  />
                </div>

                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Building className="h-4 w-4" />
                    Business Type
                  </Label>
                  <Input
                    value={industry}
                    onChange={(e) => setIndustry(e.target.value)}
                    placeholder="e.g., SaaS companies, Marketing agencies"
                    className="transition-neo"
                  />
                </div>
              </div>

              {/* Advanced Options */}
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Number of Leads: {leadsCount[0]}</Label>
                  <Slider
                    value={leadsCount}
                    onValueChange={setLeadsCount}
                    max={500}
                    min={10}
                    step={10}
                    className="transition-neo"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>10</span>
                    <span>500</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>
                    Search Radius: {radius[0]} mile
                    {radius[0] === 1 ? "" : "s"}
                  </Label>
                  <Slider
                    data-testid="radius-input"
                    value={radius}
                    onValueChange={setRadius}
                    max={MAX_RADIUS_MILES}
                    min={MIN_RADIUS_MILES}
                    step={RADIUS_STEP_MILES}
                    className="transition-neo"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>
                      {MIN_RADIUS_MILES} mile
                      {MIN_RADIUS_MILES === 1 ? "" : "s"}
                    </span>
                    <span>
                      {MAX_RADIUS_MILES} miles
                    </span>
                  </div>
                </div>
              </div>

              {/* Processing Options */}
              <div className="space-y-4 p-4 rounded-lg bg-muted/20">
                <div className="space-y-3 rounded-lg border border-border/60 bg-background/60 p-4">
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                    <div className="space-y-1">
                      <Label className="flex items-center gap-2 text-sm font-medium">
                        <Users className="h-4 w-4" />
                        Target Roles
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        Choose up to {MAX_SELECTED_ROLES} decision-maker roles for
                        Findymail to prioritize when searching for contacts.
                      </p>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {selectedRoles.length}/{MAX_SELECTED_ROLES} selected
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {selectedRoles.map((role) => (
                      <Badge
                        key={role.toLowerCase()}
                        variant="secondary"
                        className="flex items-center gap-1 rounded-full px-3 py-1 text-xs"
                      >
                        {role}
                        <button
                          type="button"
                          onClick={() => handleToggleRole(role)}
                          className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
                          aria-label={`Remove ${role}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                    {selectedRoles.length === 0 && (
                      <span className="text-xs text-muted-foreground">
                        No roles selected yet.
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {ROLE_SUGGESTIONS.map((role) => {
                      const formatted = toStandardCase(role);
                      const isSelected = selectedRoles.some(
                        (existing) =>
                          existing.toLowerCase() === formatted.toLowerCase(),
                      );
                      return (
                        <Button
                          key={role}
                          type="button"
                          size="sm"
                          variant={isSelected ? "default" : "outline"}
                          className={cn(
                            "rounded-full",
                            !isSelected && "bg-background/80",
                          )}
                          onClick={() => handleToggleRole(role)}
                          disabled={!isSelected && !canAddMoreRoles}
                        >
                          {formatted}
                        </Button>
                      );
                    })}
                  </div>

                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                      value={customRole}
                      onChange={(event) => setCustomRole(event.target.value)}
                      onKeyDown={handleCustomRoleKeyDown}
                      placeholder="Add a custom role (e.g., VP of Marketing)"
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={handleAddCustomRole}
                      disabled={!customRole.trim() || !canAddMoreRoles}
                      className="sm:w-auto"
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      Add Role
                    </Button>
                  </div>

                  {roleError && (
                    <p className="text-xs text-destructive">{roleError}</p>
                  )}
                </div>
              </div>

              {/* Deduplication Options */}
              <div className="space-y-4 p-4 rounded-lg bg-muted/20">
                <Collapsible
                  open={filteringExpanded}
                  onOpenChange={setFilteringExpanded}
                >
                  <button
                    type="button"
                    onClick={() => setFilteringExpanded(!filteringExpanded)}
                    className="flex w-full items-center justify-between gap-2 cursor-pointer group"
                  >
                    <div className="flex items-center gap-2">
                      <Filter className="h-4 w-4 text-primary" />
                      <h4 className="text-sm font-semibold">Deduplication Options</h4>
                    </div>
                    {filteringExpanded ? (
                      <ChevronUp className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                    )}
                  </button>

                  <CollapsibleContent className="space-y-4 mt-4">
                    {/* Place Name Deduplication */}
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <Label className="text-sm font-medium">
                            Filter duplicate place names
                          </Label>
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button type="button" className="inline-flex">
                                  <Info className="h-4 w-4 text-muted-foreground" />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs">
                                <p>
                                  Removes businesses with identical names from search results.
                                  Useful for filtering out franchise locations (e.g., multiple
                                  State Farm or McDonald's locations). Only keeps the first
                                  occurrence found.
                                </p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Search-level only (not user history)
                        </p>
                      </div>
                      <Switch
                        checked={filterPlaceNames}
                        onCheckedChange={setFilterPlaceNames}
                      />
                    </div>

                    <Separator />

                    {/* Email Deduplication */}
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <Label className="text-sm font-medium">
                            Avoid duplicate email addresses
                          </Label>
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button type="button" className="inline-flex">
                                  <Info className="h-4 w-4 text-muted-foreground" />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs">
                                <p>
                                  Prevents sending emails to the same email address across
                                  all your searches. Checks against your historical lead
                                  database.
                                </p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Checks all previous leads (recommended)
                        </p>
                      </div>
                      <Switch
                        checked={filterEmails}
                        onCheckedChange={setFilterEmails}
                      />
                    </div>

                    <Separator />

                    {/* Address Deduplication */}
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <Label className="text-sm font-medium">
                            Filter duplicate addresses
                          </Label>
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button type="button" className="inline-flex">
                                  <Info className="h-4 w-4 text-muted-foreground" />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs">
                                <p>
                                  Removes locations with addresses you've already targeted.
                                  Checks against your historical lead database.
                                </p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Checks all previous leads (recommended)
                        </p>
                      </div>
                      <Switch
                        checked={filterAddresses}
                        onCheckedChange={setFilterAddresses}
                      />
                    </div>

                    <p className="text-xs text-muted-foreground mt-2">
                      These settings will apply to this search. You can set defaults in your{" "}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onNavigateToSettings?.();
                        }}
                        className="text-primary hover:underline cursor-pointer bg-transparent border-none p-0 inline"
                      >
                        account settings
                      </button>.
                    </p>
                  </CollapsibleContent>
                </Collapsible>
              </div>
                </>
              )}

              {state.selectedSource === "csv_upload" && (
                <FileUploadArea
                  onFileSelect={setUploadFile}
                  onColumnMapping={setColumnMapping}
                  selectedFile={uploadFile}
                  columnMapping={columnMapping}
                />
              )}
            </CardContent>
          </Card>

          {/* Validation & Cost */}
          {validation.errors.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              className="mt-4 flex gap-2 rounded-xl border border-red-300 bg-red-50 p-3 text-red-800 dark:border-red-500/50 dark:bg-red-500/10 dark:text-red-200"
            >
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <div>
                <div className="font-medium">We need a bit more info</div>
                <ul className="ml-5 list-disc text-sm">
                  {validation.errors.map((error, index) => (
                    <li key={`${error}-${index}`}>{error}</li>
                  ))}
                </ul>
              </div>
            </motion.div>
          )}

          {warningsToShow.length > 0 && (
            <Alert className="border border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <div className="space-y-1">
                  {warningsToShow.map((warning, index) => (
                    <div key={index}>{warning}</div>
                  ))}
                </div>
              </AlertDescription>
            </Alert>
          )}

          {/* Cost Summary & Action */}
          {!isEnterprise ? (
            <EstimatedCostCard
              estimatedCredits={estimatedCost}
              availableCredits={userCredits}
              afterBalance={Math.max(userCredits - estimatedCost, 0)}
              onStart={handleRequestStart}
              disabled={isStartDisabled}
              isProcessing={state.isProcessing}
            />
          ) : (
            <div className="card-glass p-4 md:p-5">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="space-y-1 text-left">
                  <h4 className="text-base font-semibold text-foreground">
                    Ready to discover new leads?
                  </h4>
                  <p className="text-sm text-muted-foreground">
                    Kick off this search and we&apos;ll start finding contacts immediately. Results will flow into your workspace as they are found.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleRequestStart}
                  disabled={isStartDisabled}
                  className={cn(
                    "btn-primary-gradient min-w-[180px] justify-center",
                    state.isProcessing && "brightness-105",
                    isStartDisabled && "opacity-70 cursor-not-allowed",
                  )}
                >
                  <Search
                    className={cn(
                      "h-4 w-4",
                      state.isProcessing && "animate-spin",
                    )}
                  />
                  {state.isProcessing ? "Discovering..." : "Start Discovery"}
                </button>
              </div>
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>

      <AlertDialog open={isConfirmOpen} onOpenChange={setIsConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isEnterprise ? "Start lead discovery" : "Confirm credit usage"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isEnterprise ? (
                "We'll kick off lead discovery using your current configuration. Ready to begin?"
              ) : estimatedCost > 0 ? (
                <>
                  This search may use up to{" "}
                  <span className="font-semibold text-foreground">
                    {estimatedCost} credits
                  </span>
                  . You currently have {userCredits} credits available.
                </>
              ) : (
                "This search will use credits from your balance."
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setIsConfirmOpen(false)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmStart}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {isEnterprise
                ? "Yes, start discovering leads"
                : estimatedCost > 0
                ? `Yes, use up to ${estimatedCost} credits`
                : "Yes, start the search"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Enterprise API Key Blocker Modal */}
      {showApiKeyBlocker && isEnterprise && missingApiKeys.length > 0 && (
        <EnterpriseApiKeyBlocker
          missingProviders={missingApiKeys}
          onGoToSettings={handleGoToSettings}
        />
      )}
    </div>
  );
}

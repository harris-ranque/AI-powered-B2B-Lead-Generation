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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import {
  Collapsible,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import { toStandardCase } from "@/utils/string";

interface LeadDiscoveryStageProps {
  userCredits: number;
  userPlan: "free" | "pro" | "enterprise";
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

export function LeadDiscoveryStage({
  userCredits,
  userPlan,
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
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);

  // Google Maps form state
  const [location, setLocation] = useState("");
  const [industry, setIndustry] = useState("");
  const [leadsCount, setLeadsCount] = useState([50]);
  const [radius, setRadius] = useState([DEFAULT_RADIUS_MILES]);
  const [employeeRange, setEmployeeRange] = useState([10, 1000]);
  const [includeEmails, setIncludeEmails] = useState(true);
  const [aiAnalysis, setAiAnalysis] = useState(true);
  const [selectedRoles, setSelectedRoles] = useState<string[]>([
    ...DEFAULT_ROLE_SELECTION,
  ]);
  const [customRole, setCustomRole] = useState("");
  const [roleError, setRoleError] = useState<string | null>(null);

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

  const rolesDisabled = !includeEmails;
  const canAddMoreRoles = selectedRoles.length < MAX_SELECTED_ROLES;

  useEffect(() => {
    if (selectedRoles.length > 0) {
      setRoleError(null);
    }
  }, [selectedRoles.length]);

  useEffect(() => {
    if (!includeEmails) {
      setRoleError(null);
    }
  }, [includeEmails]);

  const tryAddRole = (role: string) => {
    if (rolesDisabled) {
      return false;
    }

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
    if (rolesDisabled) {
      return;
    }

    const formatted = toStandardCase(role);
    if (!formatted) {
      return;
    }

    const exists = selectedRoles.some(
      (existing) => existing.toLowerCase() === formatted.toLowerCase(),
    );

    if (exists) {
      if (selectedRoles.length <= 1) {
        setRoleError("At least one role is required for enrichment.");
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
        minEmployees: employeeRange[0],
        maxEmployees: employeeRange[1],
        includeEmails,
        aiAnalysis,
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
  const isStartDisabled =
    !validation.isValid ||
    state.isProcessing ||
    estimatedCost > userCredits ||
    state.selectedSource === "csv_upload";

  const handleStartDiscovery = async () => {
    if (!validation.isValid) return;

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
            maxResults: leadsCount[0],
            radius: radius[0],
            keywords: [formattedIndustry],
            roles: rolesForSearch,
            filters: {
              minEmployees: employeeRange[0],
              maxEmployees: employeeRange[1],
            },
          },
          autoStart: true, // This will trigger the orchestrator automatically
        });

        if (searchResult) {
          setSearchId(searchResult.searchId);
          markStageComplete("lead_discovery");

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
        // Handle CSV upload
        const leads = await selectedSource!.fetch({
          file: uploadFile,
          columns: columnMapping,
        });
        setLeads(leads);
        markStageComplete("lead_discovery");

        toast({
          title: "Leads Imported",
          description: `Successfully imported ${leads.length} leads from CSV.`,
        });

        setTimeout(() => {
          progressToNextStage();
        }, 1000);
      }
    } catch (error) {
      toast({
        title: "Discovery Failed",
        description: "Failed to start lead discovery. Please try again.",
        variant: "destructive",
      });
    } finally {
      setProcessing(false);
    }
  };

  const handleRequestStart = () => {
    if (isStartDisabled) return;
    setIsConfirmOpen(true);
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

                <div className="space-y-2">
                  <Label>
                    Employee Count: {employeeRange[0]} - {employeeRange[1]}
                  </Label>
                  <Slider
                    value={employeeRange}
                    onValueChange={setEmployeeRange}
                    max={10000}
                    min={1}
                    step={10}
                    className="transition-neo"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>1</span>
                    <span>10,000+</span>
                  </div>
                </div>
              </div>

              {/* Processing Options */}
              <div className="space-y-4 p-4 rounded-lg bg-muted/20">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <Label className="flex items-center gap-2">
                      <Mail className="h-4 w-4" />
                      Email Enrichment
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Find contact emails for discovered leads
                    </p>
                  </div>
                  <Switch
                    checked={includeEmails}
                    onCheckedChange={setIncludeEmails}
                  />
                </div>

                <div
                  className={cn(
                    "space-y-3 rounded-lg border border-border/60 bg-background/60 p-4 transition-opacity",
                    rolesDisabled && "pointer-events-none opacity-60",
                  )}
                  aria-disabled={rolesDisabled}
                >
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
                          disabled={
                            rolesDisabled || (!isSelected && !canAddMoreRoles)
                          }
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
                      disabled={rolesDisabled}
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={handleAddCustomRole}
                      disabled={
                        rolesDisabled || !customRole.trim() || !canAddMoreRoles
                      }
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

                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <Label className="flex items-center gap-2">
                      <Sparkles className="h-4 w-4" />
                      AI Analysis
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Analyze leads for relevance and pain points
                    </p>
                  </div>
                  <Switch
                    checked={aiAnalysis}
                    onCheckedChange={setAiAnalysis}
                  />
                </div>
              </div>
                </>
              )}

              {state.selectedSource === "csv_upload" && (
                <Alert className="border border-amber-500/40 bg-amber-500/10 text-amber-200">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    CSV Upload is temporarily disabled while we roll out
                    improved authentication for file-based imports. Please use
                    Google Maps discovery for now.
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>

          {/* Validation & Cost */}
          {validation.errors.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              className="mt-4 flex gap-2 rounded-xl border border-red-500/50 bg-red-500/10 p-3 text-red-200"
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

          {validation.warnings.length > 0 && (
            <Alert className="border border-amber-500/40 bg-amber-500/10 text-amber-200">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <div className="space-y-1">
                  {validation.warnings.map((warning, index) => (
                    <div key={index}>{warning}</div>
                  ))}
                </div>
              </AlertDescription>
            </Alert>
          )}

          {/* Cost Summary & Action */}
          <EstimatedCostCard
            estimatedCredits={estimatedCost}
            availableCredits={userCredits}
            afterBalance={Math.max(userCredits - estimatedCost, 0)}
            onStart={handleRequestStart}
            disabled={isStartDisabled}
            isProcessing={state.isProcessing}
          />
        </CollapsibleContent>
      </Collapsible>

      <AlertDialog open={isConfirmOpen} onOpenChange={setIsConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm credit usage</AlertDialogTitle>
            <AlertDialogDescription>
              {estimatedCost > 0 ? (
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
              {estimatedCost > 0
                ? `Yes, use up to ${estimatedCost} credits`
                : "Yes, start the search"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

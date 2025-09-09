import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { LocationAutocomplete } from "@/components/ui/location-autocomplete";
import { 
  Search, 
  Play, 
  Clock, 
  CreditCard, 
  Building, 
  Users,
  Settings,
  History,
  Sparkles,
  Activity,
  AlertTriangle,
  Bell
} from "lucide-react";
import { GenniLeadSearch } from "./GenniLeadSearch";
import { SearchProgressTracker } from "./SearchProgressTracker";
import type { Lead } from "@/lib/api-client";
import { useToast } from "@/hooks/use-toast";
import { useSearches, useGoogleMapsSearch } from "@/hooks/useSearches";
import { useUser, useUserCredits } from "@/hooks/useUser";
import { safeArray, safeRender, withErrorBoundary, useErrorBoundary, logError } from "@/utils/errorHandling";
import { useProfile } from "@/hooks/useProfile";
import { useStatusBroadcasts, useCreditBroadcasts, getPriorityDisplay, formatBroadcastTime } from "@/hooks/useStatusBroadcasts";
import type { SearchParams as ConvexSearchParams } from "@/lib/types";

interface LocalSearchParams {
  location: string;
  industry: string;
  leadsCount: number;
  radius: number;
  minEmployees: number;
  maxEmployees: number;
  includeEmails: boolean;
  aiAnalysis: boolean;
}

interface EnhancedLeadSearchProps {
  onGenerateEmail?: (lead: Lead) => void;
  userCredits?: number;
  userPlan?: 'free' | 'pro' | 'enterprise';
}

export function EnhancedLeadSearch({ 
  onGenerateEmail,
  userCredits: propUserCredits,
  userPlan: propUserPlan
}: EnhancedLeadSearchProps) {
  const [currentTab, setCurrentTab] = useState("search");
  const [searchParams, setSearchParams] = useState<LocalSearchParams>({
    location: '',
    industry: '',
    leadsCount: 50,
    radius: 25,
    minEmployees: 10,
    maxEmployees: 1000,
    includeEmails: true,
    aiAnalysis: true
  });
  
  const [isSearching, setIsSearching] = useState(false);
  const [selectedSearchId, setSelectedSearchId] = useState<string | null>(null);
  
  const { toast } = useToast();
  
  // Real Convex hooks
  const { user, isLoading: userLoading } = useUser();
  const { credits, isLoading: creditsLoading } = useUserCredits();
  const { profile } = useProfile();
  const { searches, createSearch, cancelSearch, isLoading: searchesLoading } = useSearches();
  const { searchGoogleMaps } = useGoogleMapsSearch();
  
  // Real-time broadcasting integration
  const {
    urgentBroadcasts,
    searchBroadcasts,
    rateLimitWarnings,
    acknowledgeBroadcast,
    hasUrgent
  } = useStatusBroadcasts();
  
  const {
    lowCreditWarnings,
    hasLowCredits,
    currentBalance
  } = useCreditBroadcasts();
  
  // Get real user data or fallback to props with validation
  const userCredits = credits ?? propUserCredits ?? 100;
  const userPlan = (user?.plan ?? propUserPlan ?? 'free') as 'free' | 'pro' | 'enterprise';
  
  // Validate userPlan to ensure it's a valid value
  const validPlans = ['free', 'pro', 'enterprise'] as const;
  const validatedUserPlan = validPlans.includes(userPlan) ? userPlan : 'free';
  
  // Ensure userCredits is a valid positive number
  const validatedUserCredits = typeof userCredits === 'number' && userCredits >= 0 ? userCredits : 100;

  // Get active and completed searches from Convex with bulletproof error handling
  const activeSearches = safeArray.filter(
    searches, 
    (s) => s.status === 'in_progress' || s.status === 'pending'
  );
  const completedSearches = safeArray.filter(
    searches, 
    (s) => s.status === 'completed' || s.status === 'failed'
  );

  const calculateCreditsCost = () => {
    let baseCost = searchParams.leadsCount;
    if (searchParams.includeEmails) baseCost *= 1.5;
    if (searchParams.aiAnalysis) baseCost *= 2;
    return Math.ceil(baseCost);
  };

  const canAffordSearch = () => {
    return validatedUserCredits >= calculateCreditsCost();
  };

  const getPlanLimits = () => {
    switch (validatedUserPlan) {
      case 'free':
        return { maxLeads: 50, maxRadius: 25, aiAnalysis: false };
      case 'pro':
        return { maxLeads: 500, maxRadius: 100, aiAnalysis: true };
      case 'enterprise':
        return { maxLeads: 5000, maxRadius: 500, aiAnalysis: true };
      default:
        return { maxLeads: 50, maxRadius: 25, aiAnalysis: false };
    }
  };

  const validateSearchParams = () => {
    const limits = getPlanLimits();
    
    if (!searchParams.location || !searchParams.industry) {
      toast({
        title: "Missing Information",
        description: "Please enter both location and industry.",
        variant: "destructive",
      });
      return false;
    }

    if (searchParams.leadsCount > limits.maxLeads) {
      toast({
        title: "Plan Limit Exceeded",
        description: `Your ${validatedUserPlan} plan allows up to ${limits.maxLeads} leads per search.`,
        variant: "destructive",
      });
      return false;
    }

    if (searchParams.radius > limits.maxRadius) {
      toast({
        title: "Radius Limit Exceeded",
        description: `Your ${validatedUserPlan} plan allows up to ${limits.maxRadius}km radius.`,
        variant: "destructive",
      });
      return false;
    }

    if (searchParams.aiAnalysis && !limits.aiAnalysis) {
      toast({
        title: "Feature Not Available",
        description: "AI analysis is only available on Pro and Enterprise plans.",
        variant: "destructive",
      });
      return false;
    }

    if (!canAffordSearch()) {
      toast({
        title: "Insufficient Credits",
        description: `This search requires ${calculateCreditsCost()} credits. You have ${validatedUserCredits} remaining.`,
        variant: "destructive",
      });
      return false;
    }

    return true;
  };

  const handleStartSearch = async () => {
    if (!validateSearchParams()) return;

    setIsSearching(true);
    
    try {
      // Convert local search params to Convex format
      const convexSearchParams: ConvexSearchParams = {
        location: searchParams.location,
        radius: searchParams.radius * 1000, // Convert km to meters for Google Maps API
        keywords: [searchParams.industry],
        industries: [searchParams.industry],
        maxResults: searchParams.leadsCount,
      };

      // Create search in Convex
      const result = await createSearch({
        name: `${searchParams.industry} leads in ${searchParams.location}`,
        parameters: convexSearchParams,
      });

      if (result.success && result.searchId) {
        // Start Google Maps search
        await searchGoogleMaps({
          searchId: result.searchId,
          ...convexSearchParams,
        });

        setCurrentTab("active");
        setSelectedSearchId(result.searchId);

        toast({
          title: "Search Started",
          description: `Searching for ${searchParams.leadsCount} ${searchParams.industry} leads in ${searchParams.location}`,
        });
      }
    } catch (error) {
      console.error("Error starting search:", error);
      toast({
        title: "Search Failed",
        description: "Failed to start search. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSearching(false);
    }
  };

  const handleCancelSearch = async (searchId: string) => {
    try {
      await cancelSearch({ searchId });
      toast({
        title: "Search Cancelled",
        description: "Search has been cancelled successfully.",
      });
    } catch (error) {
      console.error("Error cancelling search:", error);
      toast({
        title: "Cancellation Failed",
        description: "Failed to cancel search. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleViewResults = (searchId: string) => {
    setSelectedSearchId(searchId);
    setCurrentTab("results");
    toast({
      title: "Results Ready",
      description: "Viewing search results with AI-generated leads.",
    });
  };

  const renderSearchForm = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <Label htmlFor="location">Location *</Label>
          <LocationAutocomplete
            id="location"
            value={searchParams.location}
            placeholder="e.g., San Francisco, CA"
            onValueChange={(value) => setSearchParams(prev => ({ ...prev, location: value }))}
            onLocationSelect={(location) => {
              // Update location with the selected place description
              setSearchParams(prev => ({ ...prev, location: location.description }));
            }}
          />
        </div>

        <div>
          <Label htmlFor="industry">Industry *</Label>
          <div className="relative">
            <Building className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              id="industry"
              value={searchParams.industry}
              onChange={(e) => setSearchParams(prev => ({ ...prev, industry: e.target.value }))}
              placeholder="e.g., Software Development"
              className="pl-10"
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <Label htmlFor="leadsCount">Number of Leads</Label>
          <Select
            value={searchParams.leadsCount.toString()}
            onValueChange={(value) => setSearchParams(prev => ({ ...prev, leadsCount: parseInt(value) }))}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="5">5 leads</SelectItem>
              <SelectItem value="10">10 leads</SelectItem>
              <SelectItem value="25">25 leads</SelectItem>
              <SelectItem value="50">50 leads</SelectItem>
              <SelectItem value="100">100 leads</SelectItem>
              <SelectItem value="250">250 leads</SelectItem>
              {validatedUserPlan !== 'free' && <SelectItem value="500">500 leads</SelectItem>}
              {validatedUserPlan === 'enterprise' && <SelectItem value="1000">1000 leads</SelectItem>}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label htmlFor="radius">Search Radius (km)</Label>
          <Select
            value={searchParams.radius.toString()}
            onValueChange={(value) => setSearchParams(prev => ({ ...prev, radius: parseInt(value) }))}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="10">10 km</SelectItem>
              <SelectItem value="25">25 km</SelectItem>
              <SelectItem value="50">50 km</SelectItem>
              {validatedUserPlan !== 'free' && <SelectItem value="100">100 km</SelectItem>}
              {validatedUserPlan === 'enterprise' && <SelectItem value="250">250 km</SelectItem>}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label>Company Size</Label>
          <Select
            value={`${searchParams.minEmployees}-${searchParams.maxEmployees}`}
            onValueChange={(value) => {
              const [min, max] = value.split('-').map(Number);
              setSearchParams(prev => ({ ...prev, minEmployees: min, maxEmployees: max }));
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1-10">1-10 employees</SelectItem>
              <SelectItem value="10-50">10-50 employees</SelectItem>
              <SelectItem value="50-200">50-200 employees</SelectItem>
              <SelectItem value="200-1000">200-1000 employees</SelectItem>
              <SelectItem value="1000-10000">1000+ employees</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Advanced Options */}
      <Card className="p-4 bg-muted/30">
        <h4 className="font-medium mb-3 flex items-center gap-2">
          <Settings className="h-4 w-4" />
          Advanced Options
        </h4>
        
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium text-sm">Include Email Addresses</div>
              <div className="text-xs text-muted-foreground">Find contact emails for each lead (+50% cost)</div>
            </div>
            <Button
              variant={searchParams.includeEmails ? "default" : "outline"}
              size="sm"
              onClick={() => setSearchParams(prev => ({ ...prev, includeEmails: !prev.includeEmails }))}
            >
              {searchParams.includeEmails ? "Enabled" : "Disabled"}
            </Button>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium text-sm flex items-center gap-2">
                AI Analysis & Email Generation
                {validatedUserPlan === 'free' && <Badge variant="outline" className="text-xs">Pro Feature</Badge>}
              </div>
              <div className="text-xs text-muted-foreground">Analyze each lead and generate personalized emails (+100% cost)</div>
            </div>
            <Button
              variant={searchParams.aiAnalysis ? "default" : "outline"}
              size="sm"
              onClick={() => setSearchParams(prev => ({ ...prev, aiAnalysis: !prev.aiAnalysis }))}
              disabled={userPlan === 'free'}
            >
              {searchParams.aiAnalysis ? "Enabled" : "Disabled"}
            </Button>
          </div>
        </div>
      </Card>

      {/* Cost Breakdown */}
      <Card className="p-4 border-primary/20 bg-primary/5">
        <div className="flex items-center justify-between mb-2">
          <span className="font-medium">Estimated Cost</span>
          <div className="flex items-center gap-2">
            <CreditCard className="h-4 w-4 text-primary" />
            <span className="text-lg font-bold text-primary">{calculateCreditsCost()} credits</span>
          </div>
        </div>
        
        <div className="text-sm text-muted-foreground space-y-1">
          <div>Base cost: {searchParams.leadsCount} leads × 1 credit = {searchParams.leadsCount} credits</div>
          {searchParams.includeEmails && (
            <div>Email lookup: +50% = +{Math.ceil(searchParams.leadsCount * 0.5)} credits</div>
          )}
          {searchParams.aiAnalysis && (
            <div>AI analysis: +100% = +{searchParams.leadsCount} credits</div>
          )}
        </div>
        
        <div className="mt-3 text-sm">
          Remaining credits: <span className="font-medium">{userCredits}</span>
          {!canAffordSearch() && (
            <span className="text-red-600 ml-2">Insufficient credits!</span>
          )}
        </div>
      </Card>

      <Button 
        onClick={handleStartSearch}
        disabled={isSearching || !canAffordSearch()}
        className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
        size="lg"
      >
        {isSearching ? (
          <>
            <Clock className="h-4 w-4 mr-2 animate-spin" />
            Starting Search...
          </>
        ) : (
          <>
            <Play className="h-4 w-4 mr-2" />
            Start Lead Search
          </>
        )}
      </Button>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Lead Discovery</h2>
          <p className="text-muted-foreground">Find and analyze potential customers with AI-powered insights</p>
        </div>
        
        <div className="text-right">
          <div className="text-2xl font-bold text-primary">{userCredits}</div>
          <div className="text-sm text-muted-foreground">Credits Remaining</div>
        </div>
      </div>

      <Tabs value={currentTab} onValueChange={setCurrentTab}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="search">New Search</TabsTrigger>
          <TabsTrigger value="active" className="relative">
            Active
            {activeSearches.length > 0 && (
              <Badge variant="secondary" className="ml-2 text-xs">
                {activeSearches.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="completed">History</TabsTrigger>
          <TabsTrigger value="results">Results</TabsTrigger>
        </TabsList>

        <TabsContent value="search" className="mt-6">
          <Card className="p-6">
            {renderSearchForm()}
          </Card>
        </TabsContent>

        <TabsContent value="active" className="mt-6">
          <div className="space-y-4">
            {/* Urgent Broadcast Alerts */}
            {urgentBroadcasts.length > 0 && (
              <Alert className="bg-orange-50 border-orange-200">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  <div className="flex items-center justify-between">
                    <span className="font-medium">
                      {urgentBroadcasts.length} urgent alert{urgentBroadcasts.length > 1 ? 's' : ''} require attention
                    </span>
                    <div className="flex gap-2">
                      {safeArray.map(
                        safeArray.filter(urgentBroadcasts, (_, index) => index < 2),
                        (alert) => (
                          <Badge key={alert._id} variant="destructive" className="text-xs">
                            {alert.title}
                          </Badge>
                        )
                      )}
                    </div>
                  </div>
                </AlertDescription>
              </Alert>
            )}

            {/* Credit Warnings */}
            {hasLowCredits && (
              <Alert className="bg-yellow-50 border-yellow-200">
                <Bell className="h-4 w-4" />
                <AlertDescription>
                  <div className="flex items-center justify-between">
                    <span className="font-medium">
                      Low credit balance: {currentBalance} remaining
                    </span>
                    <Button size="sm" variant="outline">
                      Purchase Credits
                    </Button>
                  </div>
                </AlertDescription>
              </Alert>
            )}

            {searchesLoading ? (
              <Alert>
                <Clock className="h-4 w-4 animate-spin" />
                <AlertDescription>
                  Loading searches...
                </AlertDescription>
              </Alert>
            ) : activeSearches.length === 0 ? (
              <Alert>
                <Search className="h-4 w-4" />
                <AlertDescription>
                  No active searches. Start a new search to see real-time progress here.
                </AlertDescription>
              </Alert>
            ) : (
              <>
                {/* Real-time Progress Tracking */}
                <div className="space-y-4">
                  {safeArray.map(activeSearches, search => (
                    <SearchProgressTracker
                      key={search._id}
                      searchId={search._id}
                      compact={false}
                      showHistory={true}
                      className="border-primary/20"
                    />
                  ))}
                </div>

                {/* Live Search Broadcasts */}
                {searchBroadcasts.length > 0 && (
                  <Card className="p-4 bg-blue-50 border-blue-200">
                    <h4 className="font-semibold text-blue-800 mb-2 flex items-center gap-2">
                      <Activity className="h-4 w-4" />
                      Live Search Updates
                    </h4>
                    <div className="space-y-2">
                      {searchBroadcasts.slice(0, 3).map((broadcast) => {
                        const priorityDisplay = getPriorityDisplay(broadcast.priority);
                        return (
                          <div key={broadcast._id} className="text-sm text-blue-700">
                            <div className="flex items-center gap-2">
                              <span>{priorityDisplay.icon}</span>
                              <strong>{broadcast.title}:</strong>
                              <span>{broadcast.message}</span>
                              <span className="text-xs text-blue-600 ml-auto">
                                {formatBroadcastTime(broadcast.createdAt)}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </Card>
                )}
              </>
            )}
          </div>
        </TabsContent>

        <TabsContent value="completed" className="mt-6">
          <div className="space-y-4">
            {searchesLoading ? (
              <Alert>
                <Clock className="h-4 w-4 animate-spin" />
                <AlertDescription>
                  Loading search history...
                </AlertDescription>
              </Alert>
            ) : completedSearches.length === 0 ? (
              <Alert>
                <History className="h-4 w-4" />
                <AlertDescription>
                  No completed searches yet. Your search history will appear here.
                </AlertDescription>
              </Alert>
            ) : (
              completedSearches.map(search => (
                <Card key={search._id} className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-medium">{search.name}</h3>
                      <p className="text-sm text-muted-foreground">
                        Completed • Found {search.results.totalFound} leads • 
                        Used {search.creditsUsed} credits
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(search.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <Button size="sm" onClick={() => handleViewResults(search._id)}>
                      View Results
                    </Button>
                  </div>
                </Card>
              ))
            )}
          </div>
        </TabsContent>

        <TabsContent value="results" className="mt-6">
          <GenniLeadSearch 
            searchId={selectedSearchId} 
            onGenerateEmail={onGenerateEmail} 
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
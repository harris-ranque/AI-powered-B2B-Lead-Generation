import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { 
  Search, 
  Clock, 
  CheckCircle, 
  AlertCircle, 
  RefreshCw, 
  Users, 
  MapPin, 
  Building,
  X,
  Pause,
  Play
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Lead } from "@/lib/api-client";

export interface SearchSession {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  searchParams: {
    location: string;
    industry: string;
    leadsCount: number;
    radius?: number;
    minEmployees?: number;
    maxEmployees?: number;
  };
  progress: {
    current: number;
    total: number;
    stage: 'discovery' | 'enrichment' | 'analysis' | 'completed';
    stageDetails: string;
  };
  results: {
    leadsFound: number;
    leadsEnriched: number;
    leadsWithEmails: number;
    leadsAnalyzed: number;
  };
  timing: {
    startedAt: string;
    estimatedCompletion?: string;
    completedAt?: string;
  };
  creditsUsed: number;
  leads?: Lead[];
  error?: string;
}

interface SearchSessionManagerProps {
  session: SearchSession;
  onCancel?: (sessionId: string) => void;
  onPause?: (sessionId: string) => void;
  onResume?: (sessionId: string) => void;
  onViewResults?: (session: SearchSession) => void;
  onRetry?: (sessionId: string) => void;
}

export function SearchSessionManager({ 
  session, 
  onCancel, 
  onPause, 
  onResume, 
  onViewResults,
  onRetry 
}: SearchSessionManagerProps) {
  const [timeElapsed, setTimeElapsed] = useState(0);
  const { toast } = useToast();

  useEffect(() => {
    const interval = setInterval(() => {
      const startTime = new Date(session.timing.startedAt).getTime();
      const now = Date.now();
      setTimeElapsed(Math.floor((now - startTime) / 1000));
    }, 1000);

    return () => clearInterval(interval);
  }, [session.timing.startedAt]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getStatusColor = () => {
    switch (session.status) {
      case 'completed':
        return 'bg-green-100 text-green-800';
      case 'processing':
        return 'bg-blue-100 text-blue-800';
      case 'failed':
        return 'bg-red-100 text-red-800';
      case 'cancelled':
        return 'bg-gray-100 text-gray-800';
      default:
        return 'bg-yellow-100 text-yellow-800';
    }
  };

  const getStatusIcon = () => {
    switch (session.status) {
      case 'completed':
        return <CheckCircle className="h-4 w-4" />;
      case 'processing':
        return <RefreshCw className="h-4 w-4 animate-spin" />;
      case 'failed':
        return <AlertCircle className="h-4 w-4" />;
      case 'cancelled':
        return <X className="h-4 w-4" />;
      default:
        return <Clock className="h-4 w-4" />;
    }
  };

  const getProgressPercentage = () => {
    if (session.progress.total === 0) return 0;
    return Math.round((session.progress.current / session.progress.total) * 100);
  };

  const getStageDescription = () => {
    switch (session.progress.stage) {
      case 'discovery':
        return 'Discovering leads using Google Maps API...';
      case 'enrichment':
        return 'Enriching lead data with contact information...';
      case 'analysis':
        return 'Analyzing leads with AI for personalization...';
      case 'completed':
        return 'Search completed successfully!';
      default:
        return 'Processing...';
    }
  };

  const handleCancel = () => {
    if (onCancel) {
      onCancel(session.id);
      toast({
        title: "Search Cancelled",
        description: "Your search has been cancelled. You will only be charged for leads processed so far.",
      });
    }
  };

  const handlePause = () => {
    if (onPause) {
      onPause(session.id);
      toast({
        title: "Search Paused",
        description: "Your search has been paused. You can resume it later.",
      });
    }
  };

  const handleResume = () => {
    if (onResume) {
      onResume(session.id);
      toast({
        title: "Search Resumed",
        description: "Your search has been resumed.",
      });
    }
  };

  const handleRetry = () => {
    if (onRetry) {
      onRetry(session.id);
      toast({
        title: "Search Retried",
        description: "Your search is being retried with the same parameters.",
      });
    }
  };

  return (
    <Card className="p-6">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <Search className="h-6 w-6 text-primary" />
          <div>
            <h3 className="font-semibold text-lg">
              {session.searchParams.industry} leads in {session.searchParams.location}
            </h3>
            <p className="text-sm text-muted-foreground">
              Target: {session.searchParams.leadsCount} leads • Session ID: {session.id.slice(0, 8)}
            </p>
          </div>
        </div>

        <Badge className={getStatusColor()}>
          {getStatusIcon()}
          <span className="ml-2 capitalize">{session.status}</span>
        </Badge>
      </div>

      {/* Search Parameters */}
      <div className="flex items-center gap-4 text-sm text-muted-foreground mb-4">
        <div className="flex items-center gap-1">
          <MapPin className="h-4 w-4" />
          {session.searchParams.location}
        </div>
        <div className="flex items-center gap-1">
          <Building className="h-4 w-4" />
          {session.searchParams.industry}
        </div>
        <div className="flex items-center gap-1">
          <Users className="h-4 w-4" />
          {session.searchParams.leadsCount} requested
        </div>
        <div className="flex items-center gap-1">
          <Clock className="h-4 w-4" />
          {formatTime(timeElapsed)}
        </div>
      </div>

      {/* Progress Section */}
      {session.status === 'processing' && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">{getStageDescription()}</span>
            <span className="text-sm text-muted-foreground">
              {getProgressPercentage()}%
            </span>
          </div>
          <Progress value={getProgressPercentage()} className="h-2 mb-2" />
          <p className="text-xs text-muted-foreground">
            {session.progress.stageDetails}
          </p>
        </div>
      )}

      {/* Results Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="text-center">
          <div className="text-2xl font-bold text-primary">{session.results.leadsFound}</div>
          <div className="text-xs text-muted-foreground">Leads Found</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-blue-600">{session.results.leadsEnriched}</div>
          <div className="text-xs text-muted-foreground">Enriched</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-green-600">{session.results.leadsWithEmails}</div>
          <div className="text-xs text-muted-foreground">With Emails</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-purple-600">{session.results.leadsAnalyzed}</div>
          <div className="text-xs text-muted-foreground">AI Analyzed</div>
        </div>
      </div>

      {/* Error Alert */}
      {session.status === 'failed' && session.error && (
        <Alert className="mb-4" variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            <strong>Search Failed:</strong> {session.error}
          </AlertDescription>
        </Alert>
      )}

      {/* Timing and Credits */}
      <div className="flex items-center justify-between text-sm text-muted-foreground mb-4">
        <div>
          Started: {new Date(session.timing.startedAt).toLocaleTimeString()}
          {session.timing.completedAt && (
            <> • Completed: {new Date(session.timing.completedAt).toLocaleTimeString()}</>
          )}
        </div>
        <div>
          Credits used: <span className="font-medium text-foreground">{session.creditsUsed}</span>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center gap-2">
        {session.status === 'processing' && (
          <>
            <Button variant="outline" size="sm" onClick={handlePause}>
              <Pause className="h-4 w-4 mr-2" />
              Pause
            </Button>
            <Button variant="outline" size="sm" onClick={handleCancel}>
              <X className="h-4 w-4 mr-2" />
              Cancel
            </Button>
          </>
        )}

        {session.status === 'paused' && (
          <Button variant="outline" size="sm" onClick={handleResume}>
            <Play className="h-4 w-4 mr-2" />
            Resume
          </Button>
        )}

        {session.status === 'failed' && (
          <Button variant="outline" size="sm" onClick={handleRetry}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Retry
          </Button>
        )}

        {session.status === 'completed' && session.results.leadsFound > 0 && (
          <Button 
            onClick={() => onViewResults?.(session)}
            className="bg-primary hover:bg-primary/90"
          >
            <CheckCircle className="h-4 w-4 mr-2" />
            View {session.results.leadsFound} Results
          </Button>
        )}
      </div>
    </Card>
  );
}

// Mock functions removed - now using real search progress tracking via:
// - Real search creation via search.mutations.createSearch() 
// - Real-time progress via useStatusBroadcasts() hook
// - Search status updates via real-time broadcasting system

// NOTE: This component should be updated to use:
// 1. Real search creation: useMutation(api.search.mutations.createSearch)
// 2. Real progress tracking: useStatusBroadcasts() for live updates
// 3. Real search data: useQuery(api.search.queries.getSearchById)

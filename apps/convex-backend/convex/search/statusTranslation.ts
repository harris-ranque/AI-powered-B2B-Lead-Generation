import { STATUS } from "../lib/constants";

/**
 * User-Friendly Status Translation System
 * 
 * Converts technical pipeline statuses into clear, actionable user messages
 * with progress percentages and estimated completion times.
 */

export interface UserStatus {
  stage: string;
  message: string;
  progressPercent: number;
  estimatedTimeRemaining?: number;
  actionRequired?: boolean;
  nextStep?: string;
}

// Main status translation function
export function translateSearchStatus(
  search: any,
  leadCount?: number,
  enrichedCount?: number,
  analyzedCount?: number
): UserStatus {
  const now = Date.now();
  const timeSinceStart = now - (search.startedAt || search.createdAt);
  const progress = search.progress || { discovered: 0, enriched: 0, analyzed: 0, total: search.parameters?.maxResults || 50 };
  
  switch (search.status) {
    case STATUS.SEARCH.PENDING:
      return {
        stage: "Getting Started",
        message: "Your search is being prepared. We'll start finding leads shortly.",
        progressPercent: 5,
        estimatedTimeRemaining: 60000, // 1 minute
        nextStep: "Starting lead discovery"
      };

    case STATUS.SEARCH.IN_PROGRESS:
      return translateInProgressStatus(search, progress, timeSinceStart, leadCount, enrichedCount, analyzedCount);

    case STATUS.SEARCH.COMPLETED:
      return {
        stage: "Complete",
        message: `Great! Found ${progress.discovered} leads with ${progress.enriched} contact emails.`,
        progressPercent: 100,
        nextStep: "Download your results or start a new search"
      };

    case STATUS.SEARCH.FAILED:
      return {
        stage: "Failed",
        message: search.error ? 
          translateErrorMessage(search.error) : 
          "Something went wrong. Our team has been notified.",
        progressPercent: 0,
        actionRequired: true,
        nextStep: "Try starting a new search or contact support"
      };

    case STATUS.SEARCH.CANCELLED:
      return {
        stage: "Cancelled",
        message: "You cancelled this search.",
        progressPercent: 0,
        nextStep: "Start a new search when you're ready"
      };

    default:
      return {
        stage: "Unknown",
        message: "Search status unclear. Please refresh the page.",
        progressPercent: 0,
        actionRequired: true
      };
  }
}

// Translate in-progress status with detailed pipeline awareness
function translateInProgressStatus(
  search: any, 
  progress: any, 
  timeSinceStart: number,
  leadCount?: number,
  enrichedCount?: number,
  analyzedCount?: number
): UserStatus {
  const currentLeads = leadCount || progress.discovered || 0;
  const currentEnriched = enrichedCount || progress.enriched || 0;
  const currentAnalyzed = analyzedCount || progress.analyzed || 0;
  
  // Determine current pipeline stage
  if (currentLeads === 0) {
    // Discovery phase
    const timeInMinutes = Math.floor(timeSinceStart / 60000);
    return {
      stage: "Finding Leads",
      message: `Searching for businesses in your area${timeInMinutes > 1 ? ` (${timeInMinutes} min so far)` : ''}...`,
      progressPercent: Math.min(20, (timeSinceStart / 300000) * 20), // 20% max for discovery
      estimatedTimeRemaining: Math.max(60000, 300000 - timeSinceStart), // Up to 5 minutes
      nextStep: "Finding contact information"
    };
  } else if (currentEnriched < currentLeads) {
    // Enrichment phase
    const enrichmentPercent = currentLeads > 0 ? Math.round((currentEnriched / currentLeads) * 100) : 0;
    const progressPercent = 20 + Math.round((currentEnriched / currentLeads) * 50); // 20-70%
    
    return {
      stage: "Finding Contact Info",
      message: `Found ${currentLeads} leads. Getting contact details (${enrichmentPercent}% complete)...`,
      progressPercent,
      estimatedTimeRemaining: estimateRemainingTime(currentEnriched, currentLeads, timeSinceStart, 'enrichment'),
      nextStep: "Analyzing lead quality"
    };
  } else if (currentAnalyzed < currentEnriched) {
    // Analysis phase
    const analysisPercent = currentEnriched > 0 ? Math.round((currentAnalyzed / currentEnriched) * 100) : 0;
    const progressPercent = 70 + Math.round((currentAnalyzed / currentEnriched) * 25); // 70-95%
    
    return {
      stage: "Analyzing Leads",
      message: `Analyzing ${currentEnriched} contacts with AI (${analysisPercent}% complete)...`,
      progressPercent,
      estimatedTimeRemaining: estimateRemainingTime(currentAnalyzed, currentEnriched, timeSinceStart, 'analysis'),
      nextStep: "Finalizing results"
    };
  } else {
    // Finalizing
    return {
      stage: "Finalizing",
      message: `Almost done! Preparing your ${currentAnalyzed} analyzed leads for download.`,
      progressPercent: 95,
      estimatedTimeRemaining: 30000, // 30 seconds
      nextStep: "Results ready for download"
    };
  }
}

// Estimate remaining time based on current progress
function estimateRemainingTime(
  completed: number, 
  total: number, 
  timeElapsed: number, 
  phase: 'enrichment' | 'analysis'
): number {
  if (completed === 0) {
    // Default estimates based on phase
    return phase === 'enrichment' ? 180000 : 120000; // 3 min enrichment, 2 min analysis
  }

  const progressRate = completed / timeElapsed; // items per millisecond
  const remaining = total - completed;
  const estimatedTime = remaining / progressRate;

  // Apply phase-specific multipliers and caps
  const phaseMultiplier = phase === 'enrichment' ? 1.5 : 1.2; // Enrichment is typically slower
  const adjustedTime = estimatedTime * phaseMultiplier;

  // Cap estimates to reasonable ranges
  const maxTime = phase === 'enrichment' ? 600000 : 300000; // 10 min enrichment, 5 min analysis
  return Math.min(adjustedTime, maxTime);
}

// Translate technical error messages to user-friendly ones
function translateErrorMessage(technicalError: string): string {
  const errorTranslations: Record<string, string> = {
    'API_TIMEOUT': 'External service is running slow. We\'ll retry automatically.',
    'RATE_LIMITED': 'Too many searches right now. Please wait 5 minutes and try again.',
    'INSUFFICIENT_CREDITS': 'You don\'t have enough credits for this search. Add more credits in your account settings.',
    'INVALID_LOCATION': 'We couldn\'t find that location. Please try a different address or city name.',
    'NO_RESULTS_FOUND': 'No businesses found matching your search. Try expanding your search area or different keywords.',
    'ENRICHMENT_FAILED': 'We found leads but couldn\'t get contact information. You can still view the business details.',
    'ANALYSIS_FAILED': 'We found leads and contacts but couldn\'t complete the AI analysis. Your results are still available.',
    'QUOTA_EXCEEDED': 'You\'ve reached your daily search limit. Upgrade your plan or try again tomorrow.',
    'INVALID_PARAMETERS': 'Something was wrong with your search settings. Please check and try again.',
    'SYSTEM_OVERLOAD': 'Our system is busy right now. Please try again in a few minutes.',
    'NETWORK_ERROR': 'Connection issue detected. We\'ll retry automatically.',
    'TIMEOUT_ERROR': 'This search is taking too long. We\'ve saved your progress - try a smaller search area.',
  };

  // Try to match technical error to user-friendly message
  for (const [technical, friendly] of Object.entries(errorTranslations)) {
    if (technicalError.toUpperCase().includes(technical)) {
      return friendly;
    }
  }

  // Default user-friendly message for unknown errors
  return 'Something unexpected happened. Our team has been notified and will fix this quickly.';
}

// Calculate overall progress percentage with weighted phases
export function calculateProgressPercentage(progress: any): number {
  const { discovered, enriched, analyzed, total } = progress;
  
  if (total === 0) return 0;

  // Weighted progress calculation
  const discoveryWeight = 0.3;   // Discovery is 30% of total progress
  const enrichmentWeight = 0.5;  // Enrichment is 50% of total progress  
  const analysisWeight = 0.2;    // Analysis is 20% of total progress

  const discoveryProgress = Math.min(discovered / total, 1.0) * discoveryWeight;
  const enrichmentProgress = discovered > 0 ? Math.min(enriched / discovered, 1.0) * enrichmentWeight : 0;
  const analysisProgress = enriched > 0 ? Math.min(analyzed / enriched, 1.0) * analysisWeight : 0;

  return Math.round((discoveryProgress + enrichmentProgress + analysisProgress) * 100);
}

// Generate next action suggestions based on current status
export function getNextActionSuggestion(status: UserStatus, search: any): string | null {
  if (status.actionRequired) {
    return status.nextStep || "Please contact support for assistance";
  }

  if (status.stage === "Complete") {
    return "Download CSV • View Results • Start New Search";
  }

  if (status.progressPercent > 80) {
    return "Results will be ready shortly";
  }

  if (status.estimatedTimeRemaining && status.estimatedTimeRemaining > 300000) {
    return "This is a large search - grab a coffee while we work!";
  }

  return null;
}
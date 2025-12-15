/**
 * API Error Alert Component
 *
 * Inline error alert with action buttons for user-actionable API errors.
 * Supports retry countdown, provider-specific icons, and severity-based styling.
 *
 * Usage:
 * ```tsx
 * <ApiErrorAlert
 *   error={apiError}
 *   onDismiss={() => clearError()}
 *   onRetry={() => retryOperation()}
 *   onAction={(action) => handleAction(action)}
 * />
 * ```
 */

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertCircle,
  AlertTriangle,
  Info,
  XCircle,
  X,
  RefreshCw,
  ExternalLink,
  Settings,
  CreditCard,
  Mail,
  HelpCircle,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  ApiError,
  ApiErrorCategory,
  ErrorAction,
  ErrorSeverity,
} from "@genni/shared-types";

export interface ApiErrorAlertProps {
  /** The API error to display */
  error: ApiError;
  /** Called when the alert is dismissed */
  onDismiss?: () => void;
  /** Called when retry is clicked (for retryable errors) */
  onRetry?: () => void;
  /** Called when the action button is clicked */
  onAction?: (action: ErrorAction) => void;
  /** Custom class name */
  className?: string;
  /** Whether to show the dismiss button */
  showDismiss?: boolean;
  /** Whether to compact the alert */
  compact?: boolean;
}

/**
 * Provider icon mapping
 */
const PROVIDER_ICONS: Record<string, React.ReactNode> = {
  google_maps: <span className="text-lg">🗺️</span>,
  google_places: <span className="text-lg">📍</span>,
  findymail: <Mail className="h-4 w-4" />,
  perplexity: <span className="text-lg">🔍</span>,
  tavily: <span className="text-lg">🔎</span>,
  openai: <span className="text-lg">🤖</span>,
  fastspring: <CreditCard className="h-4 w-4" />,
  instantly: <span className="text-lg">⚡</span>,
  internal: <Settings className="h-4 w-4" />,
};

/**
 * Severity icon mapping
 */
const SEVERITY_ICONS: Record<ErrorSeverity, React.ReactNode> = {
  info: <Info className="h-4 w-4" />,
  warning: <AlertTriangle className="h-4 w-4" />,
  error: <AlertCircle className="h-4 w-4" />,
  critical: <XCircle className="h-4 w-4" />,
};

/**
 * Severity styles mapping
 */
const SEVERITY_STYLES: Record<ErrorSeverity, string> = {
  info: "border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-100",
  warning:
    "border-yellow-200 bg-yellow-50 text-yellow-900 dark:border-yellow-800 dark:bg-yellow-950 dark:text-yellow-100",
  error:
    "border-red-200 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100",
  critical:
    "border-red-300 bg-red-100 text-red-900 dark:border-red-700 dark:bg-red-900 dark:text-red-100",
};

/**
 * Action icon mapping
 */
const ACTION_ICONS: Record<ErrorAction, React.ReactNode> = {
  check_api_key: <Settings className="h-4 w-4" />,
  add_credits: <CreditCard className="h-4 w-4" />,
  wait_retry: <RefreshCw className="h-4 w-4 animate-spin" />,
  manual_retry: <RefreshCw className="h-4 w-4" />,
  contact_support: <HelpCircle className="h-4 w-4" />,
  upgrade_plan: <CreditCard className="h-4 w-4" />,
  check_connection: <AlertTriangle className="h-4 w-4" />,
  fix_input: <AlertCircle className="h-4 w-4" />,
  none: null,
};

/**
 * Default action URLs
 */
const DEFAULT_ACTION_URLS: Record<ErrorAction, string | null> = {
  check_api_key: "/settings?tab=api-keys",
  add_credits: "/subscribe",
  wait_retry: null,
  manual_retry: null,
  contact_support: "/contact",
  upgrade_plan: "/subscribe",
  check_connection: null,
  fix_input: null,
  none: null,
};

/**
 * Get human-readable provider name
 */
function getProviderDisplayName(provider: string): string {
  const names: Record<string, string> = {
    google_maps: "Google Maps",
    google_places: "Google Places",
    findymail: "FindyMail",
    perplexity: "Perplexity",
    tavily: "Tavily",
    openai: "OpenAI",
    fastspring: "FastSpring",
    instantly: "Instantly",
    internal: "System",
  };
  return names[provider] || provider;
}

/**
 * Get default action button label
 */
function getDefaultActionLabel(action: ErrorAction): string {
  const labels: Record<ErrorAction, string> = {
    check_api_key: "Check API Key",
    add_credits: "Add Credits",
    wait_retry: "Waiting...",
    manual_retry: "Retry",
    contact_support: "Contact Support",
    upgrade_plan: "Upgrade Plan",
    check_connection: "Check Connection",
    fix_input: "Fix Input",
    none: "",
  };
  return labels[action] || "Take Action";
}

/**
 * API Error Alert Component
 */
export function ApiErrorAlert({
  error,
  onDismiss,
  onRetry,
  onAction,
  className,
  showDismiss = true,
  compact = false,
}: ApiErrorAlertProps) {
  const navigate = useNavigate();
  const [retryCountdown, setRetryCountdown] = useState<number | null>(null);

  // Handle auto-retry countdown
  useEffect(() => {
    if (!error.retryable || !error.retryAfterMs) return;

    let remaining = Math.ceil(error.retryAfterMs / 1000);
    setRetryCountdown(remaining);

    const interval = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(interval);
        setRetryCountdown(null);
        onRetry?.();
      } else {
        setRetryCountdown(remaining);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [error.retryable, error.retryAfterMs, onRetry]);

  // Handle action click
  const handleActionClick = () => {
    onAction?.(error.suggestedAction);

    const url = error.actionUrl || DEFAULT_ACTION_URLS[error.suggestedAction];
    if (url) {
      if (url.startsWith("http://") || url.startsWith("https://")) {
        window.open(url, "_blank", "noopener,noreferrer");
      } else {
        navigate(url);
      }
    }
  };

  // Determine if action button should be shown
  const showActionButton =
    error.suggestedAction !== "none" && error.suggestedAction !== "wait_retry";

  // Get action label
  const actionLabel =
    error.actionLabel || getDefaultActionLabel(error.suggestedAction);

  // Determine if this is an external link
  const isExternalLink =
    error.actionUrl?.startsWith("http://") ||
    error.actionUrl?.startsWith("https://");

  return (
    <Alert
      className={cn(
        SEVERITY_STYLES[error.severity],
        compact ? "py-2 px-3" : "py-4",
        className
      )}
    >
      {/* Provider icon */}
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 mt-0.5">
          {PROVIDER_ICONS[error.provider] || SEVERITY_ICONS[error.severity]}
        </div>

        <div className="flex-1 min-w-0">
          {/* Title with provider name */}
          <AlertTitle className={cn("font-semibold", compact && "text-sm")}>
            {getProviderDisplayName(error.provider)} Error
          </AlertTitle>

          {/* Error message */}
          <AlertDescription
            className={cn("mt-1", compact && "text-xs", "text-inherit/90")}
          >
            {error.userMessage}
          </AlertDescription>

          {/* Retry countdown */}
          {retryCountdown !== null && retryCountdown > 0 && (
            <div
              className={cn(
                "mt-2 flex items-center gap-2 text-sm",
                compact && "text-xs"
              )}
            >
              <RefreshCw className="h-3 w-3 animate-spin" />
              <span>Retrying in {retryCountdown}s...</span>
            </div>
          )}

          {/* Action buttons */}
          {(showActionButton || (error.retryable && onRetry)) && (
            <div className={cn("mt-3 flex items-center gap-2", compact && "mt-2")}>
              {showActionButton && (
                <Button
                  size={compact ? "sm" : "default"}
                  variant={error.severity === "critical" ? "destructive" : "secondary"}
                  onClick={handleActionClick}
                  className="gap-2"
                >
                  {ACTION_ICONS[error.suggestedAction]}
                  {actionLabel}
                  {isExternalLink && <ExternalLink className="h-3 w-3" />}
                </Button>
              )}

              {error.retryable && onRetry && !retryCountdown && (
                <Button
                  size={compact ? "sm" : "default"}
                  variant="outline"
                  onClick={onRetry}
                  className="gap-2"
                >
                  <RefreshCw className="h-4 w-4" />
                  Retry Now
                </Button>
              )}
            </div>
          )}
        </div>

        {/* Dismiss button */}
        {showDismiss && onDismiss && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 flex-shrink-0 opacity-70 hover:opacity-100"
            onClick={onDismiss}
          >
            <X className="h-4 w-4" />
            <span className="sr-only">Dismiss</span>
          </Button>
        )}
      </div>
    </Alert>
  );
}

/**
 * Check if an error category is user-actionable
 */
export function isUserActionableCategory(category: ApiErrorCategory): boolean {
  const actionableCategories: ApiErrorCategory[] = [
    "authentication",
    "authorization",
    "quota_exhausted",
    "rate_limit_exceeded",
  ];
  return actionableCategories.includes(category);
}

export default ApiErrorAlert;

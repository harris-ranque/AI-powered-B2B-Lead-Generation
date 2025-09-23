// Global error handler for uncaught errors and promise rejections
import { trackError, logger } from "@/utils/logger";
import * as Sentry from "@sentry/react";

export interface ErrorDetails {
  message: string;
  stack?: string;
  url?: string;
  lineNumber?: number;
  columnNumber?: number;
  timestamp: number;
  userAgent: string;
  href: string;
}

const errorLogger = logger;

class GlobalErrorHandler {
  private static instance: GlobalErrorHandler;
  private errorQueue: ErrorDetails[] = [];
  private maxErrors = 10;
  private readonly isBrowser: boolean;

  private constructor() {
    this.isBrowser =
      typeof window !== "undefined" && typeof document !== "undefined";

    if (this.isBrowser) {
      this.setupErrorHandlers();
      errorLogger.info("Global error handler initialized");
    } else {
      errorLogger.info(
        "Global error handler initialized in non-browser environment",
      );
    }
  }

  public static getInstance(): GlobalErrorHandler {
    if (!GlobalErrorHandler.instance) {
      GlobalErrorHandler.instance = new GlobalErrorHandler();
    }
    return GlobalErrorHandler.instance;
  }

  private setupErrorHandlers(): void {
    if (!this.isBrowser) {
      errorLogger.debug(
        "Skipping global error handler setup outside browser environment",
      );
      return;
    }

    errorLogger.debug("Setting up global error handlers");

    // Handle uncaught JavaScript errors
    window.addEventListener("error", (event) => {
      const errorDetails = {
        message: event.message,
        stack: event.error?.stack,
        url: event.filename,
        lineNumber: event.lineno,
        columnNumber: event.colno,
        timestamp: Date.now(),
        userAgent: this.getUserAgent(),
        href: this.getLocationHref(),
      };

      errorLogger.error("Uncaught error detected", errorDetails);
      this.handleError(errorDetails);
    });

    // Handle unhandled promise rejections
    window.addEventListener("unhandledrejection", (event) => {
      const errorDetails = {
        message: `Unhandled Promise Rejection: ${event.reason}`,
        stack: event.reason?.stack,
        timestamp: Date.now(),
        userAgent: this.getUserAgent(),
        href: this.getLocationHref(),
      };

      errorLogger.error("Unhandled promise rejection", {
        reason: event.reason,
        promise: event.promise,
      });

      this.handleError(errorDetails);
    });
  }

  private handleError(errorDetails: ErrorDetails): void {
    // Track error with logger
    const error = new Error(errorDetails.message);
    if (errorDetails.stack) {
      error.stack = errorDetails.stack;
    }
    trackError(error, {
      url: errorDetails.url,
      lineNumber: errorDetails.lineNumber,
      columnNumber: errorDetails.columnNumber,
      href: errorDetails.href,
    });

    // Also report to Sentry with useful context
    Sentry.captureException(error, {
      extra: {
        url: errorDetails.url,
        lineNumber: errorDetails.lineNumber,
        columnNumber: errorDetails.columnNumber,
        href: errorDetails.href,
        userAgent: errorDetails.userAgent,
        timestamp: errorDetails.timestamp,
      },
    });

    // Log to console in development
    if (import.meta.env.DEV) {
      console.error("Global Error Handler:", errorDetails);
    }

    // Add to error queue
    this.errorQueue.push(errorDetails);
    errorLogger.debug("Error added to queue", {
      queueSize: this.errorQueue.length,
      errorMessage: errorDetails.message,
    });

    // Keep only the most recent errors
    if (this.errorQueue.length > this.maxErrors) {
      const removed = this.errorQueue.shift();
      errorLogger.debug("Old error removed from queue", {
        removedMessage: removed?.message,
      });
    }

    // Handle specific error types
    this.handleSpecificErrors(errorDetails);
  }

  private handleSpecificErrors(errorDetails: ErrorDetails): void {
    const message = errorDetails.message.toLowerCase();
    errorLogger.debug("Analyzing error type", { message });

    // Environment variable errors
    if (
      message.includes("vite_convex_url") ||
      message.includes("environment variable")
    ) {
      errorLogger.warn("Configuration error detected", { message });
      this.showUserFriendlyError(
        "Configuration Error",
        "The application is temporarily unavailable due to configuration updates. Please try refreshing the page.",
      );
      return;
    }

    // Network errors
    if (
      message.includes("fetch") ||
      message.includes("network") ||
      message.includes("connection")
    ) {
      errorLogger.warn("Network error detected", { message });
      this.showUserFriendlyError(
        "Connection Error",
        "Unable to connect to our services. Please check your internet connection and try again.",
      );
      return;
    }

    // Convex client errors
    if (message.includes("convex") || message.includes("client")) {
      errorLogger.warn("Convex client error detected", { message });
      this.showUserFriendlyError(
        "Service Error",
        "Our backend service is temporarily unavailable. Please try again in a few minutes.",
      );
      return;
    }

    // For production, show generic error message for unknown errors
    if (!import.meta.env.DEV) {
      errorLogger.error("Unknown error in production", { message });
      this.showUserFriendlyError(
        "Unexpected Error",
        "Something went wrong. Please refresh the page and try again.",
      );
    } else {
      errorLogger.error("Unknown error in development", {
        message,
        fullDetails: errorDetails,
      });
    }
  }

  private showUserFriendlyError(title: string, message: string): void {
    errorLogger.info("Showing user-friendly error", { title, message });

    if (!this.isBrowser) {
      errorLogger.debug(
        "Skipping DOM error notification because document is unavailable",
      );
      return;
    }

    // Create a user-friendly error notification
    const errorDiv = document.createElement("div");
    errorDiv.className =
      "fixed top-4 right-4 z-50 max-w-sm bg-red-50 border border-red-200 rounded-lg p-4 shadow-lg";
    errorDiv.innerHTML = `
      <div class="flex items-start">
        <div class="flex-shrink-0">
          <svg class="h-5 w-5 text-red-400" fill="currentColor" viewBox="0 0 20 20">
            <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"/>
          </svg>
        </div>
        <div class="ml-3 flex-1">
          <h3 class="text-sm font-medium text-red-800">${title}</h3>
          <p class="mt-1 text-sm text-red-700">${message}</p>
          <div class="mt-2">
            <button class="text-sm bg-red-100 hover:bg-red-200 text-red-800 px-2 py-1 rounded" onclick="window.location.reload()">
              Refresh Page
            </button>
            <button class="ml-2 text-sm text-red-600 hover:text-red-500" onclick="this.closest('.fixed').remove()">
              Dismiss
            </button>
          </div>
        </div>
      </div>
    `;

    // Remove after 10 seconds
    setTimeout(() => {
      if (errorDiv.parentNode) {
        errorDiv.parentNode.removeChild(errorDiv);
        errorLogger.debug("Error notification auto-dismissed", { title });
      }
    }, 10000);

    // Add to DOM
    document.body.appendChild(errorDiv);
  }

  public getRecentErrors(): ErrorDetails[] {
    errorLogger.debug("Getting recent errors", {
      count: this.errorQueue.length,
    });
    return [...this.errorQueue];
  }

  public clearErrors(): void {
    const count = this.errorQueue.length;
    this.errorQueue = [];
    errorLogger.info("Error queue cleared", { previousCount: count });
  }

  private getUserAgent(): string {
    if (typeof navigator !== "undefined" && navigator.userAgent) {
      return navigator.userAgent;
    }
    return "unknown";
  }

  private getLocationHref(): string {
    if (typeof window !== "undefined" && window.location) {
      return window.location.href;
    }
    return "";
  }
}

// Initialize the global error handler
export const globalErrorHandler = GlobalErrorHandler.getInstance();

// Export helper functions
export const getRecentErrors = () => globalErrorHandler.getRecentErrors();
export const clearErrors = () => globalErrorHandler.clearErrors();

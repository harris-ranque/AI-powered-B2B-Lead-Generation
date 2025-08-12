// Global error handler for uncaught errors and promise rejections

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

class GlobalErrorHandler {
  private static instance: GlobalErrorHandler;
  private errorQueue: ErrorDetails[] = [];
  private maxErrors = 10;

  private constructor() {
    this.setupErrorHandlers();
  }

  public static getInstance(): GlobalErrorHandler {
    if (!GlobalErrorHandler.instance) {
      GlobalErrorHandler.instance = new GlobalErrorHandler();
    }
    return GlobalErrorHandler.instance;
  }

  private setupErrorHandlers(): void {
    // Handle uncaught JavaScript errors
    window.addEventListener('error', (event) => {
      this.handleError({
        message: event.message,
        stack: event.error?.stack,
        url: event.filename,
        lineNumber: event.lineno,
        columnNumber: event.colno,
        timestamp: Date.now(),
        userAgent: navigator.userAgent,
        href: window.location.href,
      });
    });

    // Handle unhandled promise rejections
    window.addEventListener('unhandledrejection', (event) => {
      this.handleError({
        message: `Unhandled Promise Rejection: ${event.reason}`,
        stack: event.reason?.stack,
        timestamp: Date.now(),
        userAgent: navigator.userAgent,
        href: window.location.href,
      });
    });
  }

  private handleError(errorDetails: ErrorDetails): void {
    // Log to console in development
    if (import.meta.env.DEV) {
      console.error('Global Error Handler:', errorDetails);
    }

    // Add to error queue
    this.errorQueue.push(errorDetails);
    
    // Keep only the most recent errors
    if (this.errorQueue.length > this.maxErrors) {
      this.errorQueue.shift();
    }

    // Handle specific error types
    this.handleSpecificErrors(errorDetails);
  }

  private handleSpecificErrors(errorDetails: ErrorDetails): void {
    const message = errorDetails.message.toLowerCase();

    // Environment variable errors
    if (message.includes('vite_convex_url') || message.includes('environment variable')) {
      this.showUserFriendlyError(
        'Configuration Error',
        'The application is temporarily unavailable due to configuration updates. Please try refreshing the page.'
      );
      return;
    }

    // Network errors
    if (message.includes('fetch') || message.includes('network') || message.includes('connection')) {
      this.showUserFriendlyError(
        'Connection Error',
        'Unable to connect to our services. Please check your internet connection and try again.'
      );
      return;
    }

    // Convex client errors
    if (message.includes('convex') || message.includes('client')) {
      this.showUserFriendlyError(
        'Service Error',
        'Our backend service is temporarily unavailable. Please try again in a few minutes.'
      );
      return;
    }

    // For production, show generic error message for unknown errors
    if (!import.meta.env.DEV) {
      this.showUserFriendlyError(
        'Unexpected Error',
        'Something went wrong. Please refresh the page and try again.'
      );
    }
  }

  private showUserFriendlyError(title: string, message: string): void {
    // Create a user-friendly error notification
    const errorDiv = document.createElement('div');
    errorDiv.className = 'fixed top-4 right-4 z-50 max-w-sm bg-red-50 border border-red-200 rounded-lg p-4 shadow-lg';
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
      }
    }, 10000);

    // Add to DOM
    document.body.appendChild(errorDiv);
  }

  public getRecentErrors(): ErrorDetails[] {
    return [...this.errorQueue];
  }

  public clearErrors(): void {
    this.errorQueue = [];
  }
}

// Initialize the global error handler
export const globalErrorHandler = GlobalErrorHandler.getInstance();

// Export helper functions
export const getRecentErrors = () => globalErrorHandler.getRecentErrors();
export const clearErrors = () => globalErrorHandler.clearErrors();
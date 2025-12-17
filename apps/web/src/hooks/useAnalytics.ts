/**
 * Centralized Analytics Hook
 *
 * Provides type-safe PostHog event tracking with consistent error handling
 * and structured event properties across the application.
 *
 * Usage:
 * ```typescript
 * const analytics = useAnalytics();
 * analytics.trackUserSignUp({ method: 'email', plan: 'starter' });
 * ```
 */

import { usePostHog } from 'posthog-js/react';
import { useCallback } from 'react';

// Event property types for type safety
export interface BaseEventProperties {
  [key: string]: string | number | boolean | undefined;
}

export interface AuthEventProperties extends BaseEventProperties {
  method?: 'email' | 'google' | 'github';
  plan?: string;
  referrer?: string;
}

export interface SearchEventProperties extends BaseEventProperties {
  search_id?: string;
  source?: 'google_maps' | 'manual';
  keywords?: string;
  location?: string;
  radius?: number;
  research_tier?: 'tavily' | 'perplexity';
  total_leads?: number;
  enriched_count?: number;
  duration_seconds?: number;
  stage?: 'discovery' | 'enrichment' | 'analysis';
}

export interface ExportEventProperties extends BaseEventProperties {
  format?: 'csv';
  lead_count?: number;
  has_emails?: number;
  file_size_kb?: number;
}

export interface CreditEventProperties extends BaseEventProperties {
  amount?: number;
  price?: number;
  payment_method?: string;
  new_balance?: number;
  from_plan?: string;
  to_plan?: string;
  billing_cycle?: 'monthly' | 'annual';
}

export interface OnboardingEventProperties extends BaseEventProperties {
  step?: string;
  step_number?: number;
  time_spent_seconds?: number;
  steps_completed?: number;
  at_step?: string;
}

export interface DashboardEventProperties extends BaseEventProperties {
  tab?: string;
  from_tab?: string;
  plan?: string;
  credits?: number;
  active_searches?: number;
  setting_type?: string;
  changed_fields?: string[];
}

export interface ErrorEventProperties extends BaseEventProperties {
  operation?: string;
  error_type?: string;
  error_message?: string;
  error_code?: string;
  context?: Record<string, unknown>;
}

export interface PerformanceEventProperties extends BaseEventProperties {
  search_id?: string;
  duration_ms?: number;
  lead_count?: number;
  leads_per_second?: number;
  research_tier?: string;
}

/**
 * Custom hook for centralized analytics tracking
 */
export const useAnalytics = () => {
  const posthog = usePostHog();

  /**
   * Generic event capture with error handling
   */
  const captureEvent = useCallback(
    (eventName: string, properties?: BaseEventProperties) => {
      try {
        if (posthog) {
          posthog.capture(eventName, properties);

          if (import.meta.env.MODE === 'development') {
            console.log('📊 PostHog Event:', eventName, properties);
          }
        }
      } catch (error) {
        console.error('Failed to capture analytics event:', error);
        // Don't throw - analytics failures shouldn't break the app
      }
    },
    [posthog]
  );

  /**
   * Identify user with properties
   *
   * @param userId - Unique user identifier
   * @param setProperties - Properties to set/update on every identify call (e.g., email, plan)
   * @param setOnceProperties - Properties to set only once, never overwritten (e.g., first_seen, signup_method)
   *
   * Per PostHog docs: https://posthog.com/docs/product-analytics/identify
   * - $set properties are updated on every identify call
   * - $set_once properties are only set if they don't already exist
   */
  const identifyUser = useCallback(
    (
      userId: string,
      setProperties: Record<string, unknown>,
      setOnceProperties?: Record<string, unknown>
    ) => {
      try {
        if (posthog) {
          posthog.identify(userId, setProperties, setOnceProperties);

          if (import.meta.env.MODE === 'development') {
            console.log('👤 PostHog Identify:', userId, {
              $set: setProperties,
              $set_once: setOnceProperties,
            });
          }
        }
      } catch (error) {
        console.error('Failed to identify user:', error);
      }
    },
    [posthog]
  );

  /**
   * Reset user identity (on logout)
   */
  const resetUser = useCallback(() => {
    try {
      if (posthog) {
        posthog.reset();

        if (import.meta.env.MODE === 'development') {
          console.log('🔄 PostHog Reset');
        }
      }
    } catch (error) {
      console.error('Failed to reset user:', error);
    }
  }, [posthog]);

  // Authentication Events
  const trackUserSignUp = useCallback(
    (properties: AuthEventProperties = {}) => {
      captureEvent('user_signed_up', properties);
    },
    [captureEvent]
  );

  const trackUserSignIn = useCallback(
    (properties: AuthEventProperties = {}) => {
      captureEvent('user_signed_in', properties);
    },
    [captureEvent]
  );

  const trackUserSignOut = useCallback(() => {
    captureEvent('user_signed_out');
  }, [captureEvent]);

  // Search Pipeline Events
  const trackSearchCreated = useCallback(
    (properties: SearchEventProperties) => {
      captureEvent('search_created', properties);
    },
    [captureEvent]
  );

  const trackSearchCompleted = useCallback(
    (properties: SearchEventProperties) => {
      captureEvent('search_completed', properties);
    },
    [captureEvent]
  );

  const trackSearchCancelled = useCallback(
    (properties: SearchEventProperties) => {
      captureEvent('search_cancelled', properties);
    },
    [captureEvent]
  );

  const trackSearchFailed = useCallback(
    (properties: SearchEventProperties) => {
      captureEvent('search_failed', properties);
    },
    [captureEvent]
  );

  const trackPipelineStageCompleted = useCallback(
    (properties: SearchEventProperties) => {
      captureEvent('pipeline_stage_completed', properties);
    },
    [captureEvent]
  );

  // Export Events
  const trackExportInitiated = useCallback(
    (properties: ExportEventProperties) => {
      captureEvent('export_initiated', properties);
    },
    [captureEvent]
  );

  const trackExportCompleted = useCallback(
    (properties: ExportEventProperties) => {
      captureEvent('export_completed', properties);
    },
    [captureEvent]
  );

  const trackExportFailed = useCallback(
    (properties: ExportEventProperties) => {
      captureEvent('export_failed', properties);
    },
    [captureEvent]
  );

  // Credit & Billing Events
  const trackCreditPurchaseInitiated = useCallback(
    (properties: CreditEventProperties) => {
      captureEvent('credit_purchase_initiated', properties);
    },
    [captureEvent]
  );

  const trackCreditPurchaseCompleted = useCallback(
    (properties: CreditEventProperties) => {
      captureEvent('credit_purchase_completed', properties);
    },
    [captureEvent]
  );

  const trackCreditPurchaseFailed = useCallback(
    (properties: CreditEventProperties) => {
      captureEvent('credit_purchase_failed', properties);
    },
    [captureEvent]
  );

  const trackSubscriptionUpgraded = useCallback(
    (properties: CreditEventProperties) => {
      captureEvent('subscription_upgraded', properties);
    },
    [captureEvent]
  );

  const trackSubscriptionDowngraded = useCallback(
    (properties: CreditEventProperties) => {
      captureEvent('subscription_downgraded', properties);
    },
    [captureEvent]
  );

  const trackCreditsDepletedWarning = useCallback(
    (properties: CreditEventProperties) => {
      captureEvent('credits_depleted_warning', properties);
    },
    [captureEvent]
  );

  // Onboarding Events
  const trackOnboardingStarted = useCallback(
    (properties: OnboardingEventProperties = {}) => {
      captureEvent('onboarding_started', properties);
    },
    [captureEvent]
  );

  const trackOnboardingStepCompleted = useCallback(
    (properties: OnboardingEventProperties) => {
      captureEvent('onboarding_step_completed', properties);
    },
    [captureEvent]
  );

  const trackOnboardingCompleted = useCallback(
    (properties: OnboardingEventProperties) => {
      captureEvent('onboarding_completed', properties);
    },
    [captureEvent]
  );

  const trackOnboardingSkipped = useCallback(
    (properties: OnboardingEventProperties) => {
      captureEvent('onboarding_skipped', properties);
    },
    [captureEvent]
  );

  // Dashboard & Navigation Events
  const trackDashboardViewed = useCallback(
    (properties: DashboardEventProperties) => {
      captureEvent('dashboard_viewed', properties);
    },
    [captureEvent]
  );

  const trackDashboardTabViewed = useCallback(
    (properties: DashboardEventProperties) => {
      captureEvent('dashboard_tab_viewed', properties);
    },
    [captureEvent]
  );

  const trackHelpWidgetOpened = useCallback(
    (properties: BaseEventProperties = {}) => {
      captureEvent('help_widget_opened', properties);
    },
    [captureEvent]
  );

  const trackSettingsUpdated = useCallback(
    (properties: DashboardEventProperties) => {
      captureEvent('settings_updated', properties);
    },
    [captureEvent]
  );

  // Error Events
  const trackOperationFailed = useCallback(
    (properties: ErrorEventProperties) => {
      captureEvent('operation_failed', properties);
    },
    [captureEvent]
  );

  // Performance Events
  const trackSearchPerformance = useCallback(
    (properties: PerformanceEventProperties) => {
      captureEvent('search_performance', properties);
    },
    [captureEvent]
  );

  return {
    // Core methods
    captureEvent,
    identifyUser,
    resetUser,

    // Authentication
    trackUserSignUp,
    trackUserSignIn,
    trackUserSignOut,

    // Search Pipeline
    trackSearchCreated,
    trackSearchCompleted,
    trackSearchCancelled,
    trackSearchFailed,
    trackPipelineStageCompleted,

    // Export
    trackExportInitiated,
    trackExportCompleted,
    trackExportFailed,

    // Credits & Billing
    trackCreditPurchaseInitiated,
    trackCreditPurchaseCompleted,
    trackCreditPurchaseFailed,
    trackSubscriptionUpgraded,
    trackSubscriptionDowngraded,
    trackCreditsDepletedWarning,

    // Onboarding
    trackOnboardingStarted,
    trackOnboardingStepCompleted,
    trackOnboardingCompleted,
    trackOnboardingSkipped,

    // Dashboard & Navigation
    trackDashboardViewed,
    trackDashboardTabViewed,
    trackHelpWidgetOpened,
    trackSettingsUpdated,

    // Error & Performance
    trackOperationFailed,
    trackSearchPerformance,
  };
};

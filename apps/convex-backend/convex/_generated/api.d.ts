/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin_billing from "../admin/billing.js";
import type * as admin_mutations from "../admin/mutations.js";
import type * as admin_queries from "../admin/queries.js";
import type * as admin_systemControl from "../admin/systemControl.js";
import type * as apiKeys from "../apiKeys.js";
import type * as auth from "../auth.js";
import type * as billing_fastspring from "../billing/fastspring.js";
import type * as billing_mutations from "../billing/mutations.js";
import type * as billing_queries from "../billing/queries.js";
import type * as billing_stripe_client from "../billing/stripe/client.js";
import type * as billing_stripe_internal from "../billing/stripe/internal.js";
import type * as billing_stripe_subscriptions from "../billing/stripe/subscriptions.js";
import type * as billing_stripe_webhooks from "../billing/stripe/webhooks.js";
import type * as billing_webhooks from "../billing/webhooks.js";
import type * as credits_transactions from "../credits/transactions.js";
import type * as crewai_queries from "../crewai/queries.js";
import type * as crons from "../crons.js";
import type * as http from "../http.js";
import type * as instantly_actions from "../instantly/actions.js";
import type * as instantly_internal from "../instantly/internal.js";
import type * as instantly_mutations from "../instantly/mutations.js";
import type * as instantly_queries from "../instantly/queries.js";
import type * as langgraph_actions from "../langgraph/actions.js";
import type * as langgraph_health from "../langgraph/health.js";
import type * as langgraph_internal from "../langgraph/internal.js";
import type * as langgraph_mutations from "../langgraph/mutations.js";
import type * as langgraph_queries from "../langgraph/queries.js";
import type * as langgraph_webhooks from "../langgraph/webhooks.js";
import type * as leads_actions from "../leads/actions.js";
import type * as leads_asyncAnalysis from "../leads/asyncAnalysis.js";
import type * as leads_asyncEnrichment from "../leads/asyncEnrichment.js";
import type * as leads_enrichment_findymail from "../leads/enrichment/findymail.js";
import type * as leads_enrichment_provider from "../leads/enrichment/provider.js";
import type * as leads_enrichment_rateLimitMutations from "../leads/enrichment/rateLimitMutations.js";
import type * as leads_enrichment_types from "../leads/enrichment/types.js";
import type * as leads_internal from "../leads/internal.js";
import type * as leads_monitoring from "../leads/monitoring.js";
import type * as leads_mutations from "../leads/mutations.js";
import type * as leads_queries from "../leads/queries.js";
import type * as lib_analytics from "../lib/analytics.js";
import type * as lib_apiErrors from "../lib/apiErrors.js";
import type * as lib_auditLog from "../lib/auditLog.js";
import type * as lib_config from "../lib/config.js";
import type * as lib_constants from "../lib/constants.js";
import type * as lib_correlation from "../lib/correlation.js";
import type * as lib_creditHelpers from "../lib/creditHelpers.js";
import type * as lib_creditLogic from "../lib/creditLogic.js";
import type * as lib_cryptoHelpers from "../lib/cryptoHelpers.js";
import type * as lib_deduplication from "../lib/deduplication.js";
import type * as lib_env_validation from "../lib/env_validation.js";
import type * as lib_errorHandling from "../lib/errorHandling.js";
import type * as lib_errorMessages from "../lib/errorMessages.js";
import type * as lib_helpers from "../lib/helpers.js";
import type * as lib_logger from "../lib/logger.js";
import type * as lib_logging from "../lib/logging.js";
import type * as lib_profileLogic from "../lib/profileLogic.js";
import type * as lib_rateLimiter from "../lib/rateLimiter.js";
import type * as lib_sanitization from "../lib/sanitization.js";
import type * as lib_searchLogic from "../lib/searchLogic.js";
import type * as lib_validators from "../lib/validators.js";
import type * as middleware_subscriptionMiddleware from "../middleware/subscriptionMiddleware.js";
import type * as notifications_actions from "../notifications/actions.js";
import type * as notifications_internal from "../notifications/internal.js";
import type * as notifications_mutations from "../notifications/mutations.js";
import type * as notifications_queries from "../notifications/queries.js";
import type * as places_actions from "../places/actions.js";
import type * as places_leads from "../places/leads.js";
import type * as places_suppressions from "../places/suppressions.js";
import type * as profile_internal from "../profile/internal.js";
import type * as profile_mutations from "../profile/mutations.js";
import type * as profile_queries from "../profile/queries.js";
import type * as profile_validators from "../profile/validators.js";
import type * as realtime_broadcaster from "../realtime/broadcaster.js";
import type * as realtime_mutations from "../realtime/mutations.js";
import type * as realtime_queries from "../realtime/queries.js";
import type * as search_actions from "../search/actions.js";
import type * as search_googlePlaces from "../search/googlePlaces.js";
import type * as search_internal from "../search/internal.js";
import type * as search_monitoring from "../search/monitoring.js";
import type * as search_mutations from "../search/mutations.js";
import type * as search_queries from "../search/queries.js";
import type * as search_utils from "../search/utils.js";
import type * as usageTracking_mutations from "../usageTracking/mutations.js";
import type * as usageTracking_queries from "../usageTracking/queries.js";
import type * as userApiKeys_actions from "../userApiKeys/actions.js";
import type * as userApiKeys_internal from "../userApiKeys/internal.js";
import type * as userApiKeys_mutations from "../userApiKeys/mutations.js";
import type * as userApiKeys_queries from "../userApiKeys/queries.js";
import type * as users_actions from "../users/actions.js";
import type * as users_admin from "../users/admin.js";
import type * as users_internal from "../users/internal.js";
import type * as users_mutations from "../users/mutations.js";
import type * as users_queries from "../users/queries.js";
import type * as utils_async from "../utils/async.js";
import type * as utils_domains from "../utils/domains.js";
import type * as utils_http from "../utils/http.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

/**
 * A utility for referencing Convex functions in your app's API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
declare const fullApi: ApiFromModules<{
  "admin/billing": typeof admin_billing;
  "admin/mutations": typeof admin_mutations;
  "admin/queries": typeof admin_queries;
  "admin/systemControl": typeof admin_systemControl;
  apiKeys: typeof apiKeys;
  auth: typeof auth;
  "billing/fastspring": typeof billing_fastspring;
  "billing/mutations": typeof billing_mutations;
  "billing/queries": typeof billing_queries;
  "billing/stripe/client": typeof billing_stripe_client;
  "billing/stripe/internal": typeof billing_stripe_internal;
  "billing/stripe/subscriptions": typeof billing_stripe_subscriptions;
  "billing/stripe/webhooks": typeof billing_stripe_webhooks;
  "billing/webhooks": typeof billing_webhooks;
  "credits/transactions": typeof credits_transactions;
  "crewai/queries": typeof crewai_queries;
  crons: typeof crons;
  http: typeof http;
  "instantly/actions": typeof instantly_actions;
  "instantly/internal": typeof instantly_internal;
  "instantly/mutations": typeof instantly_mutations;
  "instantly/queries": typeof instantly_queries;
  "langgraph/actions": typeof langgraph_actions;
  "langgraph/health": typeof langgraph_health;
  "langgraph/internal": typeof langgraph_internal;
  "langgraph/mutations": typeof langgraph_mutations;
  "langgraph/queries": typeof langgraph_queries;
  "langgraph/webhooks": typeof langgraph_webhooks;
  "leads/actions": typeof leads_actions;
  "leads/asyncAnalysis": typeof leads_asyncAnalysis;
  "leads/asyncEnrichment": typeof leads_asyncEnrichment;
  "leads/enrichment/findymail": typeof leads_enrichment_findymail;
  "leads/enrichment/provider": typeof leads_enrichment_provider;
  "leads/enrichment/rateLimitMutations": typeof leads_enrichment_rateLimitMutations;
  "leads/enrichment/types": typeof leads_enrichment_types;
  "leads/internal": typeof leads_internal;
  "leads/monitoring": typeof leads_monitoring;
  "leads/mutations": typeof leads_mutations;
  "leads/queries": typeof leads_queries;
  "lib/analytics": typeof lib_analytics;
  "lib/apiErrors": typeof lib_apiErrors;
  "lib/auditLog": typeof lib_auditLog;
  "lib/config": typeof lib_config;
  "lib/constants": typeof lib_constants;
  "lib/correlation": typeof lib_correlation;
  "lib/creditHelpers": typeof lib_creditHelpers;
  "lib/creditLogic": typeof lib_creditLogic;
  "lib/cryptoHelpers": typeof lib_cryptoHelpers;
  "lib/deduplication": typeof lib_deduplication;
  "lib/env_validation": typeof lib_env_validation;
  "lib/errorHandling": typeof lib_errorHandling;
  "lib/errorMessages": typeof lib_errorMessages;
  "lib/helpers": typeof lib_helpers;
  "lib/logger": typeof lib_logger;
  "lib/logging": typeof lib_logging;
  "lib/profileLogic": typeof lib_profileLogic;
  "lib/rateLimiter": typeof lib_rateLimiter;
  "lib/sanitization": typeof lib_sanitization;
  "lib/searchLogic": typeof lib_searchLogic;
  "lib/validators": typeof lib_validators;
  "middleware/subscriptionMiddleware": typeof middleware_subscriptionMiddleware;
  "notifications/actions": typeof notifications_actions;
  "notifications/internal": typeof notifications_internal;
  "notifications/mutations": typeof notifications_mutations;
  "notifications/queries": typeof notifications_queries;
  "places/actions": typeof places_actions;
  "places/leads": typeof places_leads;
  "places/suppressions": typeof places_suppressions;
  "profile/internal": typeof profile_internal;
  "profile/mutations": typeof profile_mutations;
  "profile/queries": typeof profile_queries;
  "profile/validators": typeof profile_validators;
  "realtime/broadcaster": typeof realtime_broadcaster;
  "realtime/mutations": typeof realtime_mutations;
  "realtime/queries": typeof realtime_queries;
  "search/actions": typeof search_actions;
  "search/googlePlaces": typeof search_googlePlaces;
  "search/internal": typeof search_internal;
  "search/monitoring": typeof search_monitoring;
  "search/mutations": typeof search_mutations;
  "search/queries": typeof search_queries;
  "search/utils": typeof search_utils;
  "usageTracking/mutations": typeof usageTracking_mutations;
  "usageTracking/queries": typeof usageTracking_queries;
  "userApiKeys/actions": typeof userApiKeys_actions;
  "userApiKeys/internal": typeof userApiKeys_internal;
  "userApiKeys/mutations": typeof userApiKeys_mutations;
  "userApiKeys/queries": typeof userApiKeys_queries;
  "users/actions": typeof users_actions;
  "users/admin": typeof users_admin;
  "users/internal": typeof users_internal;
  "users/mutations": typeof users_mutations;
  "users/queries": typeof users_queries;
  "utils/async": typeof utils_async;
  "utils/domains": typeof utils_domains;
  "utils/http": typeof utils_http;
}>;
declare const fullApiWithMounts: typeof fullApi;

export declare const api: FilterApi<
  typeof fullApiWithMounts,
  FunctionReference<any, "public">
>;
export declare const internal: FilterApi<
  typeof fullApiWithMounts,
  FunctionReference<any, "internal">
>;

export declare const components: {
  workpool: {
    lib: {
      cancel: FunctionReference<
        "mutation",
        "internal",
        {
          id: string;
          logLevel: "DEBUG" | "TRACE" | "INFO" | "REPORT" | "WARN" | "ERROR";
        },
        any
      >;
      cancelAll: FunctionReference<
        "mutation",
        "internal",
        {
          before?: number;
          limit?: number;
          logLevel: "DEBUG" | "TRACE" | "INFO" | "REPORT" | "WARN" | "ERROR";
        },
        any
      >;
      enqueue: FunctionReference<
        "mutation",
        "internal",
        {
          config: {
            logLevel: "DEBUG" | "TRACE" | "INFO" | "REPORT" | "WARN" | "ERROR";
            maxParallelism: number;
          };
          fnArgs: any;
          fnHandle: string;
          fnName: string;
          fnType: "action" | "mutation" | "query";
          onComplete?: { context?: any; fnHandle: string };
          retryBehavior?: {
            base: number;
            initialBackoffMs: number;
            maxAttempts: number;
          };
          runAt: number;
        },
        string
      >;
      enqueueBatch: FunctionReference<
        "mutation",
        "internal",
        {
          config: {
            logLevel: "DEBUG" | "TRACE" | "INFO" | "REPORT" | "WARN" | "ERROR";
            maxParallelism: number;
          };
          items: Array<{
            fnArgs: any;
            fnHandle: string;
            fnName: string;
            fnType: "action" | "mutation" | "query";
            onComplete?: { context?: any; fnHandle: string };
            retryBehavior?: {
              base: number;
              initialBackoffMs: number;
              maxAttempts: number;
            };
            runAt: number;
          }>;
        },
        Array<string>
      >;
      status: FunctionReference<
        "query",
        "internal",
        { id: string },
        | { previousAttempts: number; state: "pending" }
        | { previousAttempts: number; state: "running" }
        | { state: "finished" }
      >;
      statusBatch: FunctionReference<
        "query",
        "internal",
        { ids: Array<string> },
        Array<
          | { previousAttempts: number; state: "pending" }
          | { previousAttempts: number; state: "running" }
          | { state: "finished" }
        >
      >;
    };
  };
  rateLimiter: {
    lib: {
      checkRateLimit: FunctionReference<
        "query",
        "internal",
        {
          config:
            | {
                capacity?: number;
                kind: "token bucket";
                maxReserved?: number;
                period: number;
                rate: number;
                shards?: number;
                start?: null;
              }
            | {
                capacity?: number;
                kind: "fixed window";
                maxReserved?: number;
                period: number;
                rate: number;
                shards?: number;
                start?: number;
              };
          count?: number;
          key?: string;
          name: string;
          reserve?: boolean;
          throws?: boolean;
        },
        { ok: true; retryAfter?: number } | { ok: false; retryAfter: number }
      >;
      clearAll: FunctionReference<
        "mutation",
        "internal",
        { before?: number },
        null
      >;
      getServerTime: FunctionReference<"mutation", "internal", {}, number>;
      getValue: FunctionReference<
        "query",
        "internal",
        {
          config:
            | {
                capacity?: number;
                kind: "token bucket";
                maxReserved?: number;
                period: number;
                rate: number;
                shards?: number;
                start?: null;
              }
            | {
                capacity?: number;
                kind: "fixed window";
                maxReserved?: number;
                period: number;
                rate: number;
                shards?: number;
                start?: number;
              };
          key?: string;
          name: string;
          sampleShards?: number;
        },
        {
          config:
            | {
                capacity?: number;
                kind: "token bucket";
                maxReserved?: number;
                period: number;
                rate: number;
                shards?: number;
                start?: null;
              }
            | {
                capacity?: number;
                kind: "fixed window";
                maxReserved?: number;
                period: number;
                rate: number;
                shards?: number;
                start?: number;
              };
          shard: number;
          ts: number;
          value: number;
        }
      >;
      rateLimit: FunctionReference<
        "mutation",
        "internal",
        {
          config:
            | {
                capacity?: number;
                kind: "token bucket";
                maxReserved?: number;
                period: number;
                rate: number;
                shards?: number;
                start?: null;
              }
            | {
                capacity?: number;
                kind: "fixed window";
                maxReserved?: number;
                period: number;
                rate: number;
                shards?: number;
                start?: number;
              };
          count?: number;
          key?: string;
          name: string;
          reserve?: boolean;
          throws?: boolean;
        },
        { ok: true; retryAfter?: number } | { ok: false; retryAfter: number }
      >;
      resetRateLimit: FunctionReference<
        "mutation",
        "internal",
        { key?: string; name: string },
        null
      >;
    };
    time: {
      getServerTime: FunctionReference<"mutation", "internal", {}, number>;
    };
  };
};

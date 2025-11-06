import { useAuth as useClerkAuth, useUser } from "@clerk/clerk-react";
import { useQuery } from "convex/react";
import { api } from "@genni/convex-types";
import { useEffect, useRef, useState } from "react";
import { createLogger } from "@/utils/logger";

const logger = createLogger("useAuth");

// Maximum time to wait for webhook to create user (10 seconds)
const WEBHOOK_TIMEOUT_MS = 10000;

export function useAuth() {
  const { isLoaded, isSignedIn } = useClerkAuth();
  const { user: clerkUser } = useUser();
  const [webhookTimedOut, setWebhookTimedOut] = useState(false);
  const webhookTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Get current user data from our Convex backend
  // IMPORTANT: Only query when Clerk is fully loaded AND user is signed in
  // This prevents race conditions during auth state transitions
  const user = useQuery(
    api.users.queries.getCurrentUserData,
    isLoaded && isSignedIn ? {} : "skip",
  );

  // Handle webhook delay: when user signs in but Convex user doesn't exist yet
  useEffect(() => {
    // Clear any existing timeout
    if (webhookTimeoutRef.current) {
      clearTimeout(webhookTimeoutRef.current);
      webhookTimeoutRef.current = null;
    }

    // Reset timeout state when auth state changes
    setWebhookTimedOut(false);

    // If signed in with Clerk but no Convex user yet, start timeout
    if (isLoaded && isSignedIn && user === null && !webhookTimedOut) {
      logger.warn("Waiting for Clerk webhook to create user in Convex", {
        clerkUserId: clerkUser?.id,
        userEmail: clerkUser?.emailAddresses?.[0]?.emailAddress,
      });

      webhookTimeoutRef.current = setTimeout(() => {
        logger.error("Webhook timeout: User not created in Convex after 10 seconds", {
          clerkUserId: clerkUser?.id,
          userEmail: clerkUser?.emailAddresses?.[0]?.emailAddress,
        });
        setWebhookTimedOut(true);
      }, WEBHOOK_TIMEOUT_MS);
    }

    // Cleanup timeout on unmount
    return () => {
      if (webhookTimeoutRef.current) {
        clearTimeout(webhookTimeoutRef.current);
      }
    };
  }, [isLoaded, isSignedIn, user, clerkUser, webhookTimedOut]);

  useEffect(() => {
    logger.debug("Auth state changed", {
      isLoading: !isLoaded,
      isAuthenticated: isSignedIn,
      hasClerkUser: !!clerkUser,
      hasConvexUser: !!user,
      waitingForWebhook: isSignedIn && user === null && !webhookTimedOut,
      webhookTimedOut,
      clerkUserId: clerkUser?.id,
      userEmail: clerkUser?.emailAddresses?.[0]?.emailAddress,
    });
  }, [isLoaded, isSignedIn, clerkUser, user, webhookTimedOut]);

  // Determine loading state:
  // 1. Clerk not loaded yet
  // 2. Signed in but query still loading (undefined)
  // 3. Signed in but webhook hasn't created user yet (null) - WAIT for webhook
  const isWaitingForWebhook = isLoaded && isSignedIn && user === null && !webhookTimedOut;
  const isLoadingQuery = isSignedIn && user === undefined;

  return {
    isLoading: !isLoaded || isLoadingQuery || isWaitingForWebhook,
    isAuthenticated: isLoaded ? (isSignedIn ?? false) : false,
    user: user || null,
    clerkUser: clerkUser || null,
    webhookTimedOut, // Expose timeout state for error handling
    isWaitingForWebhook, // Expose webhook wait state
    // Note: Clerk handles sign in/out through its components
    // These functions are deprecated and should not be used
    signIn: () => {
      throw new Error(
        "signIn is deprecated - use Clerk SignIn component instead",
      );
    },
    signOut: () => {
      throw new Error(
        "signOut is deprecated - use Clerk SignOut component instead",
      );
    },
  };
}

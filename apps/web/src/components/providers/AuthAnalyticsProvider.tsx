/**
 * AuthAnalyticsProvider
 *
 * Tracks authentication events with PostHog analytics.
 * Wraps the app to detect auth state changes from Clerk.
 */

import { useEffect, useRef, ReactNode } from "react";
import { useAuth as useClerkAuth, useUser } from "@clerk/clerk-react";
import { usePostHog } from "posthog-js/react";
import { createLogger } from "@/utils/logger";

const logger = createLogger("AuthAnalytics");

interface AuthAnalyticsProviderProps {
  children: ReactNode;
}

export function AuthAnalyticsProvider({ children }: AuthAnalyticsProviderProps) {
  const { isLoaded, isSignedIn } = useClerkAuth();
  const { user: clerkUser, isLoaded: userLoaded } = useUser();
  const posthog = usePostHog();

  // Track previous auth state to detect changes
  const prevAuthState = useRef<{
    isSignedIn: boolean | undefined;
    userId: string | undefined;
  }>({
    isSignedIn: undefined,
    userId: undefined,
  });

  // Track whether we've already identified the user this session
  const hasIdentified = useRef(false);

  useEffect(() => {
    if (!isLoaded || !userLoaded || !posthog) return;

    const prevState = prevAuthState.current;
    const currentUserId = clerkUser?.id;

    // Detect sign in: was not signed in, now is signed in
    if (!prevState.isSignedIn && isSignedIn && clerkUser) {
      logger.info("User signed in", { userId: currentUserId });

      const email = clerkUser.emailAddresses?.[0]?.emailAddress;
      const firstName = clerkUser.firstName;
      const lastName = clerkUser.lastName;

      // Identify user with PostHog
      if (!hasIdentified.current) {

        posthog.identify(
          currentUserId,
          // $set properties (updated on every identify call)
          {
            email,
            name: [firstName, lastName].filter(Boolean).join(" ") || undefined,
            firstName,
            lastName,
            createdAt: clerkUser.createdAt?.toISOString(),
          },
          // $set_once properties (only set on first identify)
          {
            first_seen: new Date().toISOString(),
            signup_method: clerkUser.externalAccounts?.[0]?.provider || "email",
          }
        );

        hasIdentified.current = true;
        logger.debug("PostHog user identified", { userId: currentUserId, email });
      }

      // Track sign in event
      // Determine if this is a new user (signed up) or returning user (signed in)
      const isNewUser = clerkUser.createdAt &&
        (Date.now() - clerkUser.createdAt.getTime()) < 60000; // Created within last minute

      if (isNewUser) {
        posthog.capture("user_signed_up", {
          method: clerkUser.externalAccounts?.[0]?.provider || "email",
          has_first_name: Boolean(firstName),
          has_last_name: Boolean(lastName),
          email_verified: clerkUser.emailAddresses?.[0]?.verification?.status === "verified",
        });
        logger.info("Tracked user_signed_up event");
      } else {
        posthog.capture("user_signed_in", {
          method: clerkUser.externalAccounts?.[0]?.provider || "email",
          returning: true,
        });
        logger.info("Tracked user_signed_in event");
      }
    }

    // Detect sign out: was signed in, now is not
    if (prevState.isSignedIn && !isSignedIn) {
      logger.info("User signed out", { previousUserId: prevState.userId });

      // Track sign out event before resetting
      posthog.capture("user_signed_out", {
        session_duration_estimate: "unknown", // PostHog calculates this automatically
      });

      // Reset PostHog user identity
      posthog.reset();
      hasIdentified.current = false;

      logger.info("Tracked user_signed_out event and reset PostHog identity");
    }

    // Update previous state
    prevAuthState.current = {
      isSignedIn,
      userId: currentUserId,
    };
  }, [isLoaded, userLoaded, isSignedIn, clerkUser, posthog]);

  return <>{children}</>;
}

export default AuthAnalyticsProvider;

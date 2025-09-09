import { useAuth as useClerkAuth, useUser } from "@clerk/clerk-react";
import { useQuery } from "convex/react";
import { api } from "@genni/convex-types"
import { useEffect } from "react";
import { createLogger } from "@/utils/logger";

const logger = createLogger('useAuth');

export function useAuth() {
  const { isLoaded, isSignedIn } = useClerkAuth();
  const { user: clerkUser } = useUser();

  // Get current user data from our Convex backend
  const user = useQuery(api.users.queries.getCurrentUserData, isSignedIn ? {} : "skip");

  useEffect(() => {
    logger.debug('Auth state changed', {
      isLoading: !isLoaded,
      isAuthenticated: isSignedIn,
      hasClerkUser: !!clerkUser,
      hasConvexUser: !!user,
      clerkUserId: clerkUser?.id,
      userEmail: clerkUser?.emailAddresses?.[0]?.emailAddress
    });
  }, [isLoaded, isSignedIn, clerkUser, user]);

  return {
    isLoading: !isLoaded,
    isAuthenticated: isLoaded ? (isSignedIn ?? false) : false, // Handle undefined state properly
    user: user || null,
    clerkUser: clerkUser || null,
    // Note: Clerk handles sign in/out through its components
    // These functions are deprecated and should not be used
    signIn: () => {
      throw new Error('signIn is deprecated - use Clerk SignIn component instead');
    },
    signOut: () => {
      throw new Error('signOut is deprecated - use Clerk SignOut component instead');
    },
  };
}
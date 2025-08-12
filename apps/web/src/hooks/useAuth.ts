import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth } from "convex/react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api"
import { useEffect } from "react";
import { createLogger } from "@/utils/logger";

const logger = createLogger('useAuth');

export function useAuth() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const { signIn: convexSignIn, signOut: convexSignOut } = useAuthActions();

  // Get current user data
  const user = useQuery(api.users.queries.getCurrentUser, isAuthenticated ? {} : "skip");

  useEffect(() => {
    logger.debug('Auth state changed', {
      isLoading,
      isAuthenticated,
      hasUser: !!user,
      userId: user?._id,
      userEmail: user?.email
    });
  }, [isLoading, isAuthenticated, user]);

  const signIn = async (...args: Parameters<typeof convexSignIn>) => {
    logger.info('Sign in initiated', { provider: args[0] });
    try {
      const result = await convexSignIn(...args);
      logger.info('Sign in successful');
      return result;
    } catch (error) {
      logger.error('Sign in failed', { error: error instanceof Error ? error.message : 'Unknown error' });
      throw error;
    }
  };

  const signOut = async () => {
    logger.info('Sign out initiated', { userId: user?._id, userEmail: user?.email });
    try {
      await convexSignOut();
      logger.info('Sign out successful');
    } catch (error) {
      logger.error('Sign out failed', { error: error instanceof Error ? error.message : 'Unknown error' });
      throw error;
    }
  };

  return {
    isLoading,
    isAuthenticated,
    user,
    signIn,
    signOut,
  };
}
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth } from "convex/react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api"

export function useAuth() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const { signIn, signOut } = useAuthActions();

  // Get current user data
  const user = useQuery(api.users.queries.getCurrentUser, isAuthenticated ? {} : "skip");

  return {
    isLoading,
    isAuthenticated,
    user,
    signIn,
    signOut,
  };
}
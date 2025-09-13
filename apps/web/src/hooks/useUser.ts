import { useQuery, useMutation } from "convex/react";
import { api } from "@genni/convex-types";
import type { Id } from "@genni/convex-types/dataModel";

export function useUser() {
  // OPTIMIZATION: This query is called frequently but user data rarely changes
  const user = useQuery(api.users.queries.getCurrentUserData);
  const updateUser = useMutation(api.users.mutations.updateProfile);
  const deleteUser = useMutation(api.users.mutations.deleteAccount);

  return {
    user,
    updateUser,
    deleteUser,
    isLoading: user === undefined,
  };
}

export function useUserCredits() {
  const credits = useQuery(api.users.queries.getUserCredits);
  const addCredits = useMutation(api.users.mutations.addCredits);

  return {
    credits,
    addCredits,
    isLoading: credits === undefined,
  };
}

export function useUsers() {
  const users = useQuery(api.users.queries.listUsers);

  return {
    users,
    isLoading: users === undefined,
  };
}

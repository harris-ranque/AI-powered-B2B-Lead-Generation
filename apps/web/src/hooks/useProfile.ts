import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api"

export function useProfile() {
  const profile = useQuery(api.profile.queries.getBusinessProfile);
  const createOrUpdateProfile = useMutation(api.profile.mutations.createOrUpdateProfile);
  const updateProfileSection = useMutation(api.profile.mutations.updateProfileSection);
  const deleteProfile = useMutation(api.profile.mutations.deleteProfile);
  const importProfile = useMutation(api.profile.mutations.importProfile);
  
  return {
    profile,
    createOrUpdateProfile,
    updateProfileSection,
    deleteProfile,
    importProfile,
    isLoading: profile === undefined,
    hasProfile: profile !== null,
    isComplete: profile?.isComplete ?? false,
  };
}
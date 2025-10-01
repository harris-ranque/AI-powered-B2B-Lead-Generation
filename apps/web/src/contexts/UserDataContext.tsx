import { createContext, useContext, useMemo, type ReactNode } from "react";
import {
  useSearchesBase,
  type UseSearchesResult,
} from "@/hooks/base/useSearchesBase";
import {
  useUserLeadsBase,
  type UseUserLeadsResult,
} from "@/hooks/base/useLeadsBase";
import {
  useStatusBroadcastsBase,
  type UseStatusBroadcastsResult,
} from "@/hooks/base/useStatusBroadcastsBase";

export interface UserDataContextValue {
  searches: UseSearchesResult;
  userLeads: UseUserLeadsResult;
  statusBroadcasts: UseStatusBroadcastsResult;
}

const UserDataContext = createContext<UserDataContextValue | null>(null);

interface UserDataProviderProps {
  children: ReactNode;
  value?: UserDataContextValue;
}

function UserDataProviderWithFetch({ children }: { children: ReactNode }) {
  const searches = useSearchesBase();
  const userLeads = useUserLeadsBase();
  const statusBroadcasts = useStatusBroadcastsBase();

  const value = useMemo(
    () => ({ searches, userLeads, statusBroadcasts }),
    [searches, userLeads, statusBroadcasts],
  );

  return (
    <UserDataContext.Provider value={value}>{children}</UserDataContext.Provider>
  );
}

export function UserDataProvider({ children, value }: UserDataProviderProps) {
  if (value) {
    return (
      <UserDataContext.Provider value={value}>{children}</UserDataContext.Provider>
    );
  }

  return <UserDataProviderWithFetch>{children}</UserDataProviderWithFetch>;
}

export function useUserData() {
  const context = useContext(UserDataContext);
  if (!context) {
    throw new Error("useUserData must be used within a UserDataProvider");
  }
  return context;
}

export function useUserDataMaybe() {
  return useContext(UserDataContext);
}

export { UserDataContext };

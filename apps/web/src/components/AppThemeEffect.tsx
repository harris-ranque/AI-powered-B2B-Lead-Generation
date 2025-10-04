import { useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { ensureAppliedAppTheme, getStoredAppTheme } from "@/lib/appTheme";

export function AppThemeEffect() {
  const { user } = useAuth();

  useEffect(() => {
    const preferredTheme = user?.preferences?.theme ?? getStoredAppTheme();
    ensureAppliedAppTheme(preferredTheme);
  }, [user]);

  return null;
}


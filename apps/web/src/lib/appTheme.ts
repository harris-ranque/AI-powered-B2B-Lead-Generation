const STORAGE_KEY = "app-theme";

export const APP_THEME_OPTIONS = [
  {
    value: "harborlight" as const,
    label: "Harborlight Pro (Modern B2B)",
    description: "Calm blues and softened surfaces for focus-friendly workflows.",
  },
  {
    value: "neon-pulse" as const,
    label: "Neon Pulse (Legacy)",
    description: "Vibrant neo-futuristic palette with glowing gradients.",
  },
] as const;

export type AppThemeKey = (typeof APP_THEME_OPTIONS)[number]["value"];

export const DEFAULT_APP_THEME: AppThemeKey = "harborlight";

const APP_THEME_VALUES = new Set<AppThemeKey>(
  APP_THEME_OPTIONS.map((option) => option.value),
);

function isAppThemeKey(value: unknown): value is AppThemeKey {
  return typeof value === "string" && APP_THEME_VALUES.has(value as AppThemeKey);
}

export function getStoredAppTheme(): AppThemeKey {
  if (typeof window === "undefined") {
    return DEFAULT_APP_THEME;
  }

  const storedValue = window.localStorage.getItem(STORAGE_KEY);
  return isAppThemeKey(storedValue) ? storedValue : DEFAULT_APP_THEME;
}

export function applyAppTheme(theme: AppThemeKey) {
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-app-theme", theme);
  }

  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, theme);
  }
}

export function initializeStoredAppTheme() {
  const theme = getStoredAppTheme();

  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-app-theme", theme);
  }
}

export function ensureAppliedAppTheme(value: unknown) {
  if (isAppThemeKey(value)) {
    applyAppTheme(value);
  } else {
    applyAppTheme(DEFAULT_APP_THEME);
  }
}


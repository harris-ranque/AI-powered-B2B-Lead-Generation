/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PUBLIC_POSTHOG_KEY: string;
  readonly VITE_PUBLIC_POSTHOG_HOST: string;
  readonly VITE_SHOW_PRICING?: string; // Feature flag for pricing section (default: "false" for beta)
  readonly VITE_SUPPORT_EMAIL?: string; // Support email for help modal (fallback: "ethan@example.com")
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
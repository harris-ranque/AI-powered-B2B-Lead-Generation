import React from "react";
import type { DocsManifest } from "./types";

interface UseDocsManifestResult {
  manifest: DocsManifest | null;
  error: string | null;
  isLoading: boolean;
}

export function useDocsManifest(): UseDocsManifestResult {
  const [manifest, setManifest] = React.useState<DocsManifest | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    fetch("/docs/manifest.json")
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`Documentation manifest not found (${res.status})`);
        }

        const contentType = res.headers.get("content-type") ?? "";
        const text = await res.text();
        if (cancelled) return;

        if (!contentType.includes("application/json")) {
          throw new Error("Documentation manifest is missing or not generated");
        }

        try {
          const data = JSON.parse(text) as DocsManifest;
          setManifest(data);
        } catch (parseError) {
          throw new Error("Documentation manifest is invalid JSON");
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e.message || "Failed to load docs");
          setManifest(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return { manifest, error, isLoading };
}

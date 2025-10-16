type CreditPack = {
  id: string;
  credits: number;
  priceCents: number;
  bonus?: number;
};

type PlanCatalogItem = {
  planId: string;
  planName: string;
  monthlyPrice: number;
  yearlyPrice: number;
  stripePriceIdMonthly?: string;
  stripePriceIdYearly?: string;
  limits?: {
    monthlySearches: number;
    maxLeadsPerSearch: number;
    monthlyEnrichments: number;
    monthlyExports: number;
    emailGeneration: boolean;
    bulkOperations: boolean;
    apiAccess: boolean;
    requiresOwnApiKeys: boolean;
    supportLevel: string;
  };
  features?: string[];
};

export type RuntimeConfig = {
  version: number;
  creditPacks: CreditPack[];
  planCatalog: PlanCatalogItem[];
  creditCosts: Record<string, number> | null;
};

const LS_KEY = "genni.runtimeConfig";
let inMemory: RuntimeConfig | null = null;
let inflight: Promise<RuntimeConfig> | null = null;

export async function loadRuntimeConfig(force = false): Promise<RuntimeConfig> {
  if (!force && inMemory) return inMemory;
  if (!force && inflight) return inflight;

  const fromStorage = safeRead();
  if (fromStorage && !force) {
    inMemory = fromStorage;
    return fromStorage;
  }

  inflight = fetch("/api/public/config", { credentials: "same-origin" })
    .then(async (res) => {
      if (!res.ok) throw new Error("Failed to load runtime config");
      const data = (await res.json()) as RuntimeConfig;
      inMemory = data;
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(data));
      } catch (e) {
        // Ignore storage write errors (e.g., quota, private mode)
      }
      return data;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

export function getRuntimeConfigSync(): RuntimeConfig | null {
  return inMemory || safeRead();
}

function safeRead(): RuntimeConfig | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as RuntimeConfig;
  } catch {
    return null;
  }
}

import { useEffect, useState } from "react";

export function useRuntimeConfig() {
  const [config, setConfig] = useState<RuntimeConfig | null>(
    getRuntimeConfigSync(),
  );
  const [loading, setLoading] = useState(config == null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    loadRuntimeConfig(config == null)
      .then((cfg) => {
        if (mounted) {
          setConfig(cfg);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (mounted) {
          setError(e instanceof Error ? e.message : String(e));
          setLoading(false);
        }
      });
    return () => {
      mounted = false;
    };
  }, [config]);

  return { config, loading, error };
}

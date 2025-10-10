export const featureFlags = {
  unifiedProgressPanel: true,
} as const;

type FeatureFlagKey = keyof typeof featureFlags;

export function isFeatureEnabled(flag: FeatureFlagKey) {
  return featureFlags[flag];
}

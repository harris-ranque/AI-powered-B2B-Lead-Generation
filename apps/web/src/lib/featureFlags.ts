export const featureFlags = {
  unifiedProgressPanel: true,
  multiContactPipeline: true,
} as const;

type FeatureFlagKey = keyof typeof featureFlags;

export function isFeatureEnabled(flag: FeatureFlagKey) {
  return featureFlags[flag];
}

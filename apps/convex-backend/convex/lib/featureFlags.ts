/**
 * Feature flags read from Convex environment variables.
 */

/** Multi-contact pipeline is always enabled (contact-level storage, export, analysis). */
export function isMultiContactPipelineEnabled(): boolean {
  return true;
}

/** People discovery runs before FindyMail email lookup (default on). */
export function isPeopleDiscoveryEnabled(): boolean {
  return process.env.PEOPLE_DISCOVERY_ENABLED !== "false";
}

/**
 * Feature flags read from Convex environment variables.
 */

/** Multi-contact pipeline is always enabled (contact-level storage, export, analysis). */
export function isMultiContactPipelineEnabled(): boolean {
  return true;
}

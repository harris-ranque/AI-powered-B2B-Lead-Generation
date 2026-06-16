/**
 * Derive parent lead analysisStatus from accepted contact rows.
 * Returns null when contacts are still in flight (do not patch lead yet).
 */
export function deriveLeadAnalysisStatusFromContacts(
  contacts: Array<{ status?: string; analysisStatus?: string }>,
): "completed" | "skipped" | "failed" | null {
  const accepted = contacts.filter((contact) => contact.status === "accepted");
  if (accepted.length === 0) {
    return null;
  }

  const isTerminal = (status?: string) =>
    status === "completed" ||
    status === "skipped" ||
    status === "failed" ||
    status === "timeout";

  const allDone = accepted.every((contact) => isTerminal(contact.analysisStatus));
  if (!allDone) {
    return null;
  }

  const anyCompleted = accepted.some(
    (contact) => contact.analysisStatus === "completed",
  );
  if (anyCompleted) {
    return "completed";
  }
  if (accepted.every((contact) => contact.analysisStatus === "skipped")) {
    return "skipped";
  }
  return "failed";
}

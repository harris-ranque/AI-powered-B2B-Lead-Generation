export type ExportableLead = {
  email?: string;
  contactInfo?: {
    contacts?: Array<{
      name?: string;
      email?: string;
    }>;
    emails?: Array<{
      email?: string;
    }>;
  };
};

function firstNonEmptyString(...values: Array<unknown>): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function deriveFirstNameFromEmail(email: string): string {
  const [localPart] = email.split("@");
  if (!localPart) {
    return "";
  }
  const segment = localPart
    .split(/[._-]+/)
    .map((part) => part.replace(/[0-9]/g, ""))
    .find((part) => part.length > 0);
  if (!segment) {
    return "";
  }
  return segment.charAt(0).toUpperCase() + segment.slice(1);
}

export function extractContactDetails(lead: ExportableLead): {
  firstName: string;
  fullName: string;
  email: string;
} {
  const contacts = lead.contactInfo?.contacts ?? [];
  const emails = lead.contactInfo?.emails ?? [];

  const contactWithEmail = contacts.find(
    (contact) => typeof contact?.email === "string" && contact.email.trim(),
  );
  const primaryContact = contactWithEmail ?? contacts[0];

  const emailCandidates: Array<string | undefined> = [
    lead.email,
    contactWithEmail?.email,
    primaryContact?.email,
    emails.find((entry) => typeof entry?.email === "string")?.email,
  ];

  const email = firstNonEmptyString(...emailCandidates);
  const fullName = firstNonEmptyString(primaryContact?.name);
  const firstName = fullName
    ? fullName.split(/\s+/)[0] ?? ""
    : email
      ? deriveFirstNameFromEmail(email)
      : "";

  return {
    firstName,
    fullName,
    email,
  };
}

export function isLeadExportable(lead: ExportableLead): boolean {
  const { email } = extractContactDetails(lead);
  return email.length > 0;
}

export function noExportableLeadsMessage(totalBeforeFilter: number): string {
  return `No exportable leads found (${totalBeforeFilter} leads discovered but none had usable email addresses)`;
}

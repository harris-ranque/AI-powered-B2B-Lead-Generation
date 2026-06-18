import {
  scoreTitleAgainstRoles,
  TITLE_MATCH_ACCEPT_THRESHOLD,
} from "./contactAcceptance";

export interface FindyMailEmployeeRecord {
  name: string;
  jobTitle: string;
  linkedinUrl?: string;
}

export type FindyMailEmployeeProspect = {
  name: string;
  title: string;
  matchedRole?: string;
  confidence: number;
  roleMatchScore?: number;
  linkedinUrl?: string;
  source: "findymail_employees";
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function firstNonEmptyString(...values: Array<unknown>): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

/** Normalize FindyMail /search/employees payloads (array or wrapped object). */
export function parseFindyMailEmployeesResponse(
  data: unknown,
): FindyMailEmployeeRecord[] {
  const rows: unknown[] = Array.isArray(data)
    ? data
    : Array.isArray((data as { employees?: unknown[] })?.employees)
      ? ((data as { employees: unknown[] }).employees ?? [])
      : Array.isArray((data as { contacts?: unknown[] })?.contacts)
        ? ((data as { contacts: unknown[] }).contacts ?? [])
        : [];

  const employees: FindyMailEmployeeRecord[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const record = asRecord(row);
    if (!record) {
      continue;
    }

    const name = firstNonEmptyString(record.name, record.full_name, record.fullName);
    const jobTitle = firstNonEmptyString(
      record.jobTitle,
      record.job_title,
      record.title,
    );
    if (!name || !jobTitle) {
      continue;
    }

    const key = name.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    const linkedinUrl = firstNonEmptyString(
      record.linkedinUrl,
      record.linkedin_url,
      record.linkedin,
    );

    employees.push({
      name,
      jobTitle,
      ...(linkedinUrl ? { linkedinUrl } : {}),
    });
  }

  return employees;
}

export function sanitizeFindyMailEmployeeJobTitles(
  roles: string[],
  maxTitles = 10,
): string[] {
  const seen = new Set<string>();
  const sanitized: string[] = [];

  for (const role of roles) {
    const trimmed = role.trim();
    if (!trimmed) {
      continue;
    }
    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    sanitized.push(trimmed);
    if (sanitized.length >= maxTitles) {
      break;
    }
  }

  return sanitized;
}

/** Map FindyMail employees to role-matched prospects for leadProspects storage. */
export function mapFindyMailEmployeesToProspects(
  employees: FindyMailEmployeeRecord[],
  requestedRoles: string[],
  enableRoleExpansion = true,
): FindyMailEmployeeProspect[] {
  const results: FindyMailEmployeeProspect[] = [];
  const seenNames = new Set<string>();

  for (const employee of employees) {
    const name = employee.name.trim();
    const title = employee.jobTitle.trim();
    if (!name || !title) {
      continue;
    }

    const nameKey = name.toLowerCase();
    if (seenNames.has(nameKey)) {
      continue;
    }

    const titleMatch = scoreTitleAgainstRoles(
      title,
      requestedRoles,
      enableRoleExpansion,
    );
    if (titleMatch.score < TITLE_MATCH_ACCEPT_THRESHOLD) {
      continue;
    }

    seenNames.add(nameKey);
    results.push({
      name,
      title,
      matchedRole: titleMatch.matchedRole,
      confidence: Math.max(0.7, titleMatch.score),
      roleMatchScore: titleMatch.score,
      linkedinUrl: employee.linkedinUrl,
      source: "findymail_employees",
    });
  }

  return results;
}

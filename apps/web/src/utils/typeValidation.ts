/**
 * Type validation utilities for API data transformations
 */

export interface ValidationResult<T> {
  success: boolean;
  data?: T;
  errors: string[];
}

export interface TransformedEmailRequest {
  requestId?: string;
  leadId?: string;
  completed_at?: number;
  quality_score?: number;
  processing_time?: number;
  primary_email: { subject: string; body: string };
  follow_up_emails: Array<{ subject: string; body: string; delay_days: number }>;
  relevance_score: number;
  personalization_notes: string[];
  estimated_response_rate: number;
}

export function isEmailGenerationRequest(obj: unknown): obj is {
  status: string;
  result?: {
    subject?: string;
    body?: string;
    followUps?: Array<{ subject: string; body: string }>;
    relevanceScore?: number;
    notes?: string[];
    estimatedResponseRate?: number;
  };
} {
  return obj && typeof obj === "object" && typeof obj.status === "string";
}

export function validateEmailGenerationResult(obj: unknown): ValidationResult<{
  primary_email: { subject: string; body: string };
  follow_up_emails: Array<{ subject: string; body: string }>;
  relevance_score: number;
  personalization_notes: string[];
  estimated_response_rate: number;
}> {
  const errors: string[] = [];

  if (!obj || typeof obj !== "object") {
    errors.push("Input must be an object");
    return { success: false, errors };
  }

  if (!obj.result || typeof obj.result !== "object") {
    errors.push("Missing result object");
    return { success: false, errors };
  }

  const result = obj.result;

  // Validate required fields with defaults
  const subject =
    typeof result.subject === "string" ? result.subject : "Generated Email";
  const body = typeof result.body === "string" ? result.body : "";

  const followUps = Array.isArray(result.followUps)
    ? result.followUps.filter(
        (item: unknown) =>
          item &&
          typeof item === "object" &&
          item !== null &&
          typeof (item as Record<string, unknown>).subject === "string" &&
          typeof (item as Record<string, unknown>).body === "string",
      )
    : [];

  const relevanceScore =
    typeof result.relevanceScore === "number" &&
    result.relevanceScore >= 0 &&
    result.relevanceScore <= 1
      ? result.relevanceScore
      : 0.8;

  const notes = Array.isArray(result.notes)
    ? result.notes.filter((note: unknown) => typeof note === "string")
    : [];

  const estimatedResponseRate =
    typeof result.estimatedResponseRate === "number" &&
    result.estimatedResponseRate >= 0 &&
    result.estimatedResponseRate <= 1
      ? result.estimatedResponseRate
      : 0.15;

  return {
    success: true,
    data: {
      primary_email: { subject, body },
      follow_up_emails: followUps,
      relevance_score: relevanceScore,
      personalization_notes: notes,
      estimated_response_rate: estimatedResponseRate,
    },
    errors,
  };
}

export function safeTransformEmailRequests(
  emailRequests: unknown,
): TransformedEmailRequest[] {
  let page: unknown[] = [];

  if (Array.isArray(emailRequests)) {
    page = emailRequests;
  } else if (
    emailRequests &&
    typeof emailRequests === "object" &&
    emailRequests !== null &&
    Array.isArray((emailRequests as Record<string, unknown>).page)
  ) {
    page = (emailRequests as Record<string, unknown>).page as unknown[];
  } else {
    return [];
  }

  const results: TransformedEmailRequest[] = [];

  for (const entry of page) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const request = entry as Record<string, unknown>;
    if (request.status !== "completed") {
      continue;
    }

    const rawResult = request.result;
    if (!rawResult || typeof rawResult !== "object") {
      continue;
    }

    const result = rawResult as Record<string, unknown>;
    const primary = result.primary_email as Record<string, unknown> | undefined;
    if (!primary) {
      continue;
    }

    const subject =
      typeof primary.subject === "string" ? primary.subject : "Generated Email";
    const body = typeof primary.body === "string" ? primary.body : "";

    const personalizationSource = Array.isArray(primary.personalization_notes)
      ? primary.personalization_notes
      : Array.isArray(result.personalization_notes)
        ? result.personalization_notes
        : [];

    const personalizationNotes = personalizationSource.filter(
      (note): note is string => typeof note === "string",
    );

    const followUpsRaw = Array.isArray(result.follow_up_emails)
      ? result.follow_up_emails
      : [];

    const follow_up_emails = followUpsRaw.map((followUp, index) => {
      if (!followUp || typeof followUp !== "object") {
        return {
          subject: `Follow Up ${index + 1}`,
          body: "",
          delay_days: (index + 1) * 3,
        };
      }
      const data = followUp as Record<string, unknown>;
      return {
        subject:
          typeof data.subject === "string"
            ? data.subject
            : `Follow Up ${index + 1}`,
        body: typeof data.body === "string" ? data.body : "",
        delay_days:
          typeof data.delay_days === "number"
            ? data.delay_days
            : (index + 1) * 3,
      };
    });

    const relevance_score =
      typeof result.relevance_score === "number" ? result.relevance_score : 0;

    const estimated_response_rate =
      typeof result.estimated_response_rate === "number"
        ? result.estimated_response_rate
        : typeof primary.estimated_effectiveness === "number"
          ? primary.estimated_effectiveness
          : 0.15;

    const metadata = request.metadata as Record<string, unknown> | undefined;

    results.push({
      requestId:
        typeof request.requestId === "string" ? request.requestId : undefined,
      leadId:
        typeof request.leadId === "string" ? request.leadId : undefined,
      completed_at:
        typeof request.completedAt === "number"
          ? (request.completedAt as number)
          : undefined,
      quality_score:
        metadata && typeof metadata.qualityScore === "number"
          ? (metadata.qualityScore as number)
          : undefined,
      processing_time:
        metadata && typeof metadata.processingTime === "number"
          ? (metadata.processingTime as number)
          : undefined,
      primary_email: { subject, body },
      follow_up_emails,
      relevance_score,
      personalization_notes: personalizationNotes,
      estimated_response_rate,
    });
  }

  return results;
}

export function isValidTabName(
  tab: string,
): tab is
  | "pipeline"
  | "search-history"
  | "profile"
  | "credits"
  | "admin"
  | "dashboard"
  | "settings" {
  const validTabs = [
    "pipeline",
    "search-history",
    "profile",
    "credits",
    "admin",
    "dashboard",
    "settings",
  ];
  return validTabs.includes(tab);
}

export function validateUser(user: unknown): ValidationResult<{
  _id: string;
  plan: "free" | "pro" | "enterprise";
  role?: "admin" | "user";
  isAdmin?: boolean;
}> {
  const errors: string[] = [];

  if (!user || typeof user !== "object") {
    errors.push("User must be an object");
    return { success: false, errors };
  }

  if (!user._id || typeof user._id !== "string") {
    errors.push("User must have a valid _id");
    return { success: false, errors };
  }

  const validPlans = ["free", "pro", "enterprise"];
  const plan = validPlans.includes(user.plan) ? user.plan : "free";

  const validRoles = ["admin", "user"];
  const role = validRoles.includes(user.role) ? user.role : "user";

  return {
    success: errors.length === 0,
    data: {
      _id: user._id,
      plan,
      role,
      isAdmin: user.isAdmin === true || user.role === "admin",
    },
    errors,
  };
}

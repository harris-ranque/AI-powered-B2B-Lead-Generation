/**
 * Type validation utilities for API data transformations
 */

export interface ValidationResult<T> {
  success: boolean;
  data?: T;
  errors: string[];
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
  return (
    obj &&
    typeof obj === 'object' &&
    typeof obj.status === 'string'
  );
}

export function validateEmailGenerationResult(obj: unknown): ValidationResult<{
  primary_email: { subject: string; body: string };
  follow_up_emails: Array<{ subject: string; body: string }>;
  relevance_score: number;
  personalization_notes: string[];
  estimated_response_rate: number;
}> {
  const errors: string[] = [];

  if (!obj || typeof obj !== 'object') {
    errors.push('Input must be an object');
    return { success: false, errors };
  }

  if (!obj.result || typeof obj.result !== 'object') {
    errors.push('Missing result object');
    return { success: false, errors };
  }

  const result = obj.result;

  // Validate required fields with defaults
  const subject = typeof result.subject === 'string' ? result.subject : 'Generated Email';
  const body = typeof result.body === 'string' ? result.body : '';
  
  const followUps = Array.isArray(result.followUps) 
    ? result.followUps.filter((item: unknown) => 
        item && 
        typeof item === 'object' && 
        item !== null && 
        typeof (item as Record<string, unknown>).subject === 'string' && 
        typeof (item as Record<string, unknown>).body === 'string'
      )
    : [];

  const relevanceScore = typeof result.relevanceScore === 'number' && 
    result.relevanceScore >= 0 && result.relevanceScore <= 1
    ? result.relevanceScore 
    : 0.8;

  const notes = Array.isArray(result.notes) 
    ? result.notes.filter((note: unknown) => typeof note === 'string')
    : [];

  const estimatedResponseRate = typeof result.estimatedResponseRate === 'number' &&
    result.estimatedResponseRate >= 0 && result.estimatedResponseRate <= 1
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

export function safeTransformEmailRequests(emailRequests: unknown): Array<{
  primary_email: { subject: string; body: string };
  follow_up_emails: Array<{ subject: string; body: string }>;
  relevance_score: number;
  personalization_notes: string[];
  estimated_response_rate: number;
}> {
  if (!emailRequests || 
      typeof emailRequests !== 'object' || 
      emailRequests === null ||
      !(emailRequests as Record<string, unknown>).page || 
      !Array.isArray((emailRequests as Record<string, unknown>).page)) {
    return [];
  }

  const page = (emailRequests as Record<string, unknown>).page as unknown[];

  const results: Array<{
    primary_email: { subject: string; body: string };
    follow_up_emails: Array<{ subject: string; body: string }>;
    relevance_score: number;
    personalization_notes: string[];
    estimated_response_rate: number;
  }> = [];

  for (const request of page) {
    if (request && 
        typeof request === 'object' && 
        (request as Record<string, unknown>).status === 'completed' && 
        isEmailGenerationRequest(request)) {
      const validation = validateEmailGenerationResult(request);
      if (validation.success && validation.data) {
        results.push(validation.data);
      }
    }
  }

  return results;
}

export function isValidTabName(tab: string): tab is 
  | "pipeline" 
  | "email-generator" 
  | "profile" 
  | "credits" 
  | "admin" 
  | "dashboard" 
  | "settings" 
  | "debug" 
  | "performance" {
  const validTabs = [
    "pipeline",
    "email-generator", 
    "profile",
    "credits",
    "admin",
    "dashboard", 
    "settings",
    "debug",
    "performance"
  ];
  return validTabs.includes(tab);
}

export function validateUser(user: unknown): ValidationResult<{
  _id: string;
  plan: 'free' | 'pro' | 'enterprise';
  role?: 'admin' | 'user';
  isAdmin?: boolean;
}> {
  const errors: string[] = [];

  if (!user || typeof user !== 'object') {
    errors.push('User must be an object');
    return { success: false, errors };
  }

  if (!user._id || typeof user._id !== 'string') {
    errors.push('User must have a valid _id');
    return { success: false, errors };
  }

  const validPlans = ['free', 'pro', 'enterprise'];
  const plan = validPlans.includes(user.plan) ? user.plan : 'free';

  const validRoles = ['admin', 'user'];
  const role = validRoles.includes(user.role) ? user.role : 'user';

  return {
    success: errors.length === 0,
    data: {
      _id: user._id,
      plan,
      role,
      isAdmin: user.isAdmin === true || user.role === 'admin',
    },
    errors,
  };
}
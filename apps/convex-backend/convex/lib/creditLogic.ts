/**
 * Pure business logic functions for credit operations
 * These functions are extracted from transactions for better testability
 *
 * @module creditLogic
 */

/**
 * Credit operation types
 */
export type CreditOperation =
  | "purchase"
  | "usage"
  | "refund"
  | "bonus"
  | "rollback";

/**
 * Operations that add credits to balance
 */
export const CREDIT_ADD_OPERATIONS: CreditOperation[] = [
  "purchase",
  "refund",
  "bonus",
  "rollback",
];

/**
 * Operations that deduct credits from balance
 */
export const CREDIT_DEDUCT_OPERATIONS: CreditOperation[] = ["usage"];

/**
 * Credit reservation status
 */
export type ReservationStatus = "pending" | "committed" | "rolled_back";

/**
 * Credit reservation structure
 */
export interface CreditReservation {
  amount: number;
  status: ReservationStatus;
  expiresAt: number;
  createdAt: number;
}

/**
 * Result of balance calculation
 */
export interface BalanceCalculationResult {
  newBalance: number;
  wasAdjusted: boolean;
  originalCalculation: number;
}

/**
 * Calculate new credit balance after an operation
 *
 * - Purchase, refund, bonus, and rollback operations ADD to balance
 * - Usage operations SUBTRACT from balance
 * - Balance is clamped to minimum of 0 (never goes negative)
 *
 * @param currentBalance - Current credit balance
 * @param operation - Type of credit operation
 * @param amount - Amount of credits (always positive)
 * @returns New balance and adjustment info
 *
 * @example
 * ```typescript
 * calculateNewBalance(100, 'usage', 30);
 * // { newBalance: 70, wasAdjusted: false, originalCalculation: 70 }
 *
 * calculateNewBalance(10, 'usage', 30);
 * // { newBalance: 0, wasAdjusted: true, originalCalculation: -20 }
 *
 * calculateNewBalance(100, 'purchase', 50);
 * // { newBalance: 150, wasAdjusted: false, originalCalculation: 150 }
 * ```
 */
export function calculateNewBalance(
  currentBalance: number,
  operation: CreditOperation,
  amount: number
): BalanceCalculationResult {
  // Ensure we start with a valid balance
  const safeCurrentBalance = Math.max(0, currentBalance || 0);
  const safeAmount = Math.abs(amount || 0);

  let newBalance: number;

  // Calculate based on operation type
  if (CREDIT_ADD_OPERATIONS.includes(operation)) {
    // Purchase, refund, bonus, rollback: ADD to balance
    newBalance = safeCurrentBalance + safeAmount;
  } else if (CREDIT_DEDUCT_OPERATIONS.includes(operation)) {
    // Usage: SUBTRACT from balance
    newBalance = safeCurrentBalance - safeAmount;
  } else {
    // Unknown operation, default to no change
    newBalance = safeCurrentBalance;
  }

  const originalCalculation = newBalance;

  // Ensure balance doesn't go negative
  const wasAdjusted = newBalance < 0;
  if (wasAdjusted) {
    newBalance = 0;
  }

  return {
    newBalance,
    wasAdjusted,
    originalCalculation,
  };
}

/**
 * Check if a credit reservation has expired
 *
 * @param expiresAt - Timestamp when reservation expires
 * @param now - Current timestamp (default: Date.now())
 * @returns True if reservation has expired
 *
 * @example
 * ```typescript
 * isReservationExpired(Date.now() - 1000);
 * // true (expired 1 second ago)
 *
 * isReservationExpired(Date.now() + 60000);
 * // false (expires in 1 minute)
 * ```
 */
export function isReservationExpired(
  expiresAt: number,
  now: number = Date.now()
): boolean {
  return now > expiresAt;
}

/**
 * Check if a reservation can be committed
 *
 * @param reservation - The credit reservation to check
 * @param now - Current timestamp (default: Date.now())
 * @returns Object with canCommit flag and reason if not
 *
 * @example
 * ```typescript
 * canCommitReservation({ status: 'pending', expiresAt: Date.now() + 60000, amount: 10, createdAt: Date.now() });
 * // { canCommit: true }
 *
 * canCommitReservation({ status: 'committed', expiresAt: Date.now() + 60000, amount: 10, createdAt: Date.now() });
 * // { canCommit: false, reason: 'Reservation already committed' }
 * ```
 */
export function canCommitReservation(
  reservation: CreditReservation,
  now: number = Date.now()
): { canCommit: boolean; reason?: string } {
  if (reservation.status !== "pending") {
    return {
      canCommit: false,
      reason: `Reservation already ${reservation.status}`,
    };
  }

  if (isReservationExpired(reservation.expiresAt, now)) {
    return {
      canCommit: false,
      reason: "Reservation has expired",
    };
  }

  return { canCommit: true };
}

/**
 * Calculate reservation expiration timestamp
 *
 * @param expireMinutes - Minutes until expiration (default: 30)
 * @param now - Current timestamp (default: Date.now())
 * @returns Expiration timestamp
 *
 * @example
 * ```typescript
 * calculateReservationExpiry(30);
 * // Date.now() + 30 * 60 * 1000
 * ```
 */
export function calculateReservationExpiry(
  expireMinutes: number = 30,
  now: number = Date.now()
): number {
  const safeMinutes = Math.max(1, Math.min(expireMinutes, 1440)); // 1 min to 24 hours
  return now + safeMinutes * 60 * 1000;
}

/**
 * Check if user has sufficient credits for an operation
 *
 * @param currentBalance - Current credit balance
 * @param requiredAmount - Amount needed for operation
 * @returns Object with sufficient flag and deficit if not
 *
 * @example
 * ```typescript
 * hasInsufficientCredits(100, 50);
 * // { sufficient: true, deficit: 0 }
 *
 * hasInsufficientCredits(30, 50);
 * // { sufficient: false, deficit: 20 }
 * ```
 */
export function hasSufficientCredits(
  currentBalance: number,
  requiredAmount: number
): { sufficient: boolean; deficit: number } {
  const safeBalance = Math.max(0, currentBalance || 0);
  const safeRequired = Math.max(0, requiredAmount || 0);

  const deficit = Math.max(0, safeRequired - safeBalance);

  return {
    sufficient: safeBalance >= safeRequired,
    deficit,
  };
}

/**
 * Format credit amount for display
 *
 * @param amount - Credit amount
 * @param operation - Operation type (for sign)
 * @returns Formatted string with sign
 *
 * @example
 * ```typescript
 * formatCreditAmount(50, 'purchase');
 * // '+50'
 *
 * formatCreditAmount(30, 'usage');
 * // '-30'
 * ```
 */
export function formatCreditAmount(
  amount: number,
  operation: CreditOperation
): string {
  const sign = CREDIT_ADD_OPERATIONS.includes(operation) ? "+" : "-";
  return `${sign}${Math.abs(amount)}`;
}

/**
 * Validate credit amount is positive and reasonable
 *
 * @param amount - Amount to validate
 * @returns Validation result
 *
 * @example
 * ```typescript
 * validateCreditAmount(50);
 * // { valid: true }
 *
 * validateCreditAmount(-10);
 * // { valid: false, reason: 'Amount must be positive' }
 *
 * validateCreditAmount(1000001);
 * // { valid: false, reason: 'Amount exceeds maximum (1000000)' }
 * ```
 */
export function validateCreditAmount(
  amount: number
): { valid: boolean; reason?: string } {
  if (!Number.isFinite(amount)) {
    return { valid: false, reason: "Amount must be a valid number" };
  }

  if (amount <= 0) {
    return { valid: false, reason: "Amount must be positive" };
  }

  if (amount > 1_000_000) {
    return { valid: false, reason: "Amount exceeds maximum (1000000)" };
  }

  if (!Number.isInteger(amount)) {
    return { valid: false, reason: "Amount must be a whole number" };
  }

  return { valid: true };
}

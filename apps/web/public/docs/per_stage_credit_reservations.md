# Per-Stage Credit Reservations (Design)

This document proposes a staged, fair-billing credit model that supports user cancellations, admin emergency stops, and partial refunds without race conditions.

## Goals

- Charge credits proportional to work actually performed per stage.
- Support cancellation and admin pause with partial refunds for unused work.
- Remain resilient to retries and idempotent across orchestrator restarts.
- Keep data consistent under concurrent scheduling and webhooks.

## Stages & Costs

- Discovery: `LEAD_DISCOVERY` (e.g., 1 credit per search or per X results)
- Enrichment: `EMAIL_ENRICHMENT` (per lead, or per batch)
- Analysis: `AI_ANALYSIS` (per lead)
- Optional: `EMAIL_GENERATION`, `BULK_ANALYSIS`

All base costs live in `systemConfiguration.creditCosts` (already present). Actuals are measured per search in `searches.actualCosts`.

## Reservation Workflow (Two-Phase Commit)

For each stage, at stage start:

1. Estimate total cost for the stage (e.g., `leadsToProcess * costPerLead`).
2. Reserve credits: `credits.reserve(userId, amount, operation, expireMinutes)`.
   - Store `reservationId` on the search (`searches.reservationId`) and `creditsReserved`.
3. Execute stage work in batches. For each batch:
   - Commit partial usage by calling `credits.commitReservation(reservationId, description, relatedEntity*)` with the batch’s actual cost.
   - Update `searches.actualCosts.<stage>` and `searches.creditsUsed`.
4. On stage completion:
   - Roll back any remaining reservation amount (refunds unused portion) or let `commitReservation` drain it.

Cancellation / Pause handling:

- If user cancels or is paused, stop scheduling. Roll back remaining reservation after settling any in-flight batch usage.
- Global emergency stop can iterate active searches and roll back any `creditsReserved` while marking searches `cancelled`.

Error handling:

- If a batch fails, do not commit usage for it. Retry or roll back at stage end.
- Use idempotency keys where external APIs support them to avoid duplicate costs.

## Data Model Additions

- `searches.actualCosts`: `{ discovery: number; enrichment: number; analysis: number }`
- `searches.creditsReserved`: number (already present)
- `searches.reservationId`: Id<"creditReservations"> (already present)
- `searches.creditsRefunded`: number

## Orchestrator Integration Points

- Discovery action:
  - Reserve `LEAD_DISCOVERY` upfront (or per-page/page-token); commit after results retrieval.
- Enrichment action:
  - Reserve `EMAIL_ENRICHMENT` for leads needing enrichment; commit batch-by-batch.
- Analysis action:
  - Reserve `AI_ANALYSIS` for leads to analyze; commit per batch.

Each action should:

- Re-check `search.status` and `user.processingPaused` before/after external calls and between batches.
- Broadcast cancellation status when exiting early.

## Auditing & Transparency

- Every commit/rollback creates a row in `creditTransactions` with `relatedEntity = { type: "search", id: searchId }`.
- UI: Expose `actualCosts`, `creditsUsed`, and `creditsRefunded` per search.

## Migration Strategy

1. Ship current cancel semantics (done) and per-user pause (done).
2. Add per-stage cost toggles in `systemConfiguration`.
3. Implement reservation/commit in analysis (highest per-unit cost), then enrichment, then discovery.
4. Add UI surfacing of per-search costs and refunds.

## Testing

- Unit test credit reservations/commits/rollbacks happy paths and edge cases (expired reservations, insufficient credits).
- Integration tests for cancel mid-batch: ensure partial commit and remaining rollback.
- Idempotency tests for retried batches.

## Notes

- Start with conservative estimates to avoid under-reserving; refunds on rollback are safe.
- Keep reservations short-lived (expireMinutes) and refresh if stages run long.

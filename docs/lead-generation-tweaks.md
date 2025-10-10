# Lead Generation Pipeline Tweaks

## Checklist
- [x] Highlight the pipeline container with a success state and toast when a search finishes.
- [x] Fix the "View Results" navigation so completed searches open the lead history tab reliably.
- [x] Align pipeline UI accents (badges, alerts, counters) with the dark theme palette.
- [x] Anchor the lead history section for hash navigation and collapse handling.
- [x] Outline a plan to consolidate the dual progress indicators into a single flow.

## Unifying the progress flows

### Current state
- **StageTracker** reflects the manual workflow (source selection → discovery → enrichment → personalization → review/export).
- **SearchProgressTracker** mirrors backend status broadcasts (discovered, enriched, analyzed counts plus research stage updates).
- Each tracker manages its own lifecycle, rendering two parallel progress experiences that can drift out of sync.

### Consolidation approach
- Introduce a shared `PipelineProgressContext` that normalizes pipeline, search, and broadcast updates into one shape (stage id, percent complete, metrics, warnings).
- Convert `StageTracker` and `SearchProgressTracker` into presentation components that both consume the shared context rather than calculating their own status.
- Merge their layouts by composing a single progress surface that contains:
  - The current stage badge and controls (formerly StageTracker header).
  - Live metrics grid (counts, confidence) using the normalized numbers.
  - Timeline/history drawer fed by the same context for detailed events.
- Ensure backend broadcasts map to stage transitions (e.g., `researchStage` updates drive StageTracker advancement) so UI movement is consistent.

### Implementation outline
1. **Model**: Define a `PipelineProgress` type combining stage metadata, numeric progress, and health alerts. Provide derivation helpers for search + pipeline state.
2. **Provider**: Wrap the pipeline area with a provider that reacts to Convex search documents, broadcasts, and local reducer updates, emitting a single progress object.
3. **UI consolidation**: Replace the two existing components with a new `PipelineProgressPanel` that receives the shared progress data. Use conditional regions for quick stats, stage controls, and history, rather than separate components.
4. **Testing**: Add integration tests (React Testing Library) to simulate status transitions and assert that the unified panel renders the expected stage label, metrics, and actions for each step.

### Additional considerations
- Maintain accessibility: announce stage changes via `aria-live` regions and ensure contrast tokens respect both light and dark themes.
- Preserve collapse behaviour by letting the provider expose a `isCollapsed` flag used by the orchestrator container.
- Keep legacy components temporarily behind a feature flag to allow gradual rollout.

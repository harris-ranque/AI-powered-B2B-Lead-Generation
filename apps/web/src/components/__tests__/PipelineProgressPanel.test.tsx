import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { Id } from "@genni/convex-types/dataModel";
import type { Search } from "@/lib/types";
import type { StatusBroadcast } from "@/hooks/base/useStatusBroadcastsBase";
import { PipelineProgressProvider } from "@/contexts/PipelineProgressContext";
import { PipelineProgressPanel } from "@/components/PipelineProgressPanel";
import { useSearch } from "@/hooks/useSearches";
import { useSearchBroadcasts } from "@/hooks/useStatusBroadcasts";
import { usePipelineProgress } from "@/contexts/PipelineProgressContext";
import type React from "react";

vi.mock("@/hooks/useSearches", () => ({
  useSearch: vi.fn(),
}));

vi.mock("@/hooks/useStatusBroadcasts", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/useStatusBroadcasts")>(
    "@/hooks/useStatusBroadcasts",
  );
  return {
    ...actual,
    useSearchBroadcasts: vi.fn(),
  };
});

const mockedUseSearch = vi.mocked(useSearch);
const mockedUseSearchBroadcasts = vi.mocked(useSearchBroadcasts);

const baseSearchId = "search_1" as Id<"searches">;

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }),
});

function ProgressProbe() {
  const { progress, isCollapsed } = usePipelineProgress();
  return (
    <div data-testid="progress-probe">
      <span data-testid="probe-stage">{progress.stageId}</span>
      <span data-testid="probe-percent">{progress.percentComplete}</span>
      <span data-testid="probe-discovered">{progress.metrics.discovered ?? 0}</span>
      <span data-testid="probe-enriched">{progress.metrics.enriched ?? 0}</span>
      <span data-testid="probe-analyzed">{progress.metrics.analyzed ?? 0}</span>
      <span data-testid="probe-warnings">{(progress.warnings ?? []).join('|')}</span>
      <span data-testid="probe-collapsed">{isCollapsed ? 'true' : 'false'}</span>
    </div>
  );
}

function renderPanel(props?: Partial<React.ComponentProps<typeof PipelineProgressProvider>>) {
  return render(
    <PipelineProgressProvider searchId={baseSearchId} {...props}>
      <PipelineProgressPanel />
      <ProgressProbe />
    </PipelineProgressProvider>,
  );
}

function createSearch(overrides: Partial<Search> = {}): Search {
  return {
    _id: baseSearchId,
    userId: "user_1" as Id<"users">,
    status: "in_progress",
    progress: { discovered: 10, enriched: 5, analyzed: 2, total: 20 },
    researchConfidence: 0.72,
    researchStage: "analysis",
    createdAt: Date.now() - 10_000,
    updatedAt: Date.now() - 5_000,
    creditsReserved: 12,
    researchSourcesAnalyzed: 3,
    ...overrides,
  } as Search;
}

function createBroadcast(
  overrides: Partial<StatusBroadcast & { data?: Record<string, unknown> }> = {},
): StatusBroadcast {
  return {
    _id: "broadcast_1" as Id<"statusBroadcasts">,
    userId: "user_1" as Id<"users">,
    type: "pipeline_update",
    title: "AI personalization",
    message: "Working on analysis",
    data: { stage: "analysis", progress: 70, ...overrides.data },
    priority: "normal",
    tags: [],
    status: "delivered",
    delivered: true,
    acknowledged: true,
    requiresAck: false,
    createdAt: Date.now() - 2_000,
    expiresAt: Date.now() + 60_000,
    read: true,
    ...overrides,
  } as StatusBroadcast;
}

function setupMocks({
  search = createSearch(),
  broadcast = createBroadcast(),
  currentStage = "analysis",
  currentProgress = 70,
}: {
  search?: Search;
  broadcast?: StatusBroadcast;
  currentStage?: string;
  currentProgress?: number;
}) {
  mockedUseSearch.mockReturnValue({ search, isLoading: false });
  mockedUseSearchBroadcasts.mockReturnValue({
    broadcasts: broadcast ? [broadcast] : [],
    latestStatus: broadcast ?? null,
    currentProgress,
    currentStage,
    progressUpdates: broadcast ? [broadcast] : [],
    acknowledgeBroadcast: vi.fn(),
    markAsRead: vi.fn(),
    hasUpdates: Boolean(broadcast),
    isLoading: false,
  });
}

describe("PipelineProgressPanel", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders stage label and percent from combined data", async () => {
    setupMocks({});

    renderPanel();

    expect(screen.getByTestId("probe-stage")).toHaveTextContent("ai_personalization");
    expect(screen.getByTestId("probe-percent")).toHaveTextContent("80");
  });

  it("displays metrics from search progress data", async () => {
    setupMocks({});

    renderPanel();

    expect(screen.getByTestId("probe-discovered")).toHaveTextContent("10");
    expect(screen.getByTestId("probe-enriched")).toHaveTextContent("5");
    expect(screen.getByTestId("probe-analyzed")).toHaveTextContent("2");
  });

  it("prioritizes broadcast metrics when provided", async () => {
    const search = createSearch({
      progress: { discovered: 2, enriched: 1, analyzed: 0, total: 5 },
      researchStage: "discovery",
    });
    const broadcast = createBroadcast({
      data: {
        stage: "discovery",
        progress: {
          discovered: 12,
          enriched: 8,
          analyzed: 4,
          total: 20,
        },
      },
    });

    setupMocks({ search, broadcast, currentStage: "discovery", currentProgress: 45 });

    renderPanel();

    expect(screen.getByTestId("probe-discovered")).toHaveTextContent("12");
    expect(screen.getByTestId("probe-enriched")).toHaveTextContent("8");
    expect(screen.getByTestId("probe-analyzed")).toHaveTextContent("4");
    expect(screen.getByTestId("probe-percent")).toHaveTextContent("45");
  });

  it("shows warnings and error health state when search fails", async () => {
    const failedSearch = createSearch({ status: "failed", researchStage: "analysis_failed" });
    const broadcast = createBroadcast({
      priority: "critical",
      message: "Pipeline error detected",
      data: { stage: "analysis", progress: 45 },
    });

    setupMocks({ search: failedSearch, broadcast, currentProgress: 45 });

    renderPanel();

    expect(screen.getByTestId("probe-warnings")).toHaveTextContent(
      "The search failed. Review the error details in history.|Pipeline reported an error in the research stage.|Pipeline error detected",
    );
  });

  it("toggles timeline visibility when collapsing the panel", async () => {
    setupMocks({});

    renderPanel();

    const toggleButton = screen.getByRole("button", { name: /collapse/i });
    fireEvent.click(toggleButton);
    expect(toggleButton).toHaveTextContent(/expand/i);
    expect(screen.getByTestId("probe-collapsed")).toHaveTextContent("true");
  });

  it("updates stage when broadcasts advance the pipeline", async () => {
    const searchState = createSearch({
      status: "in_progress",
      progress: { discovered: 4, enriched: 0, analyzed: 0, total: 10 },
      researchStage: "discovery",
    });
    const broadcastState = createBroadcast({
      title: "Discovery underway",
      data: { stage: "discovery", progress: 30 },
    });

    mockedUseSearch.mockImplementation(() => ({ search: searchState, isLoading: false }));
    mockedUseSearchBroadcasts.mockImplementation(() => ({
      broadcasts: [broadcastState],
      latestStatus: broadcastState,
      currentProgress: 30,
      currentStage: "discovery",
      progressUpdates: [broadcastState],
      acknowledgeBroadcast: vi.fn(),
      markAsRead: vi.fn(),
      hasUpdates: true,
      isLoading: false,
    }));

    const { rerender } = renderPanel();

    expect(screen.getByTestId("probe-stage")).toHaveTextContent("lead_discovery");

    // Advance the broadcast to completion
    const completionBroadcast = createBroadcast({
      title: "Pipeline complete",
      message: "Export ready",
      data: { stage: "completion", progress: 100 },
      priority: "high",
    });
    searchState.status = "completed";
    searchState.researchStage = "completion";

    mockedUseSearchBroadcasts.mockImplementation(() => ({
      broadcasts: [completionBroadcast],
      latestStatus: completionBroadcast,
      currentProgress: 100,
      currentStage: "completion",
      progressUpdates: [completionBroadcast],
      acknowledgeBroadcast: vi.fn(),
      markAsRead: vi.fn(),
      hasUpdates: true,
      isLoading: false,
    }));

    rerender(
      <PipelineProgressProvider searchId={baseSearchId}>
        <PipelineProgressPanel />
        <ProgressProbe />
      </PipelineProgressProvider>,
    );

    expect(screen.getByTestId("probe-stage")).toHaveTextContent("review_export");
    expect(screen.getByTestId("probe-percent")).toHaveTextContent("100");
  });

  it("matches snapshot in light mode", () => {
    setupMocks({});

    const { container } = render(
      <div className="p-4">
        <PipelineProgressProvider searchId={baseSearchId} collapsed>
          <PipelineProgressPanel />
        </PipelineProgressProvider>
      </div>,
    );

    expect(container).toMatchSnapshot();
  });

  it("matches snapshot in dark mode", () => {
    setupMocks({});

    const { container } = render(
      <div className="dark bg-slate-900 p-4">
        <PipelineProgressProvider searchId={baseSearchId} collapsed>
          <PipelineProgressPanel />
        </PipelineProgressProvider>
      </div>,
    );

    expect(container).toMatchSnapshot();
  });
});

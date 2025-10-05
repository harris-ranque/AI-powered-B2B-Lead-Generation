import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'
import { GenniApp } from '../GenniApp'

type MockReturn = Record<string, unknown>

const useProfileMock = vi.fn<[], MockReturn>()
const useCreditsMock = vi.fn<[], MockReturn>()
const useBillingMock = vi.fn<[], MockReturn>()
const useLangGraphRequestsMock = vi.fn<[], MockReturn>()
const useSearchesMock = vi.fn<[], MockReturn>()
const useUserLeadsMock = vi.fn<[], MockReturn>()
const useStatusBroadcastsMock = vi.fn<[], MockReturn>()
const useAuthMock = vi.fn<[], MockReturn>()
const toastMock = vi.fn()

let pipelineValue: {
  state: {
    generatedEmails: unknown[]
    completedStages: string[]
    currentStage: string
  }
  setEmails: ReturnType<typeof vi.fn>
  markStageComplete: ReturnType<typeof vi.fn>
  setStage: ReturnType<typeof vi.fn>
}

vi.mock('@/hooks/useProfile', () => ({
  useProfile: () => useProfileMock(),
}))

vi.mock('@/hooks/useBilling', () => ({
  useBilling: () => useBillingMock(),
  useCredits: () => useCreditsMock(),
}))

vi.mock('@/hooks/useLangGraph', () => ({
  useLangGraphRequests: () => useLangGraphRequestsMock(),
}))

vi.mock('@/hooks/useSearches', () => ({
  useSearches: () => useSearchesMock(),
}))

vi.mock('@/hooks/useLeads', () => ({
  useUserLeads: () => useUserLeadsMock(),
}))

vi.mock('@/hooks/base/useSearchesBase', () => ({
  useSearchesBase: () => useSearchesMock(),
  useSearchBase: vi.fn(),
  useGoogleMapsSearchBase: vi.fn(),
}))

vi.mock('@/hooks/base/useLeadsBase', () => ({
  useLeadsBase: vi.fn(),
  useLeadBase: vi.fn(),
  useUserLeadsBase: () => useUserLeadsMock(),
}))

vi.mock('@/hooks/base/useStatusBroadcastsBase', () => ({
  useStatusBroadcastsBase: () => useStatusBroadcastsMock(),
  useSearchBroadcastsBase: vi.fn(),
  useBatchBroadcastsBase: vi.fn(),
  useCreditBroadcastsBase: vi.fn(),
}))

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => useAuthMock(),
}))

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: toastMock }),
}))

vi.mock('@/pipeline/context', () => ({
  PipelineProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  usePipeline: () => pipelineValue,
}))

vi.mock('@/components/pipeline/PipelineOrchestrator', () => ({
  PipelineOrchestrator: () => <div data-testid="pipeline-orchestrator" />, 
}))

vi.mock('@/components/LeadSearchHistory', () => ({
  LeadSearchHistory: () => <div data-testid="search-history">Search history content</div>,
}))

vi.mock('@/components/BusinessProfileWizard', () => ({
  BusinessProfileWizard: () => (
    <div data-testid="profile-wizard">Business profile wizard</div>
  ),
}))

vi.mock('@/components/CreditManager', () => ({
  CreditManager: ({ currentCredits }: { currentCredits: number }) => (
    <div data-testid="credit-manager">Credits: {currentCredits}</div>
  ),
}))

vi.mock('@/components/AdminDashboard', () => ({
  AdminDashboard: () => <div data-testid="admin-dashboard">Admin dashboard</div>,
}))

vi.mock('@/components/DashboardOverview', () => ({
  DashboardOverview: ({
    onNavigate,
  }: {
    onNavigate: (tab: string) => void
  }) => (
    <div data-testid="dashboard-overview">
      Dashboard overview
      <button onClick={() => onNavigate('pipeline')}>Open pipeline</button>
    </div>
  ),
}))

vi.mock('@/components/PerformanceWorkspace', () => ({
  PerformanceWorkspace: () => (
    <div data-testid="performance-workspace">Performance workspace</div>
  ),
}))

vi.mock('@/components/Settings', () => ({
  Settings: () => <div data-testid="settings-panel">Settings panel</div>,
}))

beforeEach(() => {
  vi.clearAllMocks()

  pipelineValue = {
    state: {
      generatedEmails: [],
      completedStages: [],
      currentStage: 'source_selection',
    },
    setEmails: vi.fn(),
    markStageComplete: vi.fn(),
    setStage: vi.fn(),
  }

  const now = Date.now()

  useProfileMock.mockReturnValue({
    profile: {
      _id: 'profile-1',
      userId: 'user-1',
      isComplete: true,
      companyName: 'Test Company',
    },
    isComplete: true,
    isLoading: false,
    hasProfile: true,
  })

  useCreditsMock.mockReturnValue({
    balance: { credits: 100 },
    transactions: [],
    isLoading: false,
  })

  useBillingMock.mockReturnValue({
    billing: { activePlan: 'professional' },
    usage: {
      currentPeriodUsage: 12,
      totalCreditsUsed: 42,
      avgCostPerLead: 1.5,
      emailsGenerated: 5,
    },
    transactions: [],
    purchaseCredits: vi.fn(),
    createCheckoutSession: vi.fn(),
    cancelSubscription: vi.fn(),
    isLoading: false,
  })

  useLangGraphRequestsMock.mockReturnValue({
    requests: [],
    isLoading: false,
  })

  useSearchesMock.mockReturnValue({
    searches: [
      {
        _id: 'search-1',
        name: 'AI Agencies in SF',
        status: 'completed',
        _creationTime: now,
        parameters: { location: 'San Francisco', keywords: ['AI'] },
        results: { totalFound: 8 },
      },
    ],
    isLoading: false,
  })

  useUserLeadsMock.mockReturnValue({
    stats: { totalLeads: 24 },
    isLoading: false,
  })

  useStatusBroadcastsMock.mockReturnValue({
    broadcasts: [],
    urgentBroadcasts: [],
    searchBroadcasts: [],
    creditBroadcasts: [],
    rateLimitWarnings: [],
    systemAlerts: [],
    getByType: vi.fn().mockReturnValue([]),
    getByTags: vi.fn().mockReturnValue([]),
    acknowledgeBroadcast: vi.fn(),
    markAsRead: vi.fn(),
    isLoading: false,
    hasUrgent: false,
    needsAcknowledgment: 0,
    unreadCount: 0,
    urgentUnreadCount: 0,
    isConnected: true,
    latestStatus: null,
  })

  useAuthMock.mockReturnValue({
    user: {
      _id: 'user-1',
      credits: 150,
      plan: 'professional',
      role: 'user',
    },
    isAuthenticated: true,
    isLoading: false,
  })
})

describe('GenniApp', () => {
  it('renders the dashboard shell with user controls', () => {
    render(<GenniApp />)

    expect(screen.getByRole('heading', { name: /genni/i })).toBeInTheDocument()
    expect(
      screen.getByText(/ai-powered lead generation/i),
    ).toBeInTheDocument()
    expect(screen.getByTestId('mobile-menu-button')).toBeInTheDocument()
    expect(screen.getByTestId('user-button')).toBeInTheDocument()
  })

  it('shows the onboarding wizard when the business profile is incomplete', () => {
    useProfileMock.mockReturnValueOnce({
      profile: null,
      isComplete: false,
      isLoading: false,
      hasProfile: false,
    })

    render(<GenniApp />)

    expect(screen.getByTestId('profile-wizard')).toBeInTheDocument()
  })

  it('renders the dashboard overview by default', () => {
    render(<GenniApp />)

    expect(screen.getByTestId('dashboard-overview')).toBeInTheDocument()
  })

  it('opens the pipeline orchestrator when the pipeline tab is selected', () => {
    render(<GenniApp />)

    const pipelineTab = screen.getByRole('button', { name: /lead pipeline/i })
    fireEvent.click(pipelineTab)

    expect(screen.getByTestId('pipeline-orchestrator')).toBeInTheDocument()
  })

  it('navigates to search history when the tab is selected', () => {
    render(<GenniApp />)

    const tab = screen.getByRole('button', { name: /search history/i })
    fireEvent.click(tab)

    expect(screen.getByTestId('search-history')).toBeInTheDocument()
  })

  it('falls back to user credits when balance data is unavailable', () => {
    useCreditsMock.mockReturnValueOnce({
      balance: undefined,
      transactions: [],
      isLoading: false,
    })

    useAuthMock.mockReturnValueOnce({
      user: {
        _id: 'user-1',
        credits: 75,
        plan: 'starter',
        role: 'user',
      },
      isAuthenticated: true,
      isLoading: false,
    })

    render(<GenniApp />)

    const performanceButton = screen.getByRole('button', {
      name: /performance workspace/i,
    })

    expect(performanceButton).toHaveTextContent('75')
  })
})

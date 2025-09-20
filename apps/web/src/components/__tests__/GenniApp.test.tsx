import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import * as convexReact from 'convex/react'
import { ClerkProvider } from '@clerk/clerk-react'
import { ConvexReactClient, ConvexProvider } from 'convex/react'
import { mockUser, mockBusinessProfile, mockSearch, mockLead } from '../../test/setup'
import { GenniApp } from '../GenniApp'

vi.mock('convex/react', async () => {
  const actual = await vi.importActual('convex/react')
  return {
    ...actual,
    useQuery: vi.fn(),
    useMutation: vi.fn(),
    useAction: vi.fn(),
  }
})

// Get references to the mocked functions
const mockUseQuery = convexReact.useQuery as unknown as Mock
const mockUseMutation = convexReact.useMutation as unknown as Mock
const mockUseAction = convexReact.useAction as unknown as Mock

// Mock the ConvexReactClient
const mockConvexClient = new ConvexReactClient(process.env.VITE_CONVEX_URL || 'https://test.convex.cloud')

// Test wrapper component
const TestWrapper = ({ children }: { children: React.ReactNode }) => (
  <ClerkProvider publishableKey="test-key">
    <ConvexProvider client={mockConvexClient}>
      {children}
    </ConvexProvider>
  </ClerkProvider>
)

describe('GenniApp Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Default mock implementations
    mockUseQuery.mockImplementation((api) => {
      if (api === 'users:getCurrentUser') return mockUser
      if (api === 'profile:get') return mockBusinessProfile
      if (api === 'searches:getUserSearches') return [mockSearch]
      if (api === 'leads:getBySearch') return [mockLead]
      return null
    })

    mockUseMutation.mockReturnValue(vi.fn().mockResolvedValue({}))
    mockUseAction.mockReturnValue(vi.fn().mockResolvedValue({}))
  })

  describe('Application Loading and Authentication', () => {
    it('renders loading state when user data is not loaded', () => {
      mockUseQuery.mockReturnValue(undefined)

      render(
        <TestWrapper>
          <GenniApp />
        </TestWrapper>
      )

      expect(screen.getByText(/loading/i)).toBeInTheDocument()
    })

    it('renders main application when user is authenticated and loaded', () => {
      render(
        <TestWrapper>
          <GenniApp />
        </TestWrapper>
      )

      expect(screen.getByText(/genni/i)).toBeInTheDocument()
      expect(screen.getByTestId('user-button')).toBeInTheDocument()
    })

    it('displays user credits in the navigation', () => {
      render(
        <TestWrapper>
          <GenniApp />
        </TestWrapper>
      )

      expect(screen.getByText(/100/)).toBeInTheDocument() // User credits
    })
  })

  describe('Business Profile Setup', () => {
    it('shows profile setup wizard when profile is incomplete', () => {
      mockUseQuery.mockImplementation((api) => {
        if (api === 'users:getCurrentUser') return mockUser
        if (api === 'profile:get') return { ...mockBusinessProfile, isComplete: false }
        return null
      })

      render(
        <TestWrapper>
          <GenniApp />
        </TestWrapper>
      )

      expect(screen.getByText(/complete your profile/i)).toBeInTheDocument()
    })

    it('shows main dashboard when profile is complete', () => {
      render(
        <TestWrapper>
          <GenniApp />
        </TestWrapper>
      )

      expect(screen.getByText(/dashboard/i)).toBeInTheDocument()
    })
  })

  describe('Search Functionality', () => {
    it('displays recent searches in the dashboard', () => {
      render(
        <TestWrapper>
          <GenniApp />
        </TestWrapper>
      )

      expect(screen.getByText('Test Search')).toBeInTheDocument()
      expect(screen.getByText(/25.*found/i)).toBeInTheDocument()
    })

    it('allows creating a new search', async () => {
      const mockCreateSearch = vi.fn().mockResolvedValue({ _id: 'new-search-id' })
      mockUseMutation.mockReturnValue(mockCreateSearch)

      render(
        <TestWrapper>
          <GenniApp />
        </TestWrapper>
      )

      const newSearchButton = screen.getByText(/new search/i)
      fireEvent.click(newSearchButton)

      expect(screen.getByText(/create.*search/i)).toBeInTheDocument()
    })

    it('shows search progress for active searches', () => {
      const activeSearch = {
        ...mockSearch,
        status: 'in_progress' as const,
        progress: { discovered: 10, enriched: 5, analyzed: 2, total: 50 }
      }

      mockUseQuery.mockImplementation((api) => {
        if (api === 'users:getCurrentUser') return mockUser
        if (api === 'profile:get') return mockBusinessProfile
        if (api === 'searches:getUserSearches') return [activeSearch]
        return null
      })

      render(
        <TestWrapper>
          <GenniApp />
        </TestWrapper>
      )

      expect(screen.getByText(/in progress/i)).toBeInTheDocument()
      expect(screen.getByText(/10.*discovered/i)).toBeInTheDocument()
    })
  })

  describe('Lead Management', () => {
    it('displays leads for selected search', async () => {
      render(
        <TestWrapper>
          <GenniApp />
        </TestWrapper>
      )

      // Click on a search to view leads
      const searchItem = screen.getByText('Test Search')
      fireEvent.click(searchItem)

      await waitFor(() => {
        expect(screen.getByText('TechFlow Solutions')).toBeInTheDocument()
      })

      expect(screen.getByText(/0\.92/)).toBeInTheDocument() // Relevance score
    })

    it('shows lead contact information', async () => {
      render(
        <TestWrapper>
          <GenniApp />
        </TestWrapper>
      )

      const searchItem = screen.getByText('Test Search')
      fireEvent.click(searchItem)

      await waitFor(() => {
        expect(screen.getByText('contact@techflowsolutions.com')).toBeInTheDocument()
      })

      expect(screen.getByText('Sarah Chen')).toBeInTheDocument()
      expect(screen.getByText('CEO')).toBeInTheDocument()
    })

    it('displays generated email content', async () => {
      render(
        <TestWrapper>
          <GenniApp />
        </TestWrapper>
      )

      const searchItem = screen.getByText('Test Search')
      fireEvent.click(searchItem)

      await waitFor(() => {
        expect(screen.getByText(/Transform Your Manual Processes/i)).toBeInTheDocument()
      })
    })
  })

  describe('Error Handling', () => {
    it('handles API errors gracefully', () => {
      mockUseQuery.mockImplementation(() => {
        throw new Error('API Error')
      })

      render(
        <TestWrapper>
          <GenniApp />
        </TestWrapper>
      )

      expect(screen.getByText(/error.*loading/i)).toBeInTheDocument()
    })

    it('shows appropriate message when no searches exist', () => {
      mockUseQuery.mockImplementation((api) => {
        if (api === 'users:getCurrentUser') return mockUser
        if (api === 'profile:get') return mockBusinessProfile
        if (api === 'searches:getUserSearches') return []
        return null
      })

      render(
        <TestWrapper>
          <GenniApp />
        </TestWrapper>
      )

      expect(screen.getByText(/no searches.*yet/i)).toBeInTheDocument()
    })

    it('shows appropriate message when no leads exist for a search', () => {
      mockUseQuery.mockImplementation((api) => {
        if (api === 'users:getCurrentUser') return mockUser
        if (api === 'profile:get') return mockBusinessProfile
        if (api === 'searches:getUserSearches') return [mockSearch]
        if (api === 'leads:getBySearch') return []
        return null
      })

      render(
        <TestWrapper>
          <GenniApp />
        </TestWrapper>
      )

      const searchItem = screen.getByText('Test Search')
      fireEvent.click(searchItem)

      expect(screen.getByText(/no leads.*found/i)).toBeInTheDocument()
    })
  })

  describe('Responsive Behavior', () => {
    it('adapts layout for mobile devices', () => {
      // Mock mobile viewport
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: 375,
      })

      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: vi.fn().mockImplementation(query => ({
          matches: query === '(max-width: 768px)',
          media: query,
          onchange: null,
          addListener: vi.fn(),
          removeListener: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
        })),
      })

      render(
        <TestWrapper>
          <GenniApp />
        </TestWrapper>
      )

      // Should show mobile navigation
      expect(screen.getByTestId('mobile-menu-button')).toBeInTheDocument()
    })
  })

  describe('Performance Metrics', () => {
    it('tracks component render time', () => {
      const startTime = performance.now()

      render(
        <TestWrapper>
          <GenniApp />
        </TestWrapper>
      )

      const renderTime = performance.now() - startTime
      expect(renderTime).toBeLessThan(100) // Should render within 100ms
    })

    it('handles large datasets efficiently', () => {
      // Create a large dataset
      const manyLeads = Array.from({ length: 100 }, (_, i) => ({
        ...mockLead,
        _id: `lead-${i}`,
        businessName: `Company ${i}`,
      }))

      mockUseQuery.mockImplementation((api) => {
        if (api === 'users:getCurrentUser') return mockUser
        if (api === 'profile:get') return mockBusinessProfile
        if (api === 'searches:getUserSearches') return [mockSearch]
        if (api === 'leads:getBySearch') return manyLeads
        return null
      })

      const startTime = performance.now()

      render(
        <TestWrapper>
          <GenniApp />
        </TestWrapper>
      )

      const renderTime = performance.now() - startTime
      expect(renderTime).toBeLessThan(500) // Should handle large datasets efficiently
    })
  })

  describe('Accessibility', () => {
    it('provides proper ARIA labels', () => {
      render(
        <TestWrapper>
          <GenniApp />
        </TestWrapper>
      )

      expect(screen.getByLabelText(/main navigation/i)).toBeInTheDocument()
      expect(screen.getByRole('main')).toBeInTheDocument()
    })

    it('supports keyboard navigation', () => {
      render(
        <TestWrapper>
          <GenniApp />
        </TestWrapper>
      )

      const newSearchButton = screen.getByText(/new search/i)

      // Should be focusable
      newSearchButton.focus()
      expect(document.activeElement).toBe(newSearchButton)

      // Should respond to Enter key
      fireEvent.keyDown(newSearchButton, { key: 'Enter', code: 'Enter' })
      expect(screen.getByText(/create.*search/i)).toBeInTheDocument()
    })

    it('provides screen reader friendly content', () => {
      render(
        <TestWrapper>
          <GenniApp />
        </TestWrapper>
      )

      // Should have proper headings hierarchy
      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()

      // Should have descriptive text for screen readers
      expect(screen.getByText(/dashboard.*overview/i)).toBeInTheDocument()
    })
  })

  describe('Integration with External Services', () => {
    it('handles Google Maps integration', async () => {
      render(
        <TestWrapper>
          <GenniApp />
        </TestWrapper>
      )

      const newSearchButton = screen.getByText(/new search/i)
      fireEvent.click(newSearchButton)

      // Should show location input with Google Maps autocomplete
      await waitFor(() => {
        expect(screen.getByPlaceholderText(/enter location/i)).toBeInTheDocument()
      })
    })

    it('handles real-time updates from Convex', async () => {
      let searchData = mockSearch

      mockUseQuery.mockImplementation((api) => {
        if (api === 'users:getCurrentUser') return mockUser
        if (api === 'profile:get') return mockBusinessProfile
        if (api === 'searches:getUserSearches') return [searchData]
        return null
      })

      const { rerender } = render(
        <TestWrapper>
          <GenniApp />
        </TestWrapper>
      )

      expect(screen.getByText(/completed/i)).toBeInTheDocument()

      // Simulate real-time update
      searchData = { ...mockSearch, status: 'in_progress' as const }

      rerender(
        <TestWrapper>
          <GenniApp />
        </TestWrapper>
      )

      expect(screen.getByText(/in progress/i)).toBeInTheDocument()
    })
  })
})
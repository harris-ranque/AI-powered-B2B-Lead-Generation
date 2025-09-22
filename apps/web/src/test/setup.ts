import '@testing-library/jest-dom'
import { vi } from 'vitest'
import React from 'react'

// Mock pricing config
vi.mock('../lib/pricing-config', () => ({
  PRICING_CONFIG: {
    starter: { monthly: 99, yearly: 990 },
    professional: { monthly: 199, yearly: 1990 },
    business: { monthly: 399, yearly: 3990 },
    enterprise: { monthly: 999, yearly: 9990 }
  }
}))

// Mock Clerk authentication
vi.mock('@clerk/clerk-react', () => ({
  useUser: () => ({
    user: {
      id: 'test-user-id',
      emailAddresses: [{ emailAddress: 'test@example.com' }],
      firstName: 'Test',
      lastName: 'User'
    },
    isLoaded: true,
    isSignedIn: true
  }),
  useAuth: () => ({
    isLoaded: true,
    isSignedIn: true,
    userId: 'test-user-id',
    sessionId: 'test-session-id',
    signOut: vi.fn(),
    getToken: vi.fn().mockResolvedValue('test-token')
  }),
  useClerk: () => ({
    signOut: vi.fn(),
    openSignIn: vi.fn(),
    openSignUp: vi.fn(),
    session: {
      id: 'test-session-id',
      user: {
        id: 'test-user-id',
        emailAddresses: [{ emailAddress: 'test@example.com' }]
      }
    }
  }),
  ClerkProvider: ({ children }: { children: React.ReactNode }) => children,
  SignInButton: ({ children }: { children: React.ReactNode }) => children,
  SignOutButton: ({ children }: { children: React.ReactNode }) => children,
  UserButton: () => React.createElement('div', { 'data-testid': 'user-button' }, 'User Button')
}))

// Convex function references fall back to runtime stubs provided by packages/convex-types.
// Mock Convex React
vi.mock('convex/react', () => ({
  useQuery: vi.fn(() => null),
  useMutation: vi.fn(() => vi.fn()),
  useAction: vi.fn(() => vi.fn()),
  ConvexProvider: ({ children }: { children: React.ReactNode }) => children,
  ConvexReactClient: vi.fn()
}))

// Mock Google Maps
vi.mock('@googlemaps/js-api-loader', () => ({
  Loader: vi.fn().mockImplementation(() => ({
    load: vi.fn().mockResolvedValue({
      maps: {
        Map: vi.fn(),
        places: {
          AutocompleteService: vi.fn(),
          PlacesService: vi.fn()
        }
      }
    })
  }))
}))

// Mock IntersectionObserver
global.IntersectionObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn()
}))

// Mock ResizeObserver
global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn()
}))

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
})

// Mock window.scrollTo
Object.defineProperty(window, 'scrollTo', {
  writable: true,
  value: vi.fn()
})

// Global test data
export const mockUser = {
  id: 'test-user-id',
  email: 'test@example.com',
  name: 'Test User',
  credits: 100,
  plan: 'pro' as const,
  role: 'user' as const,
  isActive: true,
  createdAt: Date.now(),
  updatedAt: Date.now()
}

export const mockBusinessProfile = {
  _id: 'test-profile-id',
  userId: 'test-user-id',
  companyName: 'Test Company',
  industry: 'Technology',
  valueProposition: 'We help businesses grow with AI',
  services: ['AI Consulting', 'Automation'],
  targetMarkets: ['B2B', 'SaaS'],
  keyDifferentiators: ['AI-powered', 'Fast implementation'],
  contactInfo: {
    email: 'hello@testcompany.com',
    website: 'https://testcompany.com'
  },
  isComplete: true,
  createdAt: Date.now(),
  updatedAt: Date.now()
}

export const mockSearch = {
  _id: 'test-search-id',
  userId: 'test-user-id',
  name: 'Test Search',
  parameters: {
    location: 'San Francisco, CA',
    radius: 25,
    keywords: ['SaaS', 'technology'],
    maxResults: 50
  },
  status: 'completed' as const,
  progress: {
    discovered: 25,
    enriched: 20,
    analyzed: 15,
    total: 25
  },
  results: {
    totalFound: 25,
    enrichedCount: 20,
    analyzedCount: 15,
    avgRelevanceScore: 0.78
  },
  creditsUsed: 15,
  createdAt: Date.now(),
  completedAt: Date.now()
}

export const mockLead = {
  _id: 'test-lead-id',
  searchId: 'test-search-id',
  userId: 'test-user-id',
  businessName: 'TechFlow Solutions',
  address: '123 Tech St, San Francisco, CA 94105',
  phone: '+1-555-0123',
  website: 'https://techflowsolutions.com',
  rating: 4.5,
  reviewCount: 42,
  category: 'Software Company',
  placeId: 'test-place-id',
  location: {
    lat: 37.7749,
    lng: -122.4194,
    formattedAddress: '123 Tech St, San Francisco, CA 94105',
    city: 'San Francisco',
    state: 'CA',
    country: 'USA',
    postalCode: '94105'
  },
  enrichmentStatus: 'completed' as const,
  contactInfo: {
    emails: [
      {
        email: 'contact@techflowsolutions.com',
        type: 'general',
        confidence: 0.9
      }
    ],
    contacts: [
      {
        name: 'Sarah Chen',
        title: 'CEO',
        email: 'sarah@techflowsolutions.com',
        confidence: 0.85
      }
    ]
  },
  aiAnalysis: {
    relevanceScore: 0.92,
    painPoints: ['Manual processes', 'Scaling challenges'],
    valueMatches: ['Automation tools', 'AI solutions'],
    confidence: 0.88,
    processingTime: 12.5
  },
  emailContent: {
    subject: 'Transform Your Manual Processes with AI Automation',
    body: 'Hi Sarah,\n\nI noticed TechFlow Solutions...',
    personalizationNotes: ['CEO title', 'Company focus on automation'],
    estimatedEffectiveness: 0.86
  },
  status: 'qualified' as const,
  tags: ['high-priority', 'tech'],
  createdAt: Date.now(),
  updatedAt: Date.now()
}
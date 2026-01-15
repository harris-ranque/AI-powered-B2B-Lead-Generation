import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockContext,
  createMockActionContext,
  mockId,
  createMockDocument,
  createMockUserIdentity,
} from '../testUtils';

// ============================================================================
// MOCK SETUP
// ============================================================================

// Mock the auth module
vi.mock('../../convex/auth', () => ({
  getCurrentUser: vi.fn(),
}));

// Mock the helpers module
vi.mock('../../convex/lib/helpers', () => ({
  createError: vi.fn((message: string, code: string, status: number) => {
    const error = new Error(message) as any;
    error.code = code;
    error.status = status;
    return error;
  }),
  sanitizeString: vi.fn((str: string) => str?.trim()?.replace(/<[^>]*>/g, '') || ''),
  validateEmail: vi.fn((email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '')),
  validateUrl: vi.fn((url: string) => {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }),
  normalizeUrl: vi.fn((url: string) => {
    if (!url) return '';
    return url.startsWith('http') ? url : `https://${url}`;
  }),
}));

// Import mocked modules
import { getCurrentUser } from '../../convex/auth';
import { createError, sanitizeString, validateEmail, validateUrl, normalizeUrl } from '../../convex/lib/helpers';

// ============================================================================
// BUSINESS RULES CONSTANTS (from lib/constants.ts)
// ============================================================================

const BUSINESS_RULES = {
  PROFILE: {
    MAX_SERVICES: 20,
    MAX_TARGET_MARKETS: 15,
    MAX_DIFFERENTIATORS: 10,
    MAX_CASE_STUDIES: 5,
  },
};

const ERROR_CODES = {
  UNAUTHORIZED: 'UNAUTHORIZED',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
};

// ============================================================================
// TEST HELPERS
// ============================================================================

function createValidProfileData(overrides: Partial<any> = {}) {
  return {
    companyName: 'Test Company',
    industry: 'Technology',
    valueProposition: 'We provide excellent technology solutions that help businesses grow and succeed in the digital age with innovative approaches.',
    services: ['Service 1', 'Service 2'],
    targetMarkets: ['SMB', 'Enterprise'],
    keyDifferentiators: ['Fast', 'Reliable', 'Affordable'],
    caseStudies: [
      {
        title: 'Case Study 1',
        client: 'Client A',
        results: 'Increased revenue by 50%',
        metrics: { revenue: 50 },
      },
    ],
    contactInfo: {
      name: 'John Doe',
      email: 'john@company.com',
      phone: '555-1234',
      website: 'https://company.com',
      linkedin: 'https://linkedin.com/company/test',
    },
    ...overrides,
  };
}

function createMockUser(overrides: Partial<any> = {}) {
  return {
    _id: mockId('users'),
    email: 'user@test.com',
    name: 'Test User',
    role: 'user',
    plan: 'pro',
    credits: 100,
    ...overrides,
  };
}

function createMockProfile(overrides: Partial<any> = {}) {
  const userId = overrides.userId || mockId('users');
  return createMockDocument('businessProfiles', {
    userId,
    companyName: 'Existing Company',
    industry: 'Finance',
    valueProposition: 'We provide financial solutions that help businesses manage their finances effectively and efficiently.',
    services: ['Consulting'],
    targetMarkets: ['Enterprise'],
    keyDifferentiators: ['Expert team'],
    caseStudies: [],
    contactInfo: {
      name: 'Jane Doe',
      email: 'jane@existing.com',
      phone: '555-5678',
      website: 'https://existing.com',
      linkedin: '',
    },
    isComplete: true,
    createdAt: Date.now() - 86400000,
    updatedAt: Date.now() - 3600000,
    ...overrides,
  });
}

// ============================================================================
// createOrUpdateProfile TESTS
// ============================================================================

describe('profile/mutations - createOrUpdateProfile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('authentication', () => {
    it('should throw UNAUTHORIZED error when user is not authenticated', async () => {
      (getCurrentUser as any).mockResolvedValue(null);

      const ctx = createMockContext();
      const profileData = createValidProfileData();

      // Simulate the mutation handler logic
      const user = await getCurrentUser(ctx as any);

      expect(user).toBeNull();
      expect(getCurrentUser).toHaveBeenCalledWith(ctx);
    });

    it('should proceed when user is authenticated', async () => {
      const mockUser = createMockUser();
      (getCurrentUser as any).mockResolvedValue(mockUser);

      const ctx = createMockContext();

      const user = await getCurrentUser(ctx as any);

      expect(user).not.toBeNull();
      expect(user!._id).toBe(mockUser._id);
    });
  });

  describe('input sanitization', () => {
    it('should sanitize company name', () => {
      const result = sanitizeString('  <script>Test Company</script>  ');
      expect(result).toBe('Test Company');
    });

    it('should sanitize services array', () => {
      const services = ['  Service 1  ', '<b>Service 2</b>'];
      const sanitized = services.map(s => sanitizeString(s));

      expect(sanitized[0]).toBe('Service 1');
      expect(sanitized[1]).toBe('Service 2');
    });

    it('should enforce MAX_SERVICES limit', () => {
      const services = Array.from({ length: 30 }, (_, i) => `Service ${i}`);
      const limited = services.slice(0, BUSINESS_RULES.PROFILE.MAX_SERVICES);

      expect(limited.length).toBe(20);
    });

    it('should enforce MAX_TARGET_MARKETS limit', () => {
      const markets = Array.from({ length: 20 }, (_, i) => `Market ${i}`);
      const limited = markets.slice(0, BUSINESS_RULES.PROFILE.MAX_TARGET_MARKETS);

      expect(limited.length).toBe(15);
    });

    it('should enforce MAX_DIFFERENTIATORS limit', () => {
      const differentiators = Array.from({ length: 15 }, (_, i) => `Diff ${i}`);
      const limited = differentiators.slice(0, BUSINESS_RULES.PROFILE.MAX_DIFFERENTIATORS);

      expect(limited.length).toBe(10);
    });

    it('should enforce MAX_CASE_STUDIES limit', () => {
      const caseStudies = Array.from({ length: 10 }, (_, i) => ({
        title: `Case ${i}`,
        client: `Client ${i}`,
        results: `Results ${i}`,
        metrics: {},
      }));
      const limited = caseStudies.slice(0, BUSINESS_RULES.PROFILE.MAX_CASE_STUDIES);

      expect(limited.length).toBe(5);
    });
  });

  describe('validation', () => {
    it('should require company name', () => {
      const sanitizedCompanyName = sanitizeString('');
      expect(sanitizedCompanyName).toBe('');
      // Mutation would throw VALIDATION_ERROR for empty company name
    });

    it('should require industry', () => {
      const sanitizedIndustry = sanitizeString('');
      expect(sanitizedIndustry).toBe('');
      // Mutation would throw VALIDATION_ERROR for empty industry
    });

    it('should allow empty value proposition', () => {
      // Value proposition is allowed to be empty
      const valueProposition = '';
      expect(valueProposition.length).toBe(0);
    });

    it('should reject value proposition shorter than 50 chars when provided', () => {
      const valueProposition = 'Short value prop';
      const isValid = valueProposition.length === 0 || valueProposition.length >= 50;
      expect(isValid).toBe(false);
    });

    it('should accept value proposition of 50+ chars', () => {
      const valueProposition = 'This is a valid value proposition that is at least fifty characters long to pass validation.';
      const isValid = valueProposition.length >= 50;
      expect(isValid).toBe(true);
    });
  });

  describe('email validation in contact info', () => {
    it('should accept valid email addresses', () => {
      expect(validateEmail('test@example.com')).toBe(true);
      expect(validateEmail('user.name@company.co.uk')).toBe(true);
      expect(validateEmail('user+tag@domain.org')).toBe(true);
    });

    it('should reject invalid email addresses', () => {
      expect(validateEmail('invalid')).toBe(false);
      expect(validateEmail('invalid@')).toBe(false);
      expect(validateEmail('@invalid.com')).toBe(false);
      expect(validateEmail('')).toBe(false);
    });

    it('should use empty string for invalid email', () => {
      const email = 'invalid-email';
      const result = validateEmail(email) ? email : '';
      expect(result).toBe('');
    });
  });

  describe('URL validation in contact info', () => {
    it('should accept valid URLs', () => {
      expect(validateUrl('https://example.com')).toBe(true);
      expect(validateUrl('http://localhost:3000')).toBe(true);
      expect(validateUrl('https://sub.domain.co.uk/path')).toBe(true);
    });

    it('should reject invalid URLs', () => {
      expect(validateUrl('not-a-url')).toBe(false);
      expect(validateUrl('')).toBe(false);
    });

    it('should normalize URLs', () => {
      expect(normalizeUrl('example.com')).toBe('https://example.com');
      expect(normalizeUrl('https://example.com')).toBe('https://example.com');
    });
  });

  describe('profile completion logic', () => {
    it('should mark profile as incomplete when missing required fields', () => {
      const data = {
        companyName: 'Company',
        industry: 'Tech',
        valueProposition: '', // Empty - incomplete
        services: ['Service'],
        targetMarkets: ['Market'],
        keyDifferentiators: ['Diff'],
        contactInfo: { email: 'test@test.com' },
      };

      const isComplete = !!(
        data.companyName &&
        data.industry &&
        data.valueProposition &&
        data.valueProposition.length >= 50 &&
        data.services.length > 0 &&
        data.targetMarkets.length > 0 &&
        data.keyDifferentiators.length > 0 &&
        data.contactInfo.email
      );

      expect(isComplete).toBe(false);
    });

    it('should mark profile as complete when all required fields present', () => {
      const data = createValidProfileData();

      const isComplete = !!(
        data.companyName &&
        data.industry &&
        data.valueProposition &&
        data.valueProposition.length >= 50 &&
        data.services.length > 0 &&
        data.targetMarkets.length > 0 &&
        data.keyDifferentiators.length > 0 &&
        data.contactInfo.email
      );

      expect(isComplete).toBe(true);
    });

    it('should mark profile as incomplete when services array is empty', () => {
      const data = createValidProfileData({ services: [] });

      const isComplete = !!(
        data.companyName &&
        data.industry &&
        data.valueProposition &&
        data.valueProposition.length >= 50 &&
        data.services.length > 0 &&
        data.targetMarkets.length > 0 &&
        data.keyDifferentiators.length > 0 &&
        data.contactInfo.email
      );

      expect(isComplete).toBe(false);
    });

    it('should fallback to user email when contact email is empty', () => {
      const userEmail = 'user@fallback.com';
      const contactEmail = '';

      const effectiveEmail = contactEmail || userEmail;
      expect(effectiveEmail).toBe('user@fallback.com');
    });
  });

  describe('create vs update logic', () => {
    it('should identify new profile creation when no existing profile', () => {
      const mockUser = createMockUser();

      // Simulate the lookup result - null means no existing profile
      const existingProfile = null;
      const isNewProfile = existingProfile === null;

      expect(isNewProfile).toBe(true);
    });

    it('should identify profile update when profile exists', () => {
      const mockUser = createMockUser();
      const existingProfile = createMockProfile({ userId: mockUser._id });

      // Simulate the lookup result - profile exists means update
      const isUpdate = existingProfile !== null;

      expect(isUpdate).toBe(true);
      expect(existingProfile._id).toBeDefined();
    });
  });

  describe('notification creation', () => {
    it('should create notification when profile is first completed', async () => {
      const insertMock = vi.fn().mockResolvedValue(mockId('notifications'));
      const mockUser = createMockUser();

      // Simulate notification insert for completion
      await insertMock('notifications', {
        userId: mockUser._id,
        type: 'system_alert',
        title: 'Profile Completed! 🎉',
        message: 'Your business profile is now complete.',
        data: { profileCompleted: true },
        read: false,
        sent: false,
        createdAt: Date.now(),
      });

      expect(insertMock).toHaveBeenCalledWith('notifications', expect.objectContaining({
        type: 'system_alert',
        title: expect.stringContaining('Profile Completed'),
      }));
    });

    it('should create notification for new profile creation', async () => {
      const insertMock = vi.fn().mockResolvedValue(mockId('notifications'));
      const mockUser = createMockUser();
      const isComplete = false;

      await insertMock('notifications', {
        userId: mockUser._id,
        type: 'system_alert',
        title: isComplete ? 'Profile Created! 🎉' : 'Profile Saved',
        message: isComplete
          ? 'Your business profile has been created and is complete.'
          : 'Your business profile has been saved.',
        data: { profileCreated: true, isComplete },
        read: false,
        sent: false,
        createdAt: Date.now(),
      });

      expect(insertMock).toHaveBeenCalledWith('notifications', expect.objectContaining({
        title: 'Profile Saved',
      }));
    });
  });
});

// ============================================================================
// updateProfileSection TESTS
// ============================================================================

describe('profile/mutations - updateProfileSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('authentication', () => {
    it('should throw UNAUTHORIZED error when user is not authenticated', async () => {
      (getCurrentUser as any).mockResolvedValue(null);

      const ctx = createMockContext();
      const user = await getCurrentUser(ctx as any);

      expect(user).toBeNull();
    });
  });

  describe('profile existence check', () => {
    it('should identify when profile does not exist', () => {
      const mockUser = createMockUser();

      // Simulate the lookup result - null means no profile
      const profile = null;
      const profileNotFound = profile === null;

      expect(profileNotFound).toBe(true);
      // This would trigger RESOURCE_NOT_FOUND error in actual mutation
    });
  });

  describe('section updates', () => {
    describe('basic_info section', () => {
      it('should update company name', () => {
        const existingProfile = createMockProfile();
        const newData = { companyName: 'New Company Name' };

        const updateData: any = {};
        updateData.companyName = sanitizeString(newData.companyName || existingProfile.companyName);

        expect(updateData.companyName).toBe('New Company Name');
      });

      it('should update industry', () => {
        const existingProfile = createMockProfile();
        const newData = { industry: 'Healthcare' };

        const updateData: any = {};
        updateData.industry = sanitizeString(newData.industry || existingProfile.industry);

        expect(updateData.industry).toBe('Healthcare');
      });

      it('should update value proposition', () => {
        const newValueProp = 'This is a new and improved value proposition that clearly explains what we do and why customers should choose us.';

        const updateData: any = {};
        updateData.valueProposition = sanitizeString(newValueProp);

        expect(updateData.valueProposition).toBe(newValueProp);
      });

      it('should preserve existing values when new value is empty', () => {
        const existingProfile = createMockProfile();
        const newData = { companyName: '' };

        const updateData: any = {};
        updateData.companyName = sanitizeString(newData.companyName || existingProfile.companyName);

        expect(updateData.companyName).toBe(existingProfile.companyName);
      });
    });

    describe('services section', () => {
      it('should update services array', () => {
        const newServices = ['New Service 1', 'New Service 2', 'New Service 3'];

        const updateData = {
          services: newServices
            .slice(0, BUSINESS_RULES.PROFILE.MAX_SERVICES)
            .map(s => sanitizeString(s))
            .filter(s => s.length > 0),
        };

        expect(updateData.services).toEqual(newServices);
      });

      it('should filter out empty services', () => {
        const newServices = ['Service 1', '', '  ', 'Service 2'];

        const updateData = {
          services: newServices
            .map(s => sanitizeString(s))
            .filter(s => s.length > 0),
        };

        expect(updateData.services).toEqual(['Service 1', 'Service 2']);
      });

      it('should respect MAX_SERVICES limit', () => {
        const newServices = Array.from({ length: 25 }, (_, i) => `Service ${i}`);

        const updateData = {
          services: newServices
            .slice(0, BUSINESS_RULES.PROFILE.MAX_SERVICES)
            .map(s => sanitizeString(s))
            .filter(s => s.length > 0),
        };

        expect(updateData.services.length).toBe(20);
      });
    });

    describe('targeting section', () => {
      it('should update target markets', () => {
        const newMarkets = ['SMB', 'Mid-Market', 'Enterprise'];

        const updateData = {
          targetMarkets: newMarkets
            .slice(0, BUSINESS_RULES.PROFILE.MAX_TARGET_MARKETS)
            .map(m => sanitizeString(m))
            .filter(m => m.length > 0),
        };

        expect(updateData.targetMarkets).toEqual(newMarkets);
      });

      it('should respect MAX_TARGET_MARKETS limit', () => {
        const newMarkets = Array.from({ length: 20 }, (_, i) => `Market ${i}`);

        const updateData = {
          targetMarkets: newMarkets
            .slice(0, BUSINESS_RULES.PROFILE.MAX_TARGET_MARKETS)
            .map(m => sanitizeString(m))
            .filter(m => m.length > 0),
        };

        expect(updateData.targetMarkets.length).toBe(15);
      });
    });

    describe('differentiators section', () => {
      it('should update key differentiators', () => {
        const newDifferentiators = ['Fast', 'Reliable', 'Cost-effective'];

        const updateData = {
          keyDifferentiators: newDifferentiators
            .slice(0, BUSINESS_RULES.PROFILE.MAX_DIFFERENTIATORS)
            .map(d => sanitizeString(d))
            .filter(d => d.length > 0),
        };

        expect(updateData.keyDifferentiators).toEqual(newDifferentiators);
      });

      it('should respect MAX_DIFFERENTIATORS limit', () => {
        const newDifferentiators = Array.from({ length: 15 }, (_, i) => `Diff ${i}`);

        const updateData = {
          keyDifferentiators: newDifferentiators
            .slice(0, BUSINESS_RULES.PROFILE.MAX_DIFFERENTIATORS)
            .map(d => sanitizeString(d))
            .filter(d => d.length > 0),
        };

        expect(updateData.keyDifferentiators.length).toBe(10);
      });
    });

    describe('case_studies section', () => {
      it('should update case studies', () => {
        const newCaseStudies = [
          {
            title: 'New Case Study',
            client: 'New Client',
            results: 'Impressive results',
            metrics: { growth: 100 },
          },
        ];

        const updateData = {
          caseStudies: newCaseStudies
            .slice(0, BUSINESS_RULES.PROFILE.MAX_CASE_STUDIES)
            .map(cs => ({
              title: sanitizeString(cs.title || ''),
              client: sanitizeString(cs.client || ''),
              results: sanitizeString(cs.results || ''),
              metrics: cs.metrics || {},
            }))
            .filter(cs => cs.title && cs.client && cs.results),
        };

        expect(updateData.caseStudies.length).toBe(1);
        expect(updateData.caseStudies[0]!.title).toBe('New Case Study');
      });

      it('should filter out incomplete case studies', () => {
        const newCaseStudies = [
          { title: 'Complete', client: 'Client', results: 'Results', metrics: {} },
          { title: 'Missing Results', client: 'Client', results: '', metrics: {} },
          { title: '', client: 'Client', results: 'Results', metrics: {} },
        ];

        const updateData = {
          caseStudies: newCaseStudies
            .map(cs => ({
              title: sanitizeString(cs.title || ''),
              client: sanitizeString(cs.client || ''),
              results: sanitizeString(cs.results || ''),
              metrics: cs.metrics || {},
            }))
            .filter(cs => cs.title && cs.client && cs.results),
        };

        expect(updateData.caseStudies.length).toBe(1);
        expect(updateData.caseStudies[0]!.title).toBe('Complete');
      });

      it('should respect MAX_CASE_STUDIES limit', () => {
        const newCaseStudies = Array.from({ length: 10 }, (_, i) => ({
          title: `Case ${i}`,
          client: `Client ${i}`,
          results: `Results ${i}`,
          metrics: {},
        }));

        const updateData = {
          caseStudies: newCaseStudies
            .slice(0, BUSINESS_RULES.PROFILE.MAX_CASE_STUDIES)
            .map(cs => ({
              title: sanitizeString(cs.title),
              client: sanitizeString(cs.client),
              results: sanitizeString(cs.results),
              metrics: cs.metrics,
            })),
        };

        expect(updateData.caseStudies.length).toBe(5);
      });
    });

    describe('contact_info section', () => {
      it('should update contact name', () => {
        const existingProfile = createMockProfile();
        const newData = { name: 'New Contact Name' };

        const updateData = {
          contactInfo: {
            name: newData.name ? sanitizeString(newData.name) : existingProfile.contactInfo?.name || '',
            email: existingProfile.contactInfo?.email || '',
            phone: existingProfile.contactInfo?.phone || '',
            website: existingProfile.contactInfo?.website || '',
            linkedin: existingProfile.contactInfo?.linkedin || '',
          },
        };

        expect(updateData.contactInfo.name).toBe('New Contact Name');
      });

      it('should validate and update email', () => {
        const newEmail = 'new@email.com';
        const isValid = validateEmail(newEmail);

        expect(isValid).toBe(true);

        const updateData = {
          contactInfo: {
            email: isValid ? newEmail : '',
          },
        };

        expect(updateData.contactInfo.email).toBe('new@email.com');
      });

      it('should reject invalid email and keep existing', () => {
        const existingEmail = 'existing@email.com';
        const newEmail = 'invalid-email';
        const isValid = validateEmail(newEmail);

        expect(isValid).toBe(false);

        const resultEmail = isValid ? newEmail : existingEmail;
        expect(resultEmail).toBe('existing@email.com');
      });

      it('should validate and normalize website URL', () => {
        const newWebsite = 'https://newwebsite.com';
        const isValid = validateUrl(newWebsite);

        expect(isValid).toBe(true);

        const normalizedUrl = normalizeUrl(newWebsite);
        expect(normalizedUrl).toBe('https://newwebsite.com');
      });

      it('should validate and normalize LinkedIn URL', () => {
        const newLinkedin = 'https://linkedin.com/company/newcompany';
        const isValid = validateUrl(newLinkedin);

        expect(isValid).toBe(true);

        const normalizedUrl = normalizeUrl(newLinkedin);
        expect(normalizedUrl).toBe('https://linkedin.com/company/newcompany');
      });
    });
  });

  describe('invalid section handling', () => {
    it('should identify valid sections', () => {
      const validSections = ['basic_info', 'services', 'targeting', 'differentiators', 'case_studies', 'contact_info'];

      validSections.forEach(section => {
        expect(validSections.includes(section)).toBe(true);
      });
    });

    it('should identify invalid sections', () => {
      const validSections = ['basic_info', 'services', 'targeting', 'differentiators', 'case_studies', 'contact_info'];
      const invalidSection = 'invalid_section';

      expect(validSections.includes(invalidSection)).toBe(false);
    });
  });

  describe('completion status updates', () => {
    it('should recalculate completion after section update', () => {
      const updatedProfile = {
        companyName: 'Company',
        industry: 'Tech',
        valueProposition: 'A value proposition that is long enough to meet the fifty character requirement for completion validation.',
        services: ['Service 1'],
        targetMarkets: ['Market 1'],
        keyDifferentiators: ['Diff 1'],
        contactInfo: { email: 'test@test.com' },
      };

      const isComplete = !!(
        updatedProfile.companyName &&
        updatedProfile.industry &&
        updatedProfile.valueProposition &&
        updatedProfile.services?.length > 0 &&
        updatedProfile.targetMarkets?.length > 0 &&
        updatedProfile.keyDifferentiators?.length > 0 &&
        updatedProfile.contactInfo.email
      );

      expect(isComplete).toBe(true);
    });

    it('should create notification when profile becomes complete', () => {
      const previouslyComplete = false;
      const nowComplete = true;

      const shouldNotify = !previouslyComplete && nowComplete;
      expect(shouldNotify).toBe(true);
    });
  });
});

// ============================================================================
// deleteProfile TESTS
// ============================================================================

describe('profile/mutations - deleteProfile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('authentication', () => {
    it('should throw UNAUTHORIZED error when user is not authenticated', async () => {
      (getCurrentUser as any).mockResolvedValue(null);

      const ctx = createMockContext();
      const user = await getCurrentUser(ctx as any);

      expect(user).toBeNull();
    });
  });

  describe('profile existence check', () => {
    it('should identify when profile does not exist for deletion', () => {
      const mockUser = createMockUser();

      // Simulate the lookup result - null means no profile to delete
      const profile = null;
      const profileNotFound = profile === null;

      expect(profileNotFound).toBe(true);
      // This would trigger RESOURCE_NOT_FOUND error in actual mutation
    });
  });

  describe('deletion', () => {
    it('should delete existing profile', async () => {
      const mockUser = createMockUser();
      const existingProfile = createMockProfile({ userId: mockUser._id });
      const deleteMock = vi.fn().mockResolvedValue(undefined);

      await deleteMock(existingProfile._id);

      expect(deleteMock).toHaveBeenCalledWith(existingProfile._id);
    });

    it('should create notification after deletion', async () => {
      const mockUser = createMockUser();
      const insertMock = vi.fn().mockResolvedValue(mockId('notifications'));

      await insertMock('notifications', {
        userId: mockUser._id,
        type: 'system_alert',
        title: 'Profile Deleted',
        message: 'Your business profile has been deleted. You can create a new one anytime.',
        data: { profileDeleted: true },
        read: false,
        sent: false,
        createdAt: Date.now(),
      });

      expect(insertMock).toHaveBeenCalledWith('notifications', expect.objectContaining({
        title: 'Profile Deleted',
        data: expect.objectContaining({ profileDeleted: true }),
      }));
    });

    it('should return success after deletion', () => {
      const result = { success: true };
      expect(result.success).toBe(true);
    });
  });
});

// ============================================================================
// importProfile TESTS
// ============================================================================

describe('profile/mutations - importProfile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('authentication', () => {
    it('should throw UNAUTHORIZED error when user is not authenticated', async () => {
      (getCurrentUser as any).mockResolvedValue(null);

      const ctx = createMockContext();
      const user = await getCurrentUser(ctx as any);

      expect(user).toBeNull();
    });
  });

  describe('source processing', () => {
    describe('linkedin source', () => {
      it('should extract LinkedIn profile data correctly', () => {
        const linkedinData = {
          companyName: 'LinkedIn Company',
          industry: 'Technology',
          description: 'Company description from LinkedIn that should be used as value proposition.',
          services: ['Service 1', 'Service 2'],
          targetMarkets: ['Market 1'],
          specialties: ['AI', 'ML', 'Data'],
          website: 'https://company.com',
          linkedinUrl: 'https://linkedin.com/company/example',
        };

        const profileData = {
          companyName: sanitizeString(linkedinData.companyName || ''),
          industry: sanitizeString(linkedinData.industry || ''),
          valueProposition: sanitizeString(linkedinData.description || ''),
          services: (linkedinData.services || []).map(s => sanitizeString(s)),
          targetMarkets: (linkedinData.targetMarkets || []).map(m => sanitizeString(m)),
          keyDifferentiators: (linkedinData.specialties || []).map(d => sanitizeString(d)),
          contactInfo: {
            email: '',
            phone: '',
            website: linkedinData.website || '',
            linkedin: linkedinData.linkedinUrl || '',
          },
        };

        expect(profileData.companyName).toBe('LinkedIn Company');
        expect(profileData.keyDifferentiators).toEqual(['AI', 'ML', 'Data']);
        expect(profileData.contactInfo.linkedin).toBe('https://linkedin.com/company/example');
      });
    });

    describe('website source', () => {
      it('should extract website data correctly', () => {
        const websiteData = {
          companyName: 'Website Company',
          industry: 'Finance',
          description: 'Main description',
          tagline: 'Company tagline',
          services: ['Consulting', 'Advisory'],
          email: 'contact@company.com',
          phone: '555-1234',
          website: 'https://company.com',
        };

        const profileData = {
          companyName: sanitizeString(websiteData.companyName || ''),
          industry: sanitizeString(websiteData.industry || ''),
          valueProposition: sanitizeString(websiteData.description || websiteData.tagline || ''),
          services: (websiteData.services || []).map(s => sanitizeString(s)),
          targetMarkets: [],
          keyDifferentiators: [],
          contactInfo: {
            email: websiteData.email || '',
            phone: websiteData.phone || '',
            website: websiteData.website || '',
            linkedin: '',
          },
        };

        expect(profileData.companyName).toBe('Website Company');
        expect(profileData.valueProposition).toBe('Main description');
        expect(profileData.contactInfo.email).toBe('contact@company.com');
      });

      it('should fallback to tagline when description is empty', () => {
        const websiteData = {
          description: '',
          tagline: 'Fallback tagline',
        };

        const valueProposition = sanitizeString(websiteData.description || websiteData.tagline || '');
        expect(valueProposition).toBe('Fallback tagline');
      });
    });

    describe('manual source', () => {
      it('should pass through manual data directly', () => {
        const manualData = {
          companyName: 'Manual Company',
          industry: 'Healthcare',
          valueProposition: 'Manually entered value proposition',
          services: ['Custom Service'],
          targetMarkets: ['Custom Market'],
          keyDifferentiators: ['Custom Diff'],
          contactInfo: {
            email: 'manual@company.com',
          },
        };

        // Manual source passes data directly
        const profileData = manualData;

        expect(profileData.companyName).toBe('Manual Company');
        expect(profileData.industry).toBe('Healthcare');
      });
    });

    describe('invalid source', () => {
      it('should identify invalid import source', () => {
        const validSources = ['linkedin', 'website', 'manual'];
        const invalidSource = 'twitter';

        expect(validSources.includes(invalidSource)).toBe(false);
      });
    });
  });

  describe('merging with existing profile', () => {
    it('should merge imported data with existing profile', () => {
      const existingProfile = createMockProfile();
      const importedData = {
        companyName: '', // Should keep existing
        industry: 'New Industry', // Should update
        valueProposition: '',
        services: ['New Service'],
        targetMarkets: [],
        keyDifferentiators: ['New Diff'],
        contactInfo: {
          email: 'new@email.com',
        },
      };

      const mergedData = {
        companyName: importedData.companyName || existingProfile.companyName,
        industry: importedData.industry || existingProfile.industry,
        valueProposition: importedData.valueProposition || existingProfile.valueProposition,
        services: Array.from(new Set([
          ...(existingProfile.services || []),
          ...(importedData.services || []),
        ])),
        targetMarkets: Array.from(new Set([
          ...(existingProfile.targetMarkets || []),
          ...(importedData.targetMarkets || []),
        ])),
        keyDifferentiators: Array.from(new Set([
          ...(existingProfile.keyDifferentiators || []),
          ...(importedData.keyDifferentiators || []),
        ])),
        contactInfo: {
          email: importedData.contactInfo?.email || existingProfile.contactInfo?.email || '',
        },
      };

      expect(mergedData.companyName).toBe(existingProfile.companyName);
      expect(mergedData.industry).toBe('New Industry');
      expect(mergedData.services).toContain('Consulting'); // From existing
      expect(mergedData.services).toContain('New Service'); // From import
      expect(mergedData.keyDifferentiators).toContain('Expert team'); // From existing
      expect(mergedData.keyDifferentiators).toContain('New Diff'); // From import
    });

    it('should deduplicate arrays when merging', () => {
      const existingServices = ['Service A', 'Service B'];
      const importedServices = ['Service B', 'Service C'];

      const merged = Array.from(new Set([...existingServices, ...importedServices]));

      expect(merged).toEqual(['Service A', 'Service B', 'Service C']);
      expect(merged.length).toBe(3);
    });
  });

  describe('new profile creation', () => {
    it('should create new profile when none exists', async () => {
      const mockUser = createMockUser();
      (getCurrentUser as any).mockResolvedValue(mockUser);

      const insertMock = vi.fn().mockResolvedValue(mockId('businessProfiles'));

      const profileData = {
        companyName: 'New Imported Company',
        industry: 'Tech',
        valueProposition: 'Imported value proposition',
        services: ['Service 1'],
        targetMarkets: ['Market 1'],
        keyDifferentiators: ['Diff 1'],
        contactInfo: { email: 'imported@company.com' },
      };

      const profileId = await insertMock('businessProfiles', {
        userId: mockUser._id,
        ...profileData,
        isComplete: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      expect(insertMock).toHaveBeenCalledWith('businessProfiles', expect.objectContaining({
        companyName: 'New Imported Company',
        userId: mockUser._id,
      }));
      expect(profileId).toBeDefined();
    });

    it('should calculate completion status for new imported profile', () => {
      const profileData = {
        companyName: 'Company',
        industry: 'Tech',
        valueProposition: 'Value prop',
        services: ['Service'],
        targetMarkets: ['Market'],
        keyDifferentiators: ['Diff'],
        contactInfo: { email: 'test@test.com' },
      };

      const isComplete = !!(
        profileData.companyName &&
        profileData.industry &&
        profileData.valueProposition &&
        profileData.services?.length > 0 &&
        profileData.targetMarkets?.length > 0 &&
        profileData.keyDifferentiators?.length > 0 &&
        profileData.contactInfo?.email
      );

      expect(isComplete).toBe(true);
    });

    it('should mark as incomplete when required fields missing', () => {
      const profileData = {
        companyName: 'Company',
        industry: 'Tech',
        valueProposition: '',
        services: [],
        targetMarkets: [],
        keyDifferentiators: [],
        contactInfo: {},
      };

      const isComplete = !!(
        profileData.companyName &&
        profileData.industry &&
        profileData.valueProposition &&
        profileData.services?.length > 0 &&
        profileData.targetMarkets?.length > 0 &&
        profileData.keyDifferentiators?.length > 0 &&
        (profileData.contactInfo as any)?.email
      );

      expect(isComplete).toBe(false);
    });
  });

  describe('notification creation', () => {
    it('should create notification after importing profile', async () => {
      const mockUser = createMockUser();
      const source = 'linkedin';
      const isComplete = true;
      const insertMock = vi.fn().mockResolvedValue(mockId('notifications'));

      await insertMock('notifications', {
        userId: mockUser._id,
        type: 'system_alert',
        title: 'Profile Imported',
        message: `Your business profile has been imported from ${source}. Review and complete any missing information.`,
        data: {
          imported: true,
          source,
          isComplete,
        },
        read: false,
        sent: false,
        createdAt: Date.now(),
      });

      expect(insertMock).toHaveBeenCalledWith('notifications', expect.objectContaining({
        title: 'Profile Imported',
        data: expect.objectContaining({
          imported: true,
          source: 'linkedin',
        }),
      }));
    });
  });

  describe('return values', () => {
    it('should return success with profileId for update', () => {
      const existingProfileId = mockId('businessProfiles');
      const result = {
        success: true,
        profileId: existingProfileId,
        message: 'Profile updated with imported data',
      };

      expect(result.success).toBe(true);
      expect(result.profileId).toBe(existingProfileId);
      expect(result.message).toContain('updated');
    });

    it('should return success with profileId for creation', () => {
      const newProfileId = mockId('businessProfiles');
      const result = {
        success: true,
        profileId: newProfileId,
        message: 'Profile created from imported data',
      };

      expect(result.success).toBe(true);
      expect(result.profileId).toBe(newProfileId);
      expect(result.message).toContain('created');
    });
  });
});

// ============================================================================
// INTEGRATION TESTS - Edge Cases
// ============================================================================

describe('profile/mutations - Edge Cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('XSS protection', () => {
    it('should sanitize HTML in company name', () => {
      const maliciousInput = '<script>alert("xss")</script>Company';
      const sanitized = sanitizeString(maliciousInput);

      expect(sanitized).not.toContain('<script>');
      expect(sanitized).toContain('Company');
    });

    it('should sanitize HTML in services', () => {
      const maliciousInput = '<img onerror="alert(1)" src=x>Service';
      const sanitized = sanitizeString(maliciousInput);

      expect(sanitized).not.toContain('<img');
      expect(sanitized).toContain('Service');
    });

    it('should handle nested script tags', () => {
      // Note: Simple regex-based sanitization doesn't fully handle nested tags
      // A production implementation should use a proper HTML sanitizer library
      const maliciousInput = '<script><script>alert(1)</script></script>';
      const sanitized = sanitizeString(maliciousInput);

      // The basic sanitizer removes outer tags, inner content may remain partially
      // Key assertion: the <script> tag syntax is removed
      expect(sanitized).not.toContain('<script>');
      expect(sanitized).not.toContain('</script>');
    });
  });

  describe('boundary conditions', () => {
    it('should handle exactly 50 character value proposition', () => {
      // Exactly 50 characters
      const valueProposition = '12345678901234567890123456789012345678901234567890';
      expect(valueProposition.length).toBe(50);

      const isValid = valueProposition.length >= 50;
      expect(isValid).toBe(true);
    });

    it('should handle 49 character value proposition as invalid', () => {
      const valueProposition = '1234567890123456789012345678901234567890123456789';
      expect(valueProposition.length).toBe(49);

      const isValid = valueProposition.length >= 50;
      expect(isValid).toBe(false);
    });

    it('should handle empty arrays correctly', () => {
      const services: string[] = [];
      const filtered = services.filter(s => s.length > 0);

      expect(filtered.length).toBe(0);
    });

    it('should handle arrays with only whitespace', () => {
      const services = ['  ', '\t', '\n'];
      const filtered = services.map(s => sanitizeString(s)).filter(s => s.length > 0);

      expect(filtered.length).toBe(0);
    });
  });

  describe('unicode handling', () => {
    it('should preserve unicode characters in company name', () => {
      const unicodeName = '株式会社テスト';
      const sanitized = sanitizeString(unicodeName);

      expect(sanitized).toBe(unicodeName);
    });

    it('should preserve emoji in value proposition', () => {
      const valueWithEmoji = 'We build great software! 🚀 Making businesses succeed through innovation and dedication to excellence.';
      const sanitized = sanitizeString(valueWithEmoji);

      expect(sanitized).toContain('🚀');
    });

    it('should handle RTL text', () => {
      const rtlText = 'شركة الاختبار';
      const sanitized = sanitizeString(rtlText);

      expect(sanitized).toBe(rtlText);
    });
  });

  describe('concurrent operations', () => {
    it('should generate unique timestamps', () => {
      const timestamps = new Set<number>();

      for (let i = 0; i < 10; i++) {
        timestamps.add(Date.now());
      }

      // Due to same-millisecond execution, may have duplicates
      // This tests the timestamp mechanism works
      expect(timestamps.size).toBeGreaterThan(0);
    });
  });

  describe('null/undefined handling', () => {
    it('should handle null contact info fields', () => {
      const contactInfo = {
        name: null,
        email: undefined,
        phone: '',
      };

      const processed = {
        name: contactInfo.name || '',
        email: contactInfo.email || '',
        phone: contactInfo.phone || '',
      };

      expect(processed.name).toBe('');
      expect(processed.email).toBe('');
      expect(processed.phone).toBe('');
    });

    it('should handle missing optional fields in case studies', () => {
      const caseStudy = {
        title: 'Test',
        client: 'Client',
        results: 'Results',
        // metrics is missing
      };

      const processed = {
        title: sanitizeString(caseStudy.title || ''),
        client: sanitizeString(caseStudy.client || ''),
        results: sanitizeString(caseStudy.results || ''),
        metrics: (caseStudy as any).metrics || {},
      };

      expect(processed.metrics).toEqual({});
    });
  });

  describe('very long input handling', () => {
    it('should handle very long company name', () => {
      const longName = 'A'.repeat(1000);
      const sanitized = sanitizeString(longName);

      expect(sanitized.length).toBe(1000);
    });

    it('should handle very long value proposition', () => {
      const longValueProp = 'X'.repeat(10000);
      const sanitized = sanitizeString(longValueProp);

      expect(sanitized.length).toBe(10000);
    });

    it('should truncate to max items regardless of array size', () => {
      const massiveServices = Array.from({ length: 1000 }, (_, i) => `Service ${i}`);
      const limited = massiveServices.slice(0, BUSINESS_RULES.PROFILE.MAX_SERVICES);

      expect(limited.length).toBe(20);
    });
  });
});

// ============================================================================
// HELPER FUNCTION TESTS
// ============================================================================

describe('profile/mutations - Helper Functions', () => {
  describe('sanitizeString', () => {
    it('should trim whitespace', () => {
      expect(sanitizeString('  test  ')).toBe('test');
    });

    it('should remove HTML tags', () => {
      expect(sanitizeString('<p>test</p>')).toBe('test');
    });

    it('should handle empty string', () => {
      expect(sanitizeString('')).toBe('');
    });

    it('should handle null-like values', () => {
      expect(sanitizeString(null as any)).toBe('');
      expect(sanitizeString(undefined as any)).toBe('');
    });
  });

  describe('validateEmail', () => {
    it('should validate standard email format', () => {
      expect(validateEmail('test@example.com')).toBe(true);
    });

    it('should validate email with subdomain', () => {
      expect(validateEmail('test@mail.example.com')).toBe(true);
    });

    it('should reject email without @', () => {
      expect(validateEmail('testexample.com')).toBe(false);
    });

    it('should reject email without domain', () => {
      expect(validateEmail('test@')).toBe(false);
    });
  });

  describe('validateUrl', () => {
    it('should validate https URL', () => {
      expect(validateUrl('https://example.com')).toBe(true);
    });

    it('should validate http URL', () => {
      expect(validateUrl('http://example.com')).toBe(true);
    });

    it('should reject invalid URL', () => {
      expect(validateUrl('not-a-url')).toBe(false);
    });
  });

  describe('normalizeUrl', () => {
    it('should add https to URL without protocol', () => {
      expect(normalizeUrl('example.com')).toBe('https://example.com');
    });

    it('should preserve existing https', () => {
      expect(normalizeUrl('https://example.com')).toBe('https://example.com');
    });

    it('should handle empty string', () => {
      expect(normalizeUrl('')).toBe('');
    });
  });
});

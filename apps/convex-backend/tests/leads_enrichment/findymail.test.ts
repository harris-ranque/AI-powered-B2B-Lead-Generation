/**
 * Batch 7: Lead Enrichment Tests
 *
 * Tests the FindyMail enrichment provider including:
 * - Role sanitization and defaulting
 * - Batch enrichment with rate limiting
 * - Response transformation to standard format
 * - API key validation and credits
 * - Error handling and retry logic
 *
 * Priority: P1 - Critical for lead enrichment pipeline reliability
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FindyMailProvider } from '../../convex/leads/enrichment/findymail';
import type {
  EnrichmentResult,
  EnrichmentBatchResult,
  EnrichmentOptions,
} from '../../convex/leads/enrichment/types';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch as any;

describe('Lead Enrichment Tests - Batch 7', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Test 31: Role sanitization and defaulting', () => {
    it('should use default roles when none provided', async () => {
      // Arrange
      const apiKey = 'test_api_key';
      const provider = new FindyMailProvider(apiKey);
      const domain = 'example.com';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          contacts: [
            {
              name: 'John Doe',
              email: 'john@example.com',
              confidence: 0.9,
            },
          ],
        }),
      });

      // Act
      await provider.enrichSingle(domain);

      // Assert - Default roles should be ["ceo", "founder", "owner"]
      expect(mockFetch).toHaveBeenCalledWith(
        'https://app.findymail.com/api/search/domain',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"roles":["ceo","founder","owner"]'),
        })
      );
    });

    it('should sanitize and deduplicate roles', async () => {
      // Arrange
      const apiKey = 'test_api_key';
      const provider = new FindyMailProvider(apiKey);
      const domain = 'example.com';
      const options: EnrichmentOptions = {
        roles: ['CEO', ' ceo ', 'Founder', 'founder', 'CTO', 'CFO'],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ contacts: [] }),
      });

      // Act
      await provider.enrichSingle(domain, options);

      // Assert - Should normalize, deduplicate, and limit to 3 roles
      expect(mockFetch).toHaveBeenCalledWith(
        'https://app.findymail.com/api/search/domain',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"roles":['),
        })
      );

      // Verify the roles array has exactly 3 unique items
      const callBody = JSON.parse(mockFetch.mock.calls[0]![1]!.body as string);
      expect(callBody.roles).toHaveLength(3);
      expect(new Set(callBody.roles).size).toBe(3); // All unique
      expect(callBody.roles.every((r: string) => r === r.toLowerCase())).toBe(true); // All lowercase
    });

    it('should enforce MAX_ROLES limit of 3 on combined API requests', async () => {
      // Arrange
      const apiKey = 'test_api_key';
      const provider = new FindyMailProvider(apiKey);
      const domain = 'example.com';
      const options: EnrichmentOptions = {
        roles: ['ceo', 'founder', 'cto', 'cfo', 'coo', 'vp', 'director'],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ contacts: [] }),
      });

      // Act
      await provider.enrichSingle(domain, options);

      // Assert - Should limit to exactly 3 roles
      const callBody = JSON.parse(mockFetch.mock.calls[0]![1]!.body as string);
      expect(callBody.roles).toHaveLength(3);
    });

    it('should use default roles for empty array', async () => {
      // Arrange
      const apiKey = 'test_api_key';
      const provider = new FindyMailProvider(apiKey);
      const domain = 'example.com';
      const options: EnrichmentOptions = {
        roles: [],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ contacts: [] }),
      });

      // Act
      await provider.enrichSingle(domain, options);

      // Assert - Should fall back to default roles
      const callBody = JSON.parse(mockFetch.mock.calls[0]![1]!.body as string);
      expect(callBody.roles).toEqual(['ceo', 'founder', 'owner']);
    });
  });

  describe('Multi-contact per-role discovery', () => {
    it('fetches multiple contacts per role pattern with expansion (no 3-role cap)', async () => {
      const apiKey = 'test_api_key';
      const provider = new FindyMailProvider(apiKey);
      const domain = 'acme.com';

      mockFetch.mockImplementation(async () => ({
        ok: true,
        json: async () => ({
          contacts: [
            {
              name: 'Alice Regional',
              title: 'Regional Property Manager',
              email: 'alice@acme.com',
              confidence: 0.9,
            },
            {
              name: 'Bob Director',
              title: 'Director of Property Management',
              email: 'bob@acme.com',
              confidence: 0.85,
            },
          ],
        }),
      }));

      const result = await provider.enrichSingle(domain, {
        roles: ['Property Manager'],
        perRole: true,
        enableRoleExpansion: true,
        limit: 5,
      });

      expect(result).not.toBeNull();
      expect(result!.contacts.length).toBeGreaterThan(0);

      const limits = mockFetch.mock.calls.map((call) => {
        const body = JSON.parse(call[1]!.body as string);
        return body.limit;
      });
      expect(limits.every((limit: number) => limit === 5)).toBe(true);

      // Property family expansion yields more than one role pattern
      expect(mockFetch.mock.calls.length).toBeGreaterThan(1);

      const singleRoleCalls = mockFetch.mock.calls.map((call) => {
        const body = JSON.parse(call[1]!.body as string);
        return body.roles;
      });
      expect(singleRoleCalls.every((roles: string[]) => roles.length === 1)).toBe(
        true,
      );
    });

    it('merges contacts across role patterns by unique email', async () => {
      const apiKey = 'test_api_key';
      const provider = new FindyMailProvider(apiKey);
      const domain = 'acme.com';

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            contacts: [
              {
                name: 'Alice',
                email: 'alice@acme.com',
                confidence: 0.9,
              },
            ],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            contacts: [
              {
                name: 'Alice Duplicate',
                email: 'alice@acme.com',
                confidence: 0.8,
              },
              {
                name: 'Carol',
                email: 'carol@acme.com',
                confidence: 0.85,
              },
            ],
          }),
        })
        .mockResolvedValue({
          ok: true,
          json: async () => ({ contacts: [] }),
        });

      const result = await provider.enrichSingle(domain, {
        roles: ['ceo', 'founder'],
        perRole: true,
        enableRoleExpansion: false,
        limit: 5,
      });

      expect(result).not.toBeNull();
      const emails = result!.contacts.map((c) => c.email).filter(Boolean);
      expect(new Set(emails).size).toBe(emails.length);
      expect(emails).toContain('alice@acme.com');
      expect(emails).toContain('carol@acme.com');
      const alice = result!.contacts.find((c) => c.email === 'alice@acme.com');
      expect(alice?.title).toBeUndefined();
      expect(alice?.sourceRole).toBe('ceo');
      const carol = result!.contacts.find((c) => c.email === 'carol@acme.com');
      expect(carol?.title).toBeUndefined();
      expect(carol?.sourceRole).toBe('founder');
    });
  });

  describe('Test 32: Batch enrichment with rate limiting', () => {
    it('should process batch with 5 concurrent requests', async () => {
      // Arrange
      const apiKey = 'test_api_key';
      const provider = new FindyMailProvider(apiKey);
      const domains = Array.from({ length: 12 }, (_, i) => `example${i}.com`);

      // Mock all requests to succeed
      mockFetch.mockImplementation(async () => ({
        ok: true,
        json: async () => ({
          contacts: [
            {
              name: 'Test Contact',
              email: 'test@example.com',
              confidence: 0.85,
            },
          ],
        }),
      }));

      const startTime = Date.now();

      // Act
      const result = await provider.enrichBatch(domains);

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Assert
      expect(Object.keys(result)).toHaveLength(12);
      expect(mockFetch).toHaveBeenCalledTimes(12);

      // With 12 domains, 5 concurrent requests, and 500ms delay between batches:
      // Batch 1 (5 domains) + 500ms delay + Batch 2 (5 domains) + 500ms delay + Batch 3 (2 domains)
      // Should take at least 1000ms (2 delays) but less than 3000ms (sequential)
      expect(duration).toBeGreaterThanOrEqual(1000);
      expect(duration).toBeLessThan(3000);
    });

    it('should handle rate limit errors with exponential backoff', async () => {
      // Arrange
      const apiKey = 'test_api_key';
      const provider = new FindyMailProvider(apiKey);
      const domains = ['example.com'];

      // Mock rate limit error then success
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          statusText: 'Too Many Requests',
          text: async () => 'Rate limit exceeded',
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            contacts: [
              {
                name: 'Test Contact',
                email: 'test@example.com',
                confidence: 0.85,
              },
            ],
          }),
        });

      // Act
      const result = await provider.enrichBatch(domains);

      // Assert
      expect(mockFetch).toHaveBeenCalledTimes(2); // Initial + 1 retry
      expect(result['example.com']).toBeTruthy();
      expect(result['example.com']?.contacts).toHaveLength(1);
    });

    it('should handle gateway timeout errors with retry', async () => {
      // Arrange
      const apiKey = 'test_api_key';
      const provider = new FindyMailProvider(apiKey);
      const domains = ['example.com'];

      // Mock 504 error then success
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 504,
          statusText: 'Gateway Timeout',
          text: async () => 'Gateway timeout',
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            contacts: [
              {
                name: 'Test Contact',
                email: 'test@example.com',
                confidence: 0.85,
              },
            ],
          }),
        });

      // Act
      const result = await provider.enrichBatch(domains);

      // Assert
      expect(mockFetch).toHaveBeenCalledTimes(2); // Initial + 1 retry
      expect(result['example.com']).toBeTruthy();
    });

    it('should not retry 4xx client errors except 429', async () => {
      // Arrange
      const apiKey = 'test_api_key';
      const provider = new FindyMailProvider(apiKey);
      const domains = ['example.com'];

      // Mock 404 error (non-retriable)
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: async () => 'Domain not found',
      });

      // Act
      const result = await provider.enrichBatch(domains);

      // Assert
      expect(mockFetch).toHaveBeenCalledTimes(1); // No retry for 404
      expect(result['example.com']).toBeNull();
    });
  });

  describe('Test 33: Response transformation', () => {
    it('should transform FindyMail response to standard format', async () => {
      // Arrange
      const apiKey = 'test_api_key';
      const provider = new FindyMailProvider(apiKey);
      const domain = 'example.com';

      const findyMailResponse = {
        contacts: [
          {
            name: 'John Doe',
            email: 'john@example.com',
            title: 'CEO',
            linkedin: 'https://linkedin.com/in/johndoe',
            confidence: 0.9,
          },
          {
            first_name: 'Jane',
            last_name: 'Smith',
            email: 'jane@example.com',
            job_title: 'CTO',
            confidence_score: 0.85,
          },
        ],
        emails: [
          {
            email: 'info@example.com',
            type: 'generic',
            confidence: 0.7,
            verified: true,
          },
        ],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => findyMailResponse,
      });

      // Act
      const result = await provider.enrichSingle(domain);

      // Assert
      expect(result).toBeTruthy();
      expect(result?.contacts).toHaveLength(2);
      expect(result?.emails).toHaveLength(3); // 1 from emails + 2 from contacts

      // Verify contact transformation
      const johnContact = result?.contacts.find((c) => c.name === 'John Doe');
      expect(johnContact).toEqual({
        name: 'John Doe',
        title: 'CEO',
        email: 'john@example.com',
        linkedin: 'https://linkedin.com/in/johndoe',
        confidence: 0.9,
        verified: true,
      });

      // Verify name construction from first/last
      const janeContact = result?.contacts.find((c) => c.name === 'Jane Smith');
      expect(janeContact).toBeTruthy();
      expect(janeContact?.title).toBe('CTO');
      expect(janeContact?.confidence).toBe(0.85);

      // Verify email deduplication
      const emailList = result?.emails.map((e) => e.email);
      expect(new Set(emailList).size).toBe(emailList?.length); // All unique

      // Verify metadata
      expect(result?.metadata).toEqual({
        provider: 'findymail',
        confidence: expect.any(Number),
        timestamp: expect.any(Number),
      });
    });

    it('should calculate confidence based on email scores', async () => {
      // Arrange
      const apiKey = 'test_api_key';
      const provider = new FindyMailProvider(apiKey);
      const domain = 'example.com';

      const findyMailResponse = {
        contacts: [
          {
            name: 'Test Contact',
            email: 'test@example.com',
            confidence: 0.9,
          },
        ],
        emails: [
          {
            email: 'test@example.com',
            type: 'contact',
            confidence: 0.9,
          },
          {
            email: 'info@example.com',
            type: 'generic',
            confidence: 0.7,
          },
        ],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => findyMailResponse,
      });

      // Act
      const result = await provider.enrichSingle(domain);

      // Assert
      // Average confidence: (0.9 + 0.7) / 2 = 0.8
      expect(result?.metadata?.confidence).toBeCloseTo(0.8, 1);
    });

    it('should handle missing or malformed data gracefully', async () => {
      // Arrange
      const apiKey = 'test_api_key';
      const provider = new FindyMailProvider(apiKey);
      const domain = 'example.com';

      const malformedResponse = {
        contacts: [
          {
            // Missing name, email
            confidence: 'invalid', // Invalid confidence format
          },
          {
            email: 'test@example.com',
            // Missing other fields
          },
        ],
        // Missing emails array
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => malformedResponse,
      });

      // Act
      const result = await provider.enrichSingle(domain);

      // Assert
      expect(result).toBeTruthy();
      expect(result?.contacts).toBeTruthy();
      expect(result?.emails).toBeTruthy();
      expect(result?.metadata?.provider).toBe('findymail');
    });

    it('should handle null response data', async () => {
      // Arrange
      const apiKey = 'test_api_key';
      const provider = new FindyMailProvider(apiKey);
      const domain = 'example.com';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => null,
      });

      // Act
      const result = await provider.enrichSingle(domain);

      // Assert
      expect(result).toEqual({
        emails: [],
        contacts: [],
        metadata: {
          provider: 'findymail',
          confidence: 0,
          timestamp: expect.any(Number),
        },
      });
    });
  });

  describe('Test 34: API key validation and credits', () => {
    it('should validate API key successfully', async () => {
      // Arrange
      const apiKey = 'test_api_key';
      const provider = new FindyMailProvider(apiKey);

      mockFetch.mockResolvedValueOnce({
        ok: true,
      });

      // Act
      const isValid = await provider.validateApiKey(apiKey);

      // Assert
      expect(isValid).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://app.findymail.com/api/credits',
        expect.objectContaining({
          method: 'GET',
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
        })
      );
    });

    it('should return false for invalid API key', async () => {
      // Arrange
      const apiKey = 'invalid_api_key';
      const provider = new FindyMailProvider(apiKey);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
      });

      // Act
      const isValid = await provider.validateApiKey(apiKey);

      // Assert
      expect(isValid).toBe(false);
    });

    it('should handle validation network errors', async () => {
      // Arrange
      const apiKey = 'test_api_key';
      const provider = new FindyMailProvider(apiKey);

      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      // Act
      const isValid = await provider.validateApiKey(apiKey);

      // Assert
      expect(isValid).toBe(false);
    });

    it('should retrieve credits successfully', async () => {
      // Arrange
      const apiKey = 'test_api_key';
      const provider = new FindyMailProvider(apiKey);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ credits: 150 }),
      });

      // Act
      const credits = await provider.getCredits(apiKey);

      // Assert
      expect(credits).toBe(150);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://app.findymail.com/api/credits',
        expect.objectContaining({
          method: 'GET',
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
        })
      );
    });

    it('should return 0 credits on API error', async () => {
      // Arrange
      const apiKey = 'test_api_key';
      const provider = new FindyMailProvider(apiKey);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      // Act
      const credits = await provider.getCredits(apiKey);

      // Assert
      expect(credits).toBe(0);
    });

    it('should handle missing credits field in response', async () => {
      // Arrange
      const apiKey = 'test_api_key';
      const provider = new FindyMailProvider(apiKey);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({}), // No credits field
      });

      // Act
      const credits = await provider.getCredits(apiKey);

      // Assert
      expect(credits).toBe(0);
    });
  });

  describe('Test 35: Error handling and retry logic', () => {
    it('should retry transient errors with exponential backoff', async () => {
      // Arrange
      const apiKey = 'test_api_key';
      const provider = new FindyMailProvider(apiKey);
      const domain = 'example.com';

      // Mock 3 failures then success
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 504,
          statusText: 'Gateway Timeout',
          text: async () => 'Timeout',
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 504,
          statusText: 'Gateway Timeout',
          text: async () => 'Timeout',
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 504,
          statusText: 'Gateway Timeout',
          text: async () => 'Timeout',
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            contacts: [
              {
                name: 'Test Contact',
                email: 'test@example.com',
                confidence: 0.85,
              },
            ],
          }),
        });

      // Act
      const result = await provider.enrichBatch([domain]);

      // Assert
      expect(mockFetch).toHaveBeenCalledTimes(4); // 3 retries + 1 success
      expect(result[domain]).toBeTruthy();
    });

    it('should exhaust retries after max attempts', async () => {
      // Arrange
      const apiKey = 'test_api_key';
      const provider = new FindyMailProvider(apiKey);
      const domain = 'example.com';

      // Mock 5 consecutive failures (exceeds 4 retries)
      mockFetch.mockResolvedValue({
        ok: false,
        status: 504,
        statusText: 'Gateway Timeout',
        text: async () => 'Timeout',
      });

      // Act
      const result = await provider.enrichBatch([domain]);

      // Assert
      expect(mockFetch).toHaveBeenCalledTimes(5); // Initial + 4 retries
      expect(result[domain]).toBeNull(); // Failed after exhausting retries
    }, 20000); // 20s timeout for exponential backoff (1s + 2s + 4s + 8s = 15s + buffer)

    it('should handle network errors with retry', async () => {
      // Arrange
      const apiKey = 'test_api_key';
      const provider = new FindyMailProvider(apiKey);
      const domain = 'example.com';

      // Mock network error then success
      mockFetch
        .mockRejectedValueOnce(new Error('fetch failed'))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            contacts: [
              {
                name: 'Test Contact',
                email: 'test@example.com',
                confidence: 0.85,
              },
            ],
          }),
        });

      // Act
      const result = await provider.enrichBatch([domain]);

      // Assert
      expect(mockFetch).toHaveBeenCalledTimes(2); // Initial + 1 retry
      expect(result[domain]).toBeTruthy();
    });

    it('should return null for JSON parsing errors', async () => {
      // Arrange
      const apiKey = 'test_api_key';
      const provider = new FindyMailProvider(apiKey);
      const domain = 'example.com';

      // Mock response with invalid JSON
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => {
          throw new Error('Invalid JSON');
        },
      });

      // Act
      const result = await provider.enrichSingle(domain);

      // Assert
      expect(result).toBeNull();
      expect(mockFetch).toHaveBeenCalledTimes(1); // No retry for JSON errors
    });

    it('should handle empty batch gracefully', async () => {
      // Arrange
      const apiKey = 'test_api_key';
      const provider = new FindyMailProvider(apiKey);

      // Act
      const result = await provider.enrichBatch([]);

      // Assert
      expect(result).toEqual({});
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});

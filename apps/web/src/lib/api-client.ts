/**
 * API Client for Genni - Convex Integration
 * Provides helper functions and default data for the application
 */

import type { 
  BusinessProfileInput, 
  EmailRequirements, 
  EmailGenerationResult,
  Lead,
  SearchParams,
} from "./types";

// Legacy interfaces for backward compatibility
export interface EmailContent {
  subject: string;
  body: string;
  personalization_notes: string[];
  estimated_effectiveness: number;
}

export interface EmailGenerationResponse {
  request_id: string;
  status: 'processing' | 'completed' | 'error';
  message: string;
  result?: EmailGenerationResult;
  error?: string;
}

export interface LeadAnalysisResult {
  lead_id: string;
  relevance_score: number;
  pain_points: string[];
  fit_assessment: string;
  recommended_approach: string;
}

/**
 * Helper class for default data and utility functions
 * Note: API calls now handled directly through Convex hooks
 */
class ApiClient {
  /**
   * Generate a unique request ID for tracking
   */
  generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Format lead data for display
   */
  formatLeadForDisplay(lead: Lead): {
    id: string;
    company_name: string;
    contact_name?: string;
    industry: string;
    location: string;
    website?: string;
    rating?: number;
    contact_info: {
      email?: string;
      phone?: string;
    };
    status: string;
    created_at: string;
    updated_at: string;
  } {
    return {
      id: lead._id,
      company_name: lead.businessName,
      contact_name: lead.contactInfo?.contacts?.[0]?.name,
      industry: lead.category,
      location: lead.location.formattedAddress,
      website: lead.website,
      rating: lead.rating,
      contact_info: {
        email: lead.contactInfo?.emails?.[0]?.email,
        phone: lead.phone,
      },
      status: lead.status,
      created_at: new Date(lead.createdAt).toISOString(),
      updated_at: new Date(lead.updatedAt).toISOString(),
    };
  }

  /**
   * Create search parameters with defaults
   */
  createSearchParams(partial: Partial<SearchParams>): SearchParams {
    return {
      location: "",
      radius: 10,
      keywords: [],
      maxResults: 25,
      ...partial,
    };
  }

  /**
   * Create a default business profile for testing
   */
  getDefaultBusinessProfile(): BusinessProfileInput {
    return {
      companyName: 'Genni',
      industry: 'Business Services & AI Solutions',
      valueProposition: 'AI-powered lead generation and personalized email automation that helps businesses scale their outreach and improve conversion rates',
      services: [
        'AI Lead Generation',
        'Personalized Email Automation', 
        'Multi-Agent Email Personalization',
        'Sales Process Optimization',
        'Customer Outreach Analytics'
      ],
      targetMarkets: [
        'B2B SaaS Companies',
        'Professional Services',
        'E-commerce Businesses',
        'Marketing Agencies',
        'Growing Startups'
      ],
      keyDifferentiators: [
        '5-Agent AI System for Deep Personalization',
        'Real-time Lead Qualification and Scoring',
        'Industry-Specific Pain Point Analysis',
        'Automated Follow-up Sequence Generation',
        'Comprehensive Analytics and Optimization'
      ],
      caseStudies: [
        {
          title: 'SaaS Startup Increased Conversion by 180%',
          client: 'TechFlow Solutions',
          results: 'Improved email response rates from 2.1% to 5.9% in 60 days',
          metrics: {
            response_rate_improvement: '180%',
            lead_quality_score: '+45%',
            sales_cycle_reduction: '23 days'
          }
        },
        {
          title: 'Marketing Agency Scaled Outreach 10x',
          client: 'Digital Growth Partners',
          results: 'Increased monthly qualified leads from 50 to 500',
          metrics: {
            lead_volume_increase: '900%',
            cost_per_lead_reduction: '60%',
            client_satisfaction: '98%'
          }
        }
      ],
      contactInfo: {
        email: 'hello@genni.com',
        phone: '+1 (555) 123-4567',
        website: 'https://genni.com',
        linkedin: 'https://linkedin.com/company/genni'
      }
    };
  }

  /**
   * Create default email requirements
   */
  getDefaultEmailRequirements(): EmailRequirements {
    return {
      tone: 'professional',
      length: 'medium',
      callToAction: 'Schedule a 15-minute discovery call to discuss how our AI-powered solution can help scale your lead generation',
      includeCaseStudy: true,
      personalizationLevel: 'high',
      followUpSequence: false
    };
  }
}

// Export singleton instance
export const apiClient = new ApiClient();

// Export types for use in components (re-exported from types.ts)
export type {
  Lead,
  BusinessProfileInput as BusinessProfile,
  EmailRequirements,
  EmailContent,
  EmailGenerationResult,
  EmailGenerationResponse,
  LeadAnalysisResult,
} from "./types";
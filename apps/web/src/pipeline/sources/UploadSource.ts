import type { LeadSource, SourceParams, ValidationResult } from '../types';
import type { Lead } from '@/lib/api-client';

export const UploadSource: LeadSource = {
  type: 'csv_upload',
  name: 'CSV Upload',
  description: 'Import leads from your existing CSV files or CRM exports',
  icon: 'Upload',
  supportsEnrichment: true,
  supportsAI: true,

  validate: (params: SourceParams): ValidationResult => {
    const errors: string[] = [];
    const warnings: string[] = [];

    // File validation
    if (!params.file) {
      errors.push('CSV file is required');
      return { isValid: false, errors, warnings };
    }

    // File type validation
    const allowedTypes = ['text/csv', 'application/csv', 'text/plain'];
    const fileExtension = params.file.name.toLowerCase().split('.').pop();
    
    if (!allowedTypes.includes(params.file.type) && fileExtension !== 'csv') {
      errors.push('File must be a CSV format');
    }

    // File size validation (10MB limit)
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (params.file.size > maxSize) {
      errors.push('File size must be less than 10MB');
    }

    // Column mapping validation
    if (!params.columns || Object.keys(params.columns).length === 0) {
      errors.push('Column mapping is required');
    } else {
      const requiredFields = ['company_name'];
      const mappedFields = Object.values(params.columns);
      
      for (const field of requiredFields) {
        if (!mappedFields.includes(field)) {
          errors.push(`Required field '${field}' must be mapped`);
        }
      }
    }

    // Estimate processing cost
    const estimatedRows = Math.ceil(params.file.size / 100); // Rough estimate
    const estimatedCost = Math.min(estimatedRows * 2, 1000); // Cap at 1000 credits

    if (estimatedRows > 1000) {
      warnings.push('Large files may take longer to process');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      estimatedCost,
    };
  },

  fetch: async (params: SourceParams): Promise<Lead[]> => {
    if (!params.file || !params.columns) {
      throw new Error('File and column mapping required');
    }

    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      
      reader.onload = (event) => {
        try {
          const csvText = event.target?.result as string;
          const leads = parseCSVToLeads(csvText, params.columns!);
          resolve(leads);
        } catch (error) {
          reject(new Error('Failed to parse CSV file'));
        }
      };
      
      reader.onerror = () => {
        reject(new Error('Failed to read file'));
      };
      
      reader.readAsText(params.file);
    });
  },
};

function parseCSVToLeads(csvText: string, columnMapping: Record<string, string>): Lead[] {
  const lines = csvText.split('\n').filter(line => line.trim());
  if (lines.length === 0) return [];

  const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
  const dataLines = lines.slice(1);

  return dataLines.map((line, index) => {
    const values = line.split(',').map(v => v.trim().replace(/"/g, ''));
    const leadData: Partial<Lead> = {};

    // Map CSV columns to Lead fields based on user's column mapping
    headers.forEach((header, headerIndex) => {
      const mappedField = columnMapping[header];
      if (mappedField && values[headerIndex]) {
        switch (mappedField) {
          case 'company_name':
            leadData.company_name = values[headerIndex];
            break;
          case 'email':
            leadData.email = values[headerIndex];
            break;
          case 'phone':
            leadData.phone = values[headerIndex];
            break;
          case 'website':
            leadData.website = values[headerIndex];
            break;
          case 'address':
            leadData.address = values[headerIndex];
            break;
          case 'description':
            leadData.description = values[headerIndex];
            break;
          case 'industry':
            leadData.industry = values[headerIndex];
            break;
        }
      }
    });

    // Create Lead object with required fields
    return {
      id: `upload_${index}`,
      company_name: leadData.company_name || 'Unknown Company',
      email: leadData.email || null,
      phone: leadData.phone || null,
      website: leadData.website || null,
      address: leadData.address || null,
      description: leadData.description || null,
      industry: leadData.industry || null,
      status: 'discovered' as const,
      source: 'csv_upload' as const,
      rating: 0,
      notes: '',
      place_id: null,
      latitude: null,
      longitude: null,
      opening_hours: null,
      photos: null,
      reviews: null,
      review_count: null,
      social_profiles: null,
      employee_count: null,
      founded_year: null,
      technologies: null,
      relevance_score: null,
      pain_points: null,
      value_match: null,
      decision_makers: null,
      contact_info: null,
      ai_insights: null,
    } as Lead;
  }).filter(lead => lead.company_name && lead.company_name !== 'Unknown Company');
}
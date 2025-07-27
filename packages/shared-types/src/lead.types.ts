export interface Lead {
  id: string;
  searchSessionId: string;
  companyName: string;
  website?: string;
  location: {
    address: string;
    city: string;
    state?: string;
    country: string;
    coordinates?: {
      lat: number;
      lng: number;
    };
  };
  contactInfo?: {
    email?: string;
    phone?: string;
    socialMedia?: Record<string, string>;
  };
  relevanceScore: number;
  painPoints?: string[];
  emailSequence?: EmailSequence;
  createdAt: number;
}

export interface EmailSequence {
  id: string;
  leadId: string;
  emails: EmailTemplate[];
  status: 'draft' | 'generated' | 'approved' | 'sent';
  createdAt: number;
}

export interface EmailTemplate {
  subject: string;
  body: string;
  personalizations: Record<string, string>;
  followUpDay?: number;
}
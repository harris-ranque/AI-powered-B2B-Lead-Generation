export interface User {
  id: string;
  email: string;
  name: string;
  role: 'user' | 'admin' | 'developer';
  createdAt: number;
  updatedAt: number;
  isActive: boolean;
}

export interface UserProfile {
  userId: string;
  company: string;
  industry: string;
  targetAudience: string;
  painPoints: string[];
  valueProposition: string;
  communicationStyle: 'professional' | 'casual' | 'technical';
  completedOnboarding: boolean;
}
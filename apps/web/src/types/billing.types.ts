export interface SubscriptionPlan {
  id: string;
  name: string;
  price: number;
  credits: number;
  features: string[];
  isPopular?: boolean;
}

export interface UserCredits {
  userId: string;
  totalCredits: number;
  usedCredits: number;
  remainingCredits: number;
  lastUpdated: number;
  subscriptionId?: string;
}

export interface CreditTransaction {
  id: string;
  userId: string;
  type: 'purchase' | 'usage' | 'refund';
  amount: number;
  description: string;
  searchSessionId?: string;
  createdAt: number;
}
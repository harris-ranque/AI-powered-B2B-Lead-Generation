export interface SearchRequest {
  userId: string;
  query: string;
  location: {
    address: string;
    radius: number; // in km
  };
  filters: {
    businessTypes?: string[];
    priceRange?: {
      min?: number;
      max?: number;
    };
    rating?: number;
    openNow?: boolean;
  };
}

export interface SearchSession {
  id: string;
  userId: string;
  query: string;
  location: SearchRequest["location"];
  filters: SearchRequest["filters"];
  status: "pending" | "processing" | "completed" | "failed";
  results: SearchResult[];
  totalFound: number;
  creditsUsed: number;
  createdAt: number;
  completedAt?: number;
}

export interface SearchResult {
  placeId: string;
  name: string;
  address: string;
  location: {
    lat: number;
    lng: number;
  };
  rating?: number;
  website?: string;
  phone?: string;
  businessType: string;
  openingHours?: string[];
}

import { ConvexReactClient } from "convex/react";

// Environment variable validation with fallback
const convexUrl = import.meta.env.VITE_CONVEX_URL;

// In development, provide helpful error messages
// In production, we'll handle this at the component level
if (!convexUrl) {
  if (import.meta.env.DEV) {
    console.error("Missing VITE_CONVEX_URL environment variable. Please check your .env.local file.");
  }
}

// Create client with fallback URL for graceful degradation
export const convex = new ConvexReactClient(
  convexUrl || "https://placeholder.convex.cloud"
);

// Export validation function for component-level checking
export const isConvexConfigured = () => {
  return Boolean(convexUrl && convexUrl !== "https://placeholder.convex.cloud");
};
import { ConvexReactClient } from "convex/react";

// Environment variable validation with fallback
const convexUrl = import.meta.env.VITE_CONVEX_URL;

// Enhanced logging for production debugging
console.log("Convex configuration:", {
  convexUrl,
  environment: import.meta.env.MODE,
  isDev: import.meta.env.DEV,
  allEnvVars: Object.keys(import.meta.env).filter(key => key.startsWith('VITE_'))
});

// In development, provide helpful error messages
// In production, we'll handle this at the component level
if (!convexUrl || convexUrl.includes('placeholder')) {
  const message = `Missing or invalid VITE_CONVEX_URL: ${convexUrl}`;
  console.error(message);
  if (import.meta.env.DEV) {
    console.error("Please check your .env.local file.");
  }
}

// Create client with fallback URL for graceful degradation
export const convex = new ConvexReactClient(
  convexUrl && !convexUrl.includes('placeholder') 
    ? convexUrl 
    : "https://placeholder.convex.cloud"
);

// Export validation function for component-level checking
export const isConvexConfigured = () => {
  return Boolean(convexUrl && 
    convexUrl !== "https://placeholder.convex.cloud" && 
    !convexUrl.includes('placeholder') &&
    convexUrl.startsWith('https://'));
};
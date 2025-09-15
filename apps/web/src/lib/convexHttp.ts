import { ConvexHttpClient } from "convex/browser";
import { isConvexConfigured } from "./convex";

// Create a singleton HTTP client for non-realtime queries.
const convexUrl = import.meta.env.VITE_CONVEX_URL;

if (!convexUrl || convexUrl.includes("placeholder")) {
  console.error(
    `Missing or invalid VITE_CONVEX_URL for ConvexHttpClient: ${convexUrl}`,
  );
}

export const convexHttp = new ConvexHttpClient(
  isConvexConfigured() && convexUrl ? convexUrl : "https://placeholder.convex.cloud",
);

export const isConvexHttpConfigured = () => isConvexConfigured();


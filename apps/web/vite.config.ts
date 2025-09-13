import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 3000,
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(
    Boolean,
  ),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@/convex": path.resolve(__dirname, "../convex-backend/convex"),
      "@shared": path.resolve(__dirname, "../../packages/shared-types/src"),
      "@genni/convex-types": path.resolve(
        __dirname,
        "../convex-backend/convex/_generated/api.js",
      ),
      "@genni/convex-types/dataModel": path.resolve(
        __dirname,
        "../convex-backend/convex/_generated/dataModel.d.ts",
      ),
    },
  },
}));

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import fs from "fs";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const convexGeneratedDir = path.resolve(
    __dirname,
    "../convex-backend/convex/_generated",
  );
  const convexApiPath = path.join(convexGeneratedDir, "api.js");
  const convexDataModelPath = path.join(convexGeneratedDir, "dataModel.js");
  const convexDataModelDtsPath = path.join(
    convexGeneratedDir,
    "dataModel.d.ts",
  );

  const alias: Record<string, string> = {
    "@": path.resolve(__dirname, "./src"),
    "@/convex": path.resolve(__dirname, "../convex-backend/convex"),
    "@shared": path.resolve(__dirname, "../../packages/shared-types/src"),
  };

  if (fs.existsSync(convexApiPath)) {
    alias["@genni/convex-types"] = convexApiPath;
  }

  if (fs.existsSync(convexDataModelPath)) {
    alias["@genni/convex-types/dataModel"] = convexDataModelPath;
  } else if (fs.existsSync(convexDataModelDtsPath)) {
    alias["@genni/convex-types/dataModel"] = convexDataModelDtsPath;
  }

  return {
    server: {
      host: "::",
      port: 3000,
    },
    plugins: [react(), mode === "development" && componentTagger()].filter(
      Boolean,
    ),
    build: {
      sourcemap: mode === "development",
    },
    resolve: {
      alias,
    },
  };
});

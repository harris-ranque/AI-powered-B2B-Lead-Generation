import type { DocsNode } from "./DocsSidebar";

export interface DocsManifest {
  generatedAt: number;
  root: DocsNode;
}

export type DocHeading = { depth: number; text: string; id: string };

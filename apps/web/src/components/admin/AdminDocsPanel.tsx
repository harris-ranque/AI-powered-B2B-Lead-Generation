import React from "react";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { DocsSidebar, DocsNode } from "../docs/DocsSidebar";
import { DocsViewer } from "../docs/DocsViewer";
import { useDocsManifest } from "../docs/useDocsManifest";
import type { DocHeading } from "../docs/types";

function collectFiles(node: DocsNode, acc: DocsNode[] = []): DocsNode[] {
  if (node.type === "file") acc.push(node);
  node.children?.forEach((child) => collectFiles(child, acc));
  return acc;
}

function resolveDefaultPathFromFiles(files: DocsNode[]): string {
  if (files.length === 0) {
    return "README.md";
  }
  const preferred = files.find((f) => /readme\.md$/i.test(f.path));
  return preferred?.path ?? files[0].path;
}

export function AdminDocsPanel() {
  const { manifest, error, isLoading } = useDocsManifest();
  const [currentPath, setCurrentPath] = React.useState("README.md");
  const [headings, setHeadings] = React.useState<DocHeading[]>([]);

  React.useEffect(() => {
    if (!manifest) return;
    const files = collectFiles(manifest.root);
    const defaultPath = resolveDefaultPathFromFiles(files);
    setCurrentPath((prev) => {
      if (!prev) return defaultPath;
      const exists = files.some((file) => file.path === prev);
      return exists ? prev : defaultPath;
    });
  }, [manifest]);

  if (error) {
    return (
      <Card className="p-6">
        <div className="mb-4 text-sm text-red-600">{error}</div>
        <div className="space-y-2 text-sm text-muted-foreground">
          <p>Documentation manifest is missing. To enable docs in development:</p>
          <ul className="ml-5 list-disc">
            <li>
              Run <code>node scripts/sync-docs.mjs</code> or start web using <code>pnpm dev:web</code>.
            </li>
            <li>
              For production builds, the sync runs automatically on <code>pnpm build</code>.
            </li>
          </ul>
        </div>
      </Card>
    );
  }

  if (isLoading || !manifest) {
    return (
      <Card className="p-6 text-sm text-muted-foreground">
        Loading documentation…
      </Card>
    );
  }

  return (
    <Card className="min-h-[520px]">
      <div className="grid h-full grid-cols-1 md:grid-cols-[260px_1fr]">
        <DocsSidebar
          root={manifest.root}
          onSelect={setCurrentPath}
          activePath={currentPath}
        />
        <div className="min-h-0 overflow-hidden">
          <div className="border-b px-6 py-4">
            <h2 className="text-xl font-semibold">Documentation</h2>
            <p className="text-sm text-muted-foreground">
              Internal guides, specs, and notes from /docs
            </p>
          </div>
          <div className="grid grid-cols-1 gap-0 lg:grid-cols-[1fr_240px]">
            <div className="overflow-auto p-6">
              <DocsViewer
                path={currentPath}
                onHeadings={setHeadings}
                onNavigateDoc={setCurrentPath}
              />
            </div>
            <div className="hidden border-l bg-muted/30 p-6 lg:block">
              <div className="mb-2 text-sm font-medium">On this page</div>
              <Separator className="mb-3" />
              <nav className="space-y-1 text-sm">
                {headings.length === 0 && (
                  <div className="text-muted-foreground">No headings</div>
                )}
                {headings.map((heading) => (
                  <a
                    key={heading.id}
                    href={`#${heading.id}`}
                    className="block text-muted-foreground hover:text-foreground"
                    style={{ paddingLeft: `${(heading.depth - 1) * 8}px` }}
                  >
                    {heading.text}
                  </a>
                ))}
              </nav>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

export default AdminDocsPanel;

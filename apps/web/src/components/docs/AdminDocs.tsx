import React from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { DocsSidebar, DocsNode } from "./DocsSidebar";
import { DocsViewer } from "./DocsViewer";
import { useDocsManifest } from "./useDocsManifest";
import type { DocHeading } from "./types";

export const AdminDocs: React.FC = () => {
  const params = useParams();
  const navigate = useNavigate();
  const { manifest, error, isLoading } = useDocsManifest();
  const [headings, setHeadings] = React.useState<DocHeading[]>([]);

  const slug = params["*"] || "README.md";

  React.useEffect(() => {
    // If slug is missing, default to first README if exists
    if (!params["*"] && manifest) {
      // prefer README.md if present, else first file found
      const all: DocsNode[] = [];
      const walk = (n: DocsNode) => {
        if (n.type === "file") all.push(n);
        n.children?.forEach(walk);
      };
      walk(manifest.root);
      const preferred = all.find((f) => /readme\.md$/i.test(f.path)) || all[0];
      if (preferred)
        navigate(`/admin/docs/${preferred.path}`, { replace: true });
    }
  }, [manifest, params, navigate]);

  if (error) {
    return (
      <div className="p-6">
        <div className="mb-4 text-sm text-red-600">{error}</div>
        <div className="text-sm text-muted-foreground space-y-2">
          <p>
            Documentation manifest is missing. To enable docs in development:
          </p>
          <ul className="list-disc ml-5">
            <li>
              Run <code>node scripts/sync-docs.mjs</code> or start web using{" "}
              <code>pnpm dev:web</code>.
            </li>
            <li>
              For production builds, the sync runs automatically on{" "}
              <code>pnpm build</code>.
            </li>
          </ul>
        </div>
      </div>
    );
  }

  if (isLoading || !manifest) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Loading documentation…
      </div>
    );
  }

  const currentPath = slug;

  return (
    <div className="h-[calc(100vh-80px)] p-4">
      {/* Adjust if admin header height differs */}
      <Card className="h-full grid grid-cols-1 md:grid-cols-[280px_1fr]">
        {/* Sidebar */}
        <div className="min-h-0">
          <DocsSidebar root={manifest.root} />
        </div>

        {/* Content */}
        <div className="min-h-0 overflow-hidden">
          <div className="px-6 py-4 border-b">
            <h1 className="text-xl font-semibold">Documentation</h1>
            <p className="text-sm text-muted-foreground">
              Internal guides, specs, and notes from /docs
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-0 lg:gap-6">
            <div className="p-6 overflow-auto">
              <DocsViewer path={currentPath} onHeadings={setHeadings} />
            </div>
            <div className="hidden lg:block p-6 border-l bg-muted/30">
              <div className="text-sm font-medium mb-2">On this page</div>
              <Separator className="mb-3" />
              <nav className="text-sm space-y-1">
                {headings.length === 0 && (
                  <div className="text-muted-foreground">No headings</div>
                )}
                {headings.map((h, i) => (
                  <a
                    key={i}
                    href={`#${h.id}`}
                    className="block text-muted-foreground hover:text-foreground"
                    style={{ paddingLeft: `${(h.depth - 1) * 8}px` }}
                  >
                    {h.text}
                  </a>
                ))}
              </nav>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
};

export default AdminDocs;

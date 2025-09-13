import React from "react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { Link, useLocation } from "react-router-dom";
import { LayoutDashboard, Users, Coins, Globe, Settings, Activity } from "lucide-react";

export type DocsNode = {
  type: "dir" | "file";
  name: string;
  path: string; // relative to /docs
  title?: string;
  isMarkdown?: boolean;
  children?: DocsNode[];
};

interface DocsSidebarProps {
  root: DocsNode;
}

function flattenFiles(node: DocsNode, acc: DocsNode[] = []): DocsNode[] {
  if (node.type === "file") acc.push(node);
  node.children?.forEach((c) => flattenFiles(c, acc));
  return acc;
}

export const DocsSidebar: React.FC<DocsSidebarProps> = ({ root }) => {
  const [query, setQuery] = React.useState("");
  const location = useLocation();

  const files = React.useMemo(() => flattenFiles(root), [root]);
  const filtered = React.useMemo(() => {
    if (!query.trim()) return null;
    const q = query.toLowerCase();
    return files.filter(
      (f) => f.title?.toLowerCase().includes(q) || f.path.toLowerCase().includes(q),
    );
  }, [files, query]);

  const renderTree = (node: DocsNode) => {
    if (node.type === "file") {
      const href = `/admin/docs/${node.path}`;
      const active = decodeURIComponent(location.pathname).endsWith(node.path);
      return (
        <li key={node.path}>
          <Link
            to={href}
            className={cn(
              "block rounded px-2 py-1 text-sm hover:bg-muted",
              active && "bg-muted font-medium",
            )}
          >
            {node.title || node.name}
          </Link>
        </li>
      );
    }
    return (
      <li key={node.path || node.name} className="mb-2">
        {node.path !== "" && (
          <div className="px-2 py-1 text-xs font-semibold uppercase text-muted-foreground">
            {node.name}
          </div>
        )}
        <ul className="ml-2 space-y-1">
          {node.children?.map((c) => renderTree(c))}
        </ul>
      </li>
    );
  };

  return (
    <div className="h-full flex flex-col border-r">
      <div className="p-3 space-y-3">
        <div>
          <div className="px-1 text-xs font-semibold uppercase text-muted-foreground mb-1">
            Shortcuts
          </div>
          <ul className="space-y-1">
            <li>
              <Link
                to="/admin"
                className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted"
              >
                <LayoutDashboard className="h-4 w-4 text-muted-foreground" />
                <span>Admin Overview</span>
              </Link>
            </li>
            <li>
              <Link
                to="/admin?tab=users"
                className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted"
              >
                <Users className="h-4 w-4 text-muted-foreground" />
                <span>User Management</span>
              </Link>
            </li>
            <li>
              <Link
                to="/admin?tab=credits"
                className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted"
              >
                <Coins className="h-4 w-4 text-muted-foreground" />
                <span>Credit Management</span>
              </Link>
            </li>
            <li>
              <Link
                to="/admin?tab=services"
                className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted"
              >
                <Globe className="h-4 w-4 text-muted-foreground" />
                <span>External Services</span>
              </Link>
            </li>
            <li>
              <Link
                to="/admin?tab=configuration"
                className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted"
              >
                <Settings className="h-4 w-4 text-muted-foreground" />
                <span>Configuration</span>
              </Link>
            </li>
            <li>
              <Link
                to="/admin?tab=system"
                className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted"
              >
                <Activity className="h-4 w-4 text-muted-foreground" />
                <span>System Health</span>
              </Link>
            </li>
          </ul>
        </div>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search docs..."
        />
      </div>
      <ScrollArea className="flex-1">
        <div className="p-3">
          {filtered ? (
            <ul className="space-y-1">
              {filtered.map((f) => (
                <li key={f.path}>
                  <Link
                    to={`/admin/docs/${f.path}`}
                    className={cn(
                      "block rounded px-2 py-1 text-sm hover:bg-muted",
                      decodeURIComponent(location.pathname).endsWith(f.path) &&
                        "bg-muted font-medium",
                    )}
                  >
                    {f.title || f.name}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <ul className="space-y-1">{renderTree(root)}</ul>
          )}
        </div>
      </ScrollArea>
    </div>
  );
};

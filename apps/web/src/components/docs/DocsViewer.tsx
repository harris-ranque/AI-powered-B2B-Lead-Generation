import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSlug from "rehype-slug";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import rehypeHighlight from "rehype-highlight";
import 'highlight.js/styles/github.css';

interface DocsViewerProps {
  path: string; // relative path under /docs
  onHeadings?: (h: { depth: number; text: string; id: string }[]) => void;
}

export const DocsViewer: React.FC<DocsViewerProps> = ({ path, onHeadings }) => {
  const [content, setContent] = React.useState<string>("Loading...");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setError(null);
    fetch(`/docs/${path}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load ${path}`);
        const text = await res.text();
        if (cancelled) return;
        setContent(text);
        // Extract headings for ToC
        const headings: { depth: number; text: string; id: string }[] = [];
        const lines = text.split(/\r?\n/);
        for (const line of lines) {
          const m = /^(#{1,6})\s+(.+)$/.exec(line);
          if (m) {
            const depth = m[1].length;
            const text = m[2].trim();
            const id = text
              .toLowerCase()
              .replace(/[^a-z0-9\s-]/g, "")
              .trim()
              .replace(/\s+/g, "-");
            headings.push({ depth, text, id });
          }
        }
        onHeadings?.(headings);
      })
      .catch((e) => !cancelled && setError(e.message || "Failed to load content"));
    return () => {
      cancelled = true;
    };
  }, [path, onHeadings]);

  if (error) {
    return (
      <div className="text-sm text-red-600">{error}</div>
    );
  }

  return (
    <div className="prose dark:prose-invert max-w-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[
          rehypeSlug,
          [rehypeAutolinkHeadings, { behavior: 'append', properties: { className: ['anchor-link'] } }],
          rehypeHighlight,
        ]}
        components={{
          a: (props) => {
            const href = props.href || "";
            const isExternal = /^(https?:)?\/\//.test(href);
            if (!isExternal && href.endsWith('.md')) {
              // Convert relative doc links to /admin/docs routes
              const normalized = href.replace(/^\.\//, '');
              return <a {...props} href={`/admin/docs/${normalized}`} />;
            }
            return <a {...props} target={isExternal ? "_blank" : undefined} rel={isExternal ? "noreferrer" : undefined} />;
          },
          img: (props) => {
            const src = props.src || "";
            const rewritten = src.startsWith("http") ? src : `/docs/${src.replace(/^\.\//, '')}`;
            return <img {...props} src={rewritten} />;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
};


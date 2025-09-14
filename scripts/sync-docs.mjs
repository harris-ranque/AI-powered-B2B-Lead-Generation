#!/usr/bin/env node
// Sync root docs/ into apps/web/public/docs and generate a manifest.json
// Keeps structure, copies non-code assets (images) as-is.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Resolve repo root based on this script's location to avoid cwd issues
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const sourceDir = path.join(repoRoot, 'docs');
const destDir = path.join(repoRoot, 'apps', 'web', 'public', 'docs');

/** Recursively get files in a directory */
function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue; // skip hidden
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(fullPath));
    else files.push(fullPath);
  }
  return files;
}

/** Ensure directory exists */
function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

/** Copy file preserving structure */
function copyFile(src, destRoot, srcRoot) {
  const rel = path.relative(srcRoot, src);
  const dest = path.join(destRoot, rel);
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

/** Extract title from first markdown heading or use filename */
function titleFromMarkdown(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split(/\r?\n/);
    for (const line of lines) {
      const m = /^(#{1,6})\s+(.+)$/.exec(line.trim());
      if (m) return m[2].trim();
    }
  } catch {}
  return path.basename(filePath).replace(/\.(md|mdx|markdown)$/i, '');
}

/** Build a simple tree manifest */
function buildTree(rootDir) {
  function nodeFor(currentPath) {
    const stat = fs.statSync(currentPath);
    const rel = path.relative(rootDir, currentPath) || '';
    if (stat.isDirectory()) {
      const children = fs
        .readdirSync(currentPath, { withFileTypes: true })
        .filter((e) => !e.name.startsWith('.'))
        .map((e) => nodeFor(path.join(currentPath, e.name)))
        // Folders first, then files alphabetically
        .sort((a, b) => {
          if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
      return { type: 'dir', name: path.basename(currentPath), path: rel, children };
    }
    const ext = path.extname(currentPath).toLowerCase();
    const isMarkdown = ['.md', '.mdx', '.markdown'].includes(ext);
    const title = isMarkdown ? titleFromMarkdown(currentPath) : path.basename(currentPath);
    return { type: 'file', name: path.basename(currentPath), path: rel, title, isMarkdown };
  }
  return nodeFor(rootDir);
}

function main() {
  // Clean destination
  if (fs.existsSync(destDir)) {
    fs.rmSync(destDir, { recursive: true, force: true });
  }
  ensureDir(destDir);

  const hasDocs = fs.existsSync(sourceDir);
  const files = hasDocs ? walk(sourceDir) : [];
  if (hasDocs) {
    for (const f of files) {
      copyFile(f, destDir, sourceDir);
    }
  } else {
    console.log(`[sync-docs] No docs directory at ${sourceDir}, continuing with root README only if present.`);
  }

  // Optionally copy root README as README.root.md
  const rootReadme = path.join(repoRoot, 'README.md');
  let readmeNode = null;
  if (fs.existsSync(rootReadme)) {
    const destReadme = path.join(destDir, 'README.root.md');
    fs.copyFileSync(rootReadme, destReadme);
    readmeNode = {
      type: 'file',
      name: 'README.root.md',
      path: 'README.root.md',
      title: titleFromMarkdown(rootReadme) || 'Project README',
      isMarkdown: true,
    };
  }

  // Generate manifest.json
  let tree;
  if (hasDocs) {
    tree = buildTree(sourceDir);
  } else {
    tree = { type: 'dir', name: 'docs', path: '', children: [] };
  }
  if (readmeNode) {
    tree.children = tree.children || [];
    tree.children.push(readmeNode);
  }
  const manifest = { generatedAt: Date.now(), root: tree };
  fs.writeFileSync(path.join(destDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`[sync-docs] Synced ${files.length} files to ${destDir}${readmeNode ? ' + root README' : ''}`);
}

main();

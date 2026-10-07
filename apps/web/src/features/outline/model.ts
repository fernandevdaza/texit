/**
 * Document structure across the main file, following \input / \include /
 * \subfile in order.
 */
import type { OutlineItem } from '@texit/core';
import type { FloatInfo, ProjectIndex } from '@/features/editor/projectIndex';

export interface DocItem extends OutlineItem {
  fileId: string;
  path: string;
  /** Global order index. */
  order: number;
  /** Position of this item in each file of its include chain (fileId → line). */
  anchors: Record<string, number>;
}

export interface DocLabel {
  name: string;
  fileId: string;
  path: string;
  line: number;
  context?: string;
}

export interface DocFloat extends FloatInfo {
  fileId: string;
  path: string;
}

export interface DocStructure {
  rootId: string | null;
  items: DocItem[];
  labels: DocLabel[];
  floats: DocFloat[];
  /** Files included (in order) from the main file. */
  files: string[];
  bibCount: number;
}

const INCLUDE_CMDS = new Set(['input', 'include', 'subfile', 'subfileinclude', 'import', 'subimport']);

export function buildStructure(idx: ProjectIndex, rootId: string | null): DocStructure {
  const out: DocStructure = { rootId, items: [], labels: [], floats: [], files: [], bibCount: 0 };
  try {
    out.bibCount = idx.bibEntries().length;
  } catch {
    out.bibCount = 0;
  }
  if (!rootId) return out;
  const visited = new Set<string>();
  let order = 0;
  const visit = (fileId: string, depth: number, anchors: Record<string, number>) => {
    if (visited.has(fileId) || depth > 16) return;
    visited.add(fileId);
    out.files.push(fileId);
    const path = idx.project.getPath(fileId);
    const a = idx.analysis(fileId);
    for (const l of a.labels) out.labels.push({ ...l, fileId, path });
    for (const f of idx.floats(fileId)) out.floats.push({ ...f, fileId, path });
    // Merge outline items and includes by line so includes land in reading order.
    const includes = a.includes.filter((i) => INCLUDE_CMDS.has(i.command));
    const events: ({ t: 'item'; line: number; item: OutlineItem } | { t: 'inc'; line: number; path: string })[] = [
      ...a.outline.map((item) => ({ t: 'item' as const, line: item.line, item })),
      ...includes.map((i) => ({ t: 'inc' as const, line: i.line, path: i.path })),
    ].sort((x, y) => x.line - y.line || (x.t === 'item' ? -1 : 1));
    for (const ev of events) {
      if (ev.t === 'item') out.items.push({ ...ev.item, fileId, path, order: order++, anchors: { ...anchors, [fileId]: ev.line } });
      else {
        const target = idx.resolveInclude(ev.path, path);
        if (target) visit(target, depth + 1, { ...anchors, [fileId]: ev.line });
      }
    }
  };
  visit(rootId, 0, {});
  // Files not reachable from the main file still contribute labels/floats for completeness? No — keep to the document.
  return out;
}

export interface TreeNode {
  item: DocItem;
  children: TreeNode[];
}

/** Nest flat items by level (frames, level -1, are treated as leaves under the current section). */
export function nest(items: DocItem[]): TreeNode[] {
  const roots: TreeNode[] = [];
  const stack: TreeNode[] = [];
  for (const item of items) {
    const node: TreeNode = { item, children: [] };
    const level = item.level < 0 ? 99 : item.level;
    while (stack.length && (stack[stack.length - 1].item.level < 0 ? 99 : stack[stack.length - 1].item.level) >= level) stack.pop();
    if (stack.length) stack[stack.length - 1].children.push(node);
    else roots.push(node);
    stack.push(node);
  }
  return roots;
}

/** The item containing (fileId, line), given the global reading order. */
export function currentItem(s: DocStructure, fileId: string | null, line: number): DocItem | null {
  if (!fileId) return null;
  let last = -1;
  let first = -1;
  s.items.forEach((item, i) => {
    const at = item.anchors[fileId];
    if (at === undefined) return;
    if (first < 0) first = i;
    if (at <= line) last = i;
  });
  if (last >= 0) return s.items[last];
  if (first > 0) return s.items[first - 1];
  return null;
}

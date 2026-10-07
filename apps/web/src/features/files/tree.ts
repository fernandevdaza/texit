import { ROOT_ID, type FileNode } from '@texit/core';

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function sortNodes(a: FileNode, b: FileNode): number {
  if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
  return collator.compare(a.name, b.name);
}

export function childrenMap(files: FileNode[]): Map<string, FileNode[]> {
  const map = new Map<string, FileNode[]>();
  for (const f of files) {
    const arr = map.get(f.parentId) ?? [];
    arr.push(f);
    map.set(f.parentId, arr);
  }
  for (const arr of map.values()) arr.sort(sortNodes);
  return map;
}

export interface Row {
  node: FileNode;
  depth: number;
}

/** Visible rows in tree order. With a filter, matches and their ancestors are shown expanded. */
export function visibleRows(files: FileNode[], expanded: Set<string>, filter: string): Row[] {
  const kids = childrenMap(files);
  const q = filter.trim().toLowerCase();
  let keep: Set<string> | null = null;
  if (q) {
    keep = new Set();
    const byId = new Map(files.map((f) => [f.id, f]));
    for (const f of files) {
      if (!f.path.toLowerCase().includes(q)) continue;
      let cur: FileNode | undefined = f;
      while (cur) {
        keep.add(cur.id);
        cur = cur.parentId === ROOT_ID ? undefined : byId.get(cur.parentId);
      }
    }
  }
  const out: Row[] = [];
  const walk = (parent: string, depth: number) => {
    for (const n of kids.get(parent) ?? []) {
      if (keep && !keep.has(n.id)) continue;
      out.push({ node: n, depth });
      if (n.kind === 'folder' && (keep || expanded.has(n.id))) walk(n.id, depth + 1);
    }
  };
  walk(ROOT_ID, 0);
  return out;
}

export function ancestors(files: FileNode[], id: string): string[] {
  const byId = new Map(files.map((f) => [f.id, f]));
  const out: string[] = [];
  let cur = byId.get(id);
  while (cur && cur.parentId !== ROOT_ID) {
    out.push(cur.parentId);
    cur = byId.get(cur.parentId);
  }
  return out;
}

/** Is `id` equal to or inside folder `folderId`? */
export function isInside(files: FileNode[], id: string, folderId: string): boolean {
  if (id === folderId) return true;
  return ancestors(files, id).includes(folderId);
}

export function validateName(name: string, siblings: FileNode[], selfId?: string): string | null {
  const n = name.trim();
  if (!n) return 'A name is required';
  if (/[\\:*?"<>|]/.test(n)) return 'Name contains invalid characters';
  if (n.startsWith('/') || n.endsWith('/') || n.split('/').some((s) => s === '..' || s === '.' || !s)) return 'Invalid path';
  const first = n.split('/')[0];
  if (siblings.some((s) => s.id !== selfId && s.name === first && (n.includes('/') ? s.kind !== 'folder' : true)))
    return `“${first}” already exists here`;
  return null;
}

/** Unified diff with word-level highlights (jsdiff). Used by review cards. */
import { useMemo, useState, type ReactNode } from 'react';
import { diffLines, diffWordsWithSpace } from 'diff';
import { cn } from '@/lib/cn';

type Row =
  | { kind: 'ctx' | 'del' | 'add'; oldNo?: number; newNo?: number; text: string; words?: { value: string; changed: boolean }[] }
  | { kind: 'gap'; count: number; rows: Row[] };

function splitLines(v: string): string[] {
  const lines = v.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

export function computeRows(before: string, after: string, context = 3): { rows: Row[]; added: number; removed: number } {
  const changes = diffLines(before, after);
  const flat: Row[] = [];
  let o = 1;
  let n = 1;
  let added = 0;
  let removed = 0;
  for (let i = 0; i < changes.length; i++) {
    const c = changes[i];
    const lines = splitLines(c.value);
    if (c.removed && changes[i + 1]?.added) {
      const addLines = splitLines(changes[i + 1].value);
      const pair = Math.min(lines.length, addLines.length);
      const dels: Row[] = [];
      const adds: Row[] = [];
      for (let k = 0; k < Math.max(lines.length, addLines.length); k++) {
        if (k < pair) {
          const parts = diffWordsWithSpace(lines[k], addLines[k]);
          dels.push({ kind: 'del', oldNo: o++, text: lines[k], words: parts.filter((p) => !p.added).map((p) => ({ value: p.value, changed: !!p.removed })) });
          adds.push({ kind: 'add', newNo: n++, text: addLines[k], words: parts.filter((p) => !p.removed).map((p) => ({ value: p.value, changed: !!p.added })) });
        } else if (k < lines.length) dels.push({ kind: 'del', oldNo: o++, text: lines[k] });
        else adds.push({ kind: 'add', newNo: n++, text: addLines[k] });
      }
      removed += lines.length;
      added += addLines.length;
      flat.push(...dels, ...adds);
      i++;
    } else if (c.removed) {
      removed += lines.length;
      for (const l of lines) flat.push({ kind: 'del', oldNo: o++, text: l });
    } else if (c.added) {
      added += lines.length;
      for (const l of lines) flat.push({ kind: 'add', newNo: n++, text: l });
    } else {
      for (const l of lines) flat.push({ kind: 'ctx', oldNo: o++, newNo: n++, text: l });
    }
  }
  // Collapse long unchanged runs.
  const rows: Row[] = [];
  let i = 0;
  while (i < flat.length) {
    if (flat[i].kind !== 'ctx') {
      rows.push(flat[i++]);
      continue;
    }
    let j = i;
    while (j < flat.length && flat[j].kind === 'ctx') j++;
    const run = flat.slice(i, j);
    const keepHead = i === 0 ? 0 : context;
    const keepTail = j === flat.length ? 0 : context;
    if (run.length > keepHead + keepTail + 1) {
      rows.push(...run.slice(0, keepHead));
      rows.push({ kind: 'gap', count: run.length - keepHead - keepTail, rows: run.slice(keepHead, run.length - keepTail) });
      rows.push(...run.slice(run.length - keepTail));
    } else rows.push(...run);
    i = j;
  }
  return { rows, added, removed };
}

function Line({ row }: { row: Exclude<Row, { kind: 'gap' }> }) {
  const content: ReactNode = row.words
    ? row.words.map((w, i) => (
        <span key={i} className={cn(w.changed && (row.kind === 'del' ? 'rounded-[2px] bg-danger/25' : 'rounded-[2px] bg-success/25'))}>
          {w.value}
        </span>
      ))
    : row.text || ' ';
  return (
    <div className={cn('flex min-w-max', row.kind === 'del' && 'bg-danger-soft', row.kind === 'add' && 'bg-success-soft')}>
      <span className="w-8 shrink-0 select-none pr-1 text-right text-fg-subtle/70">{row.oldNo ?? ''}</span>
      <span className="w-8 shrink-0 select-none pr-1 text-right text-fg-subtle/70">{row.newNo ?? ''}</span>
      <span className={cn('w-4 shrink-0 select-none text-center', row.kind === 'del' ? 'text-danger' : row.kind === 'add' ? 'text-success' : 'text-transparent')}>
        {row.kind === 'del' ? '−' : row.kind === 'add' ? '+' : ' '}
      </span>
      <span className="whitespace-pre pr-3">{content}</span>
    </div>
  );
}

export function DiffView({ before, after, maxHeight = 320, className }: { before: string; after: string; maxHeight?: number; className?: string }) {
  const { rows } = useMemo(() => computeRows(before, after), [before, after]);
  const [open, setOpen] = useState<Set<number>>(new Set());
  return (
    <div className={cn('overflow-auto font-mono text-[11px] leading-[1.55]', className)} style={{ maxHeight }}>
      {rows.map((r, i) =>
        r.kind === 'gap' ? (
          open.has(i) ? (
            r.rows.map((x, k) => <Line key={`${i}-${k}`} row={x as Exclude<Row, { kind: 'gap' }>} />)
          ) : (
            <button
              key={i}
              onClick={() => setOpen(new Set(open).add(i))}
              className="block w-full bg-surface-2/70 py-0.5 text-center text-[10.5px] text-fg-subtle hover:bg-hover hover:text-fg"
            >
              ⋯ {r.count} unchanged line{r.count === 1 ? '' : 's'}
            </button>
          )
        ) : (
          <Line key={i} row={r} />
        ),
      )}
    </div>
  );
}

export function diffStats(before: string, after: string) {
  const { added, removed } = computeRows(before, after);
  return { added, removed };
}

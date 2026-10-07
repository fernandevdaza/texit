/**
 * Table generator — editable grid (paste from spreadsheets / CSV / TSV),
 * column alignment, booktabs, caption & label → inserts a LaTeX table.
 */
import { useMemo, useRef, useState, type ClipboardEvent } from 'react';
import { AlignCenter, AlignLeft, AlignRight, ClipboardPaste, Copy, Minus, Plus, Trash2 } from 'lucide-react';
import { definePlugin, type PluginAPI } from '@texit/plugin-api';
import { Button, Input, Segmented, Switch, Textarea } from '@/ui';
import { mountReact } from './mount';

export type Align = 'l' | 'c' | 'r';

export interface TableModel {
  cells: string[][];
  align: Align[];
  header: boolean;
  booktabs: boolean;
  verticalRules: boolean;
  escape: boolean;
  caption: string;
  label: string;
  float: boolean;
  placement: string;
}

const SPECIAL: Record<string, string> = {
  '\\': '\\textbackslash{}',
  '&': '\\&',
  '%': '\\%',
  $: '\\$',
  '#': '\\#',
  _: '\\_',
  '{': '\\{',
  '}': '\\}',
  '~': '\\textasciitilde{}',
  '^': '\\textasciicircum{}',
};

export function escapeLatex(s: string): string {
  return s.replace(/[\\&%$#_{}~^]/g, (c) => SPECIAL[c]);
}

/** Parse pasted spreadsheet data: TSV (Excel/Sheets), CSV or semicolon-separated, with quotes. */
export function parseDelimited(text: string): string[][] {
  const src = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
  if (!src) return [];
  const firstLine = src.split('\n', 1)[0];
  const delim = firstLine.includes('\t') ? '\t' : (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === delim) {
      row.push(cell.trim());
      cell = '';
    } else if (c === '\n') {
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  row.push(cell.trim());
  rows.push(row);
  const width = Math.max(...rows.map((r) => r.length));
  return rows.map((r) => [...r, ...Array(width - r.length).fill('')]);
}

export function generateLatex(m: TableModel, indent = '  '): string {
  const cols = m.align.length;
  const fmtCell = (s: string) => (m.escape ? escapeLatex(s) : s);
  const spec = m.booktabs || !m.verticalRules ? m.align.join('') : `|${m.align.join('|')}|`;
  const rule = (kind: 'top' | 'mid' | 'bottom') => (m.booktabs ? `\\${kind}rule` : '\\hline');
  const lines: string[] = [];
  const pad = m.float ? indent : '';
  const inner = pad + indent;
  if (m.float) {
    lines.push(`\\begin{table}${m.placement ? `[${m.placement}]` : ''}`);
    lines.push(`${pad}\\centering`);
    if (m.caption) lines.push(`${pad}\\caption{${m.caption}}`);
    if (m.label) lines.push(`${pad}\\label{${m.label}}`);
  }
  lines.push(`${pad}\\begin{tabular}{${spec}}`);
  lines.push(`${inner}${rule('top')}`);
  // Align the & separators for readability.
  const nonEmpty = m.cells.filter((r) => r.some((c) => c.trim()));
  const rows = (nonEmpty.length ? nonEmpty : m.cells.slice(0, 1)).map((r) => Array.from({ length: cols }, (_, i) => fmtCell(r[i] ?? '')));
  const widths = Array.from({ length: cols }, (_, i) => Math.min(40, Math.max(0, ...rows.map((r) => r[i].length))));
  rows.forEach((r, ri) => {
    const text = r.map((c, i) => (i < cols - 1 ? c.padEnd(widths[i]) : c)).join(' & ');
    lines.push(`${inner}${text} \\\\`);
    if (ri === 0 && m.header && rows.length > 1) lines.push(`${inner}${rule('mid')}`);
    else if (!m.booktabs && m.verticalRules && ri < rows.length - 1) lines.push(`${inner}\\hline`);
  });
  lines.push(`${inner}${rule('bottom')}`);
  lines.push(`${pad}\\end{tabular}`);
  if (m.float) lines.push('\\end{table}');
  return lines.join('\n') + '\n';
}

const blank = (r: number, c: number) => Array.from({ length: r }, () => Array(c).fill(''));

function Stepper({ label, value, onChange, min = 1, max = 40 }: { label: string; value: number; onChange: (n: number) => void; min?: number; max?: number }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[12px] text-fg-muted">{label}</span>
      <div className="flex h-7 items-center rounded-md ring-1 ring-inset ring-border">
        <button className="flex h-full w-6 items-center justify-center text-fg-muted hover:text-fg disabled:opacity-40" disabled={value <= min} onClick={() => onChange(value - 1)} aria-label={`Fewer ${label}`}>
          <Minus className="size-3" />
        </button>
        <span className="w-6 text-center text-[12px] tabular-nums">{value}</span>
        <button className="flex h-full w-6 items-center justify-center text-fg-muted hover:text-fg disabled:opacity-40" disabled={value >= max} onClick={() => onChange(value + 1)} aria-label={`More ${label}`}>
          <Plus className="size-3" />
        </button>
      </div>
    </div>
  );
}

function TableGenerator({ api, close }: { api: PluginAPI; close: () => void }) {
  const [m, setM] = useState<TableModel>(() => ({
    cells: blank(4, 3),
    align: ['l', 'c', 'r'],
    header: true,
    booktabs: api.settings.get('booktabs', true),
    verticalRules: false,
    escape: true,
    caption: '',
    label: 'tab:',
    float: true,
    placement: api.settings.get('placement', 'htbp'),
  }));
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const gridRef = useRef<HTMLDivElement>(null);
  const rows = m.cells.length;
  const cols = m.align.length;
  const code = useMemo(() => generateLatex({ ...m, label: m.label === 'tab:' ? '' : m.label }), [m]);

  const set = (patch: Partial<TableModel>) => setM((x) => ({ ...x, ...patch }));
  const resize = (r: number, c: number) =>
    setM((x) => ({
      ...x,
      cells: Array.from({ length: r }, (_, i) => Array.from({ length: c }, (_, j) => x.cells[i]?.[j] ?? '')),
      align: Array.from({ length: c }, (_, j) => x.align[j] ?? 'l'),
    }));
  const setCell = (r: number, c: number, v: string) =>
    setM((x) => ({ ...x, cells: x.cells.map((row, i) => (i === r ? row.map((cell, j) => (j === c ? v : cell)) : row)) }));

  const fillFrom = (r0: number, c0: number, data: string[][]) => {
    if (!data.length) return;
    setM((x) => {
      const R = Math.max(x.cells.length, r0 + data.length);
      const C = Math.max(x.align.length, c0 + Math.max(...data.map((d) => d.length)));
      const cells = Array.from({ length: R }, (_, i) => Array.from({ length: C }, (_, j) => x.cells[i]?.[j] ?? ''));
      data.forEach((row, i) => row.forEach((v, j) => (cells[r0 + i][c0 + j] = v)));
      return { ...x, cells, align: Array.from({ length: C }, (_, j) => x.align[j] ?? 'l') };
    });
  };

  const onPaste = (e: ClipboardEvent<HTMLInputElement>, r: number, c: number) => {
    const text = e.clipboardData.getData('text/plain');
    if (!/[\t\n]/.test(text.replace(/\n$/, ''))) return; // single value: normal paste
    e.preventDefault();
    fillFrom(r, c, parseDelimited(text));
  };

  const insert = async () => {
    api.editor.insertText(code);
    if (m.booktabs && api.settings.get('addPackage', true)) await ensurePackage(api, 'booktabs');
    close();
    api.editor.focus();
  };

  return (
    <div className="space-y-3 pb-1">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Stepper label="Rows" value={rows} onChange={(n) => resize(n, cols)} />
        <Stepper label="Columns" value={cols} onChange={(n) => resize(rows, n)} max={20} />
        <label className="flex items-center gap-1.5 text-[12px] text-fg-muted">
          <Switch size="sm" checked={m.header} onCheckedChange={(v) => set({ header: v })} /> Header row
        </label>
        <label className="flex items-center gap-1.5 text-[12px] text-fg-muted">
          <Switch size="sm" checked={m.booktabs} onCheckedChange={(v) => set({ booktabs: v })} /> booktabs
        </label>
        {!m.booktabs && (
          <label className="flex items-center gap-1.5 text-[12px] text-fg-muted">
            <Switch size="sm" checked={m.verticalRules} onCheckedChange={(v) => set({ verticalRules: v })} /> Grid lines
          </label>
        )}
        <label className="flex items-center gap-1.5 text-[12px] text-fg-muted" title="Escape & % $ # _ { } ~ ^ \\ in cells">
          <Switch size="sm" checked={m.escape} onCheckedChange={(v) => set({ escape: v })} /> Escape specials
        </label>
        <div className="flex-1" />
        <Button size="sm" variant="ghost" icon={<ClipboardPaste />} onClick={() => setPasteOpen((v) => !v)}>
          Paste data…
        </Button>
      </div>

      {pasteOpen && (
        <div className="space-y-2 rounded-lg bg-surface-2 p-2.5 ring-1 ring-inset ring-border">
          <Textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder={'Paste cells from Excel, Google Sheets, Numbers, or CSV/TSV text…'}
            className="min-h-24 font-mono text-[12px]"
          />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setPasteOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={!pasteText.trim()}
              onClick={() => {
                const data = parseDelimited(pasteText);
                setM((x) => ({ ...x, cells: data, align: Array.from({ length: data[0]?.length ?? 1 }, (_, j) => x.align[j] ?? 'l') }));
                setPasteOpen(false);
                setPasteText('');
              }}
            >
              Replace table
            </Button>
          </div>
        </div>
      )}

      <div ref={gridRef} className="max-h-[38vh] overflow-auto rounded-lg ring-1 ring-inset ring-border">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="bg-surface-2">
              <th className="w-7" />
              {m.align.map((a, j) => (
                <th key={j} className="border-l border-border px-1 py-1 font-normal">
                  <div className="flex items-center justify-center gap-1">
                    <Segmented
                      size="sm"
                      value={a}
                      onChange={(v) => set({ align: m.align.map((x, k) => (k === j ? v : x)) })}
                      options={[
                        { value: 'l', label: '', icon: <AlignLeft />, title: 'Left' },
                        { value: 'c', label: '', icon: <AlignCenter />, title: 'Center' },
                        { value: 'r', label: '', icon: <AlignRight />, title: 'Right' },
                      ]}
                    />
                    <button
                      disabled={cols <= 1}
                      onClick={() => setM((x) => ({ ...x, cells: x.cells.map((r) => r.filter((_, k) => k !== j)), align: x.align.filter((_, k) => k !== j) }))}
                      className="rounded p-1 text-fg-subtle hover:bg-hover hover:text-danger disabled:opacity-30"
                      aria-label="Delete column"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {m.cells.map((row, i) => (
              <tr key={i} className={i === 0 && m.header ? 'bg-accent-soft/40' : ''}>
                <td className="border-t border-border text-center">
                  <button
                    disabled={rows <= 1}
                    onClick={() => setM((x) => ({ ...x, cells: x.cells.filter((_, k) => k !== i) }))}
                    className="rounded p-1 text-fg-subtle hover:bg-hover hover:text-danger disabled:opacity-30"
                    aria-label="Delete row"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </td>
                {row.map((cell, j) => (
                  <td key={j} className="border-l border-t border-border p-0">
                    <input
                      value={cell}
                      onChange={(e) => setCell(i, j, e.target.value)}
                      onPaste={(e) => onPaste(e, i, j)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          if (i === rows - 1) resize(rows + 1, cols);
                          requestAnimationFrame(() =>
                            gridRef.current?.querySelector<HTMLInputElement>(`[data-cell="${i + 1}:${j}"]`)?.focus(),
                          );
                        }
                      }}
                      data-cell={`${i}:${j}`}
                      spellCheck={false}
                      className={`h-8 w-full min-w-20 bg-transparent px-2 text-fg outline-none focus:bg-accent-soft focus:ring-2 focus:ring-inset focus:ring-accent/50 ${
                        i === 0 && m.header ? 'font-semibold' : ''
                      } ${m.align[j] === 'c' ? 'text-center' : m.align[j] === 'r' ? 'text-right' : ''}`}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
        <label className="block">
          <span className="mb-1 block text-[11.5px] font-medium text-fg-muted">Caption</span>
          <Input inputSize="sm" value={m.caption} onChange={(e) => set({ caption: e.target.value })} placeholder="Results of the experiment" />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11.5px] font-medium text-fg-muted">Label</span>
          <Input inputSize="sm" value={m.label} onChange={(e) => set({ label: e.target.value })} placeholder="tab:results" className="font-mono" />
        </label>
        <label className="flex h-7 items-center gap-1.5 whitespace-nowrap text-[12px] text-fg-muted" title="Wrap in a floating table environment">
          <Switch size="sm" checked={m.float} onCheckedChange={(v) => set({ float: v })} /> Float
        </label>
      </div>

      <div className="relative">
        <pre className="max-h-44 overflow-auto rounded-lg bg-surface-2 p-3 font-mono text-[11.5px] leading-relaxed text-fg-muted ring-1 ring-inset ring-border">{code}</pre>
        <button
          className="absolute right-2 top-2 rounded-md bg-surface p-1.5 text-fg-subtle ring-1 ring-border hover:text-fg"
          onClick={() => {
            void navigator.clipboard?.writeText(code);
            api.ui.toast('LaTeX copied to the clipboard', { type: 'success' });
          }}
          aria-label="Copy LaTeX"
        >
          <Copy className="size-3.5" />
        </button>
      </div>

      <div className="flex items-center justify-between gap-2 pt-1">
        <span className="text-[11.5px] text-fg-subtle">Tip: paste a range of cells into any cell to fill the grid.</span>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void insert()}>
            Insert table
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Add \usepackage{pkg} to the main file's preamble when missing. */
export async function ensurePackage(api: PluginAPI, pkg: string): Promise<boolean> {
  const main = api.project.getMainPath();
  if (!main) return false;
  const src = await api.project.readFile(main);
  if (typeof src !== 'string') return false;
  if (new RegExp(`\\\\usepackage\\s*(\\[[^\\]]*\\])?\\s*\\{[^}]*\\b${pkg}\\b[^}]*\\}`).test(src)) return false;
  const begin = src.search(/\\begin\s*\{document\}/);
  if (begin < 0) return false;
  const preamble = src.slice(0, begin);
  const lastPkg = [...preamble.matchAll(/^.*\\usepackage.*$/gm)].pop();
  const dc = /^.*\\documentclass.*$/m.exec(preamble);
  const at = lastPkg ? lastPkg.index! + lastPkg[0].length : dc ? dc.index + dc[0].length : 0;
  await api.project.writeFile(main, `${src.slice(0, at)}\n\\usepackage{${pkg}}${src.slice(at)}`);
  api.ui.toast(`Added \\usepackage{${pkg}} to ${main}`, { type: 'info' });
  return true;
}

export default definePlugin({
  id: 'org.texit.tablegen',
  name: 'Table generator',
  version: '1.0.0',
  author: 'TexIt',
  icon: 'table',
  description: 'Build LaTeX tables in a spreadsheet-like grid — paste from Excel/Sheets/CSV, set alignment, booktabs, caption and label.',
  permissions: ['editor', 'ui', 'project:write'],
  tags: ['tables', 'insert'],
  settings: [
    { key: 'booktabs', title: 'Use booktabs by default', type: 'boolean', default: true },
    { key: 'addPackage', title: 'Add \\usepackage{booktabs} when missing', type: 'boolean', default: true },
    { key: 'placement', title: 'Float placement', type: 'string', default: 'htbp', placeholder: 'htbp' },
  ],
  activate(api) {
    api.commands.register({
      id: 'insert',
      title: 'Insert table…',
      category: 'Insert',
      icon: 'table',
      keybinding: 'Mod-Alt-t',
      run: () =>
        api.ui.modal({
          title: 'Insert table',
          width: 900,
          render: (el, close) => mountReact(el, <TableGenerator api={api} close={close} />),
        }),
    });
  },
});

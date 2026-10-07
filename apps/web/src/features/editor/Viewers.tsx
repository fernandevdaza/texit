import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Maximize, Minus, Plus, Scan } from 'lucide-react';
import { extname, type FileNode } from '@texit/core';
import { useWorkspace } from '@/state/workspace';
import { downloadBlob, formatBytes } from '@/lib/format';
import { Button, IconButton, Kbd, Logo } from '@/ui';
import { executeCommand } from '@/services/commands';
import { FileIcon, fileTypeLabel } from '@/features/files/FileIcon';
import { PdfViewer } from '@/features/pdf/PdfViewer';

function useBinary(file: FileNode): Uint8Array | null {
  const project = useWorkspace((s) => s.project);
  const [data, setData] = useState<Uint8Array | null>(null);
  useEffect(() => {
    if (!project) return;
    setData(project.readBinary(file.id));
    const off = project.onContentChange((ids) => ids.has(file.id) && setData(project.readBinary(file.id)));
    return off;
  }, [project, file.id]);
  return data;
}

const mime: Record<string, string> = {
  svg: 'image/svg+xml',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  avif: 'image/avif',
};

export function ImageViewer({ file }: { file: FileNode }) {
  const data = useBinary(file);
  const url = useMemo(() => (data ? URL.createObjectURL(new Blob([data as BlobPart], { type: mime[extname(file.path)] ?? 'application/octet-stream' })) : null), [data, file.path]);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState<number | 'fit'>('fit');
  const box = useRef<HTMLDivElement>(null);
  const [fitScale, setFitScale] = useState(1);

  useEffect(() => {
    const el = box.current;
    if (!el || !dims) return;
    const measure = () => setFitScale(Math.min(1, (el.clientWidth - 64) / dims.w, (el.clientHeight - 64) / dims.h));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [dims]);

  const scale = zoom === 'fit' ? fitScale : zoom;
  const step = (dir: 1 | -1) => setZoom(Math.max(0.05, Math.min(16, +(scale * (dir > 0 ? 1.25 : 0.8)).toFixed(3))));

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="flex h-9 shrink-0 items-center gap-1 overflow-hidden whitespace-nowrap border-b border-border px-2 text-[12px] text-fg-muted">
        <span className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
          <span className="shrink-0 truncate text-fg-subtle tabular-nums">
            {dims ? `${dims.w} × ${dims.h} px · ` : ''}
            {formatBytes(file.size)}
          </span>
        </span>
        <IconButton size="xs" label="Zoom out" onClick={() => step(-1)}>
          <Minus />
        </IconButton>
        <button onClick={() => setZoom(1)} className="h-6 min-w-12 rounded-md px-1.5 text-[11.5px] tabular-nums hover:bg-hover" title="Actual size">
          {Math.round(scale * 100)}%
        </button>
        <IconButton size="xs" label="Zoom in" onClick={() => step(1)}>
          <Plus />
        </IconButton>
        <IconButton size="xs" label="Fit to window" active={zoom === 'fit'} onClick={() => setZoom('fit')}>
          <Scan />
        </IconButton>
        <IconButton size="xs" label="Actual size" active={zoom === 1} onClick={() => setZoom(1)}>
          <Maximize />
        </IconButton>
        <IconButton size="xs" label="Download" onClick={() => data && downloadBlob(data, file.name, mime[extname(file.path)])}>
          <Download />
        </IconButton>
      </div>
      <div
        ref={box}
        className="tx-checker-bg flex min-h-0 flex-1 overflow-auto"
        onWheel={(e) => {
          if (!e.ctrlKey && !e.metaKey) return;
          e.preventDefault();
          step(e.deltaY < 0 ? 1 : -1);
        }}
      >
        {url && (
          <div className="m-auto p-8">
            <img
              src={url}
              alt={file.name}
              draggable={false}
              onLoad={(e) => setDims({ w: e.currentTarget.naturalWidth || 1, h: e.currentTarget.naturalHeight || 1 })}
              style={dims ? { width: dims.w * scale, height: dims.h * scale, maxWidth: 'none' } : { maxWidth: '100%' }}
              className="block shadow-[0_0_0_1px_var(--tx-border),0_8px_30px_-10px_rgb(0_0_0/0.25)] [image-rendering:auto]"
            />
          </div>
        )}
      </div>
      <style>{`.tx-checker-bg{background-color:var(--tx-surface);background-image:linear-gradient(45deg,var(--tx-surface-2) 25%,transparent 25%),linear-gradient(-45deg,var(--tx-surface-2) 25%,transparent 25%),linear-gradient(45deg,transparent 75%,var(--tx-surface-2) 75%),linear-gradient(-45deg,transparent 75%,var(--tx-surface-2) 75%);background-size:20px 20px;background-position:0 0,0 10px,10px -10px,-10px 0}`}</style>
    </div>
  );
}

export function PdfFileView({ file }: { file: FileNode }) {
  const data = useBinary(file);
  const [version, setVersion] = useState(0);
  useEffect(() => setVersion((v) => v + 1), [data]);
  if (!data) return null;
  return <PdfViewer data={data} version={version} fileName={file.name} className="h-full" />;
}

export function BinaryCard({ file }: { file: FileNode }) {
  const project = useWorkspace((s) => s.project);
  return (
    <div className="flex h-full items-center justify-center bg-surface p-6">
      <div className="flex w-full max-w-sm flex-col items-center rounded-2xl border border-border bg-surface-2/40 px-8 py-9 text-center shadow-card">
        <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-surface ring-1 ring-border">
          <FileIcon path={file.path} className="size-7" />
        </div>
        <div className="max-w-full truncate text-[14px] font-semibold text-fg">{file.name}</div>
        <div className="mt-1 text-[12px] text-fg-subtle">
          {fileTypeLabel(file.path)} · {formatBytes(file.size)}
        </div>
        <p className="mt-3 text-[12.5px] leading-relaxed text-fg-muted">This is a binary file, so it can’t be edited here. It’s still part of the project and is used when compiling.</p>
        <Button className="mt-5" size="sm" icon={<Download />} onClick={() => project && downloadBlob(project.readBinary(file.id), file.name)}>
          Download
        </Button>
      </div>
    </div>
  );
}

const shortcuts: { label: string; keys: string; command?: string }[] = [
  { label: 'Open file', keys: 'Mod-p', command: 'view.quickOpen' },
  { label: 'Command palette', keys: 'Mod-Shift-p', command: 'view.commandPalette' },
  { label: 'Compile', keys: 'Mod-Enter', command: 'compile.run' },
  { label: 'Ask AI', keys: 'Mod-l', command: 'view.toggleAi' },
  { label: 'Find in project', keys: 'Mod-Shift-f', command: 'edit.findInProject' },
  { label: 'Toggle sidebar', keys: 'Mod-Shift-b', command: 'view.toggleSidebar' },
];

export function EmptyEditor() {
  return (
    <div className="flex h-full select-none items-center justify-center bg-surface p-6">
      <div className="flex w-full max-w-[340px] flex-col items-center">
        <div className="relative mb-5">
          <div className="absolute inset-0 -z-0 scale-150 rounded-full bg-accent/15 blur-2xl" />
          <Logo size={52} className="relative opacity-90 drop-shadow-sm" />
        </div>
        <div className="text-[15px] font-semibold tracking-tight text-fg">No file open</div>
        <div className="mt-1 text-[12.5px] text-fg-subtle">Pick a file from the sidebar, or use a shortcut.</div>
        <div className="mt-6 w-full space-y-0.5">
          {shortcuts.map((s) => (
            <button
              key={s.keys}
              onClick={() => s.command && void executeCommand(s.command)}
              className="group flex h-8 w-full items-center justify-between rounded-lg px-3 text-[12.5px] text-fg-muted transition-colors hover:bg-hover hover:text-fg"
            >
              <span>{s.label}</span>
              <Kbd keys={s.keys} className="opacity-80 group-hover:opacity-100" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

import { useMemo } from 'react';
import { ChevronRight, Crosshair, Hash, Heading } from 'lucide-react';
import type { FileNode, OutlineItem } from '@texit/core';
import { useWorkspace } from '@/state/workspace';
import { useSettings } from '@/state/settings';
import { executeCommand } from '@/services/commands';
import { getEditorBridge } from '@/services/editor';
import { cn } from '@/lib/cn';
import { IconButton } from '@/ui';
import { FileIcon } from '@/features/files/FileIcon';
import { revealInTree } from '@/features/files/api';
import { getProjectIndex } from './projectIndex';
import { useIndexVersion } from './presence';

/** Chain of outline items enclosing `line` (outermost first). */
export function sectionChain(outline: OutlineItem[], line: number): OutlineItem[] {
  const stack: OutlineItem[] = [];
  for (const item of outline) {
    if (item.line > line) break;
    while (stack.length && stack[stack.length - 1].level >= item.level) stack.pop();
    stack.push(item);
  }
  return stack;
}

export function Breadcrumbs({ file, isText }: { file: FileNode; isText: boolean }) {
  const cursorLine = useWorkspace((s) => s.cursor.line);
  const files = useWorkspace((s) => s.files);
  const version = useIndexVersion();
  const richText = useSettings((s) => s.editor.richText);
  const segments = file.path.split('/');
  const isTex = isText && /\.(tex|ltx|latex)$/i.test(file.path);

  const chain = useMemo(() => {
    if (!isTex) return [];
    const idx = getProjectIndex();
    if (!idx) return [];
    try {
      return sectionChain(idx.analysis(file.id).outline, cursorLine);
    } catch {
      return [];
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTex, file.id, cursorLine, version]);

  const folderIdFor = (i: number) => {
    const path = segments.slice(0, i + 1).join('/');
    return files.find((f) => f.path === path)?.id;
  };

  return (
    <div className="flex h-7 shrink-0 items-center gap-0.5 border-b border-border bg-surface pl-3 pr-1.5 text-[12px] text-fg-subtle">
      <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden">
        {segments.map((seg, i) => {
          const last = i === segments.length - 1;
          return (
            <span key={i} className="flex min-w-0 shrink items-center gap-0.5">
              {i > 0 && <ChevronRight className="size-3 shrink-0 opacity-60" />}
              <button
                onClick={() => revealInTree(last ? file.id : (folderIdFor(i) ?? file.id))}
                className={cn('flex min-w-0 items-center gap-1 truncate rounded px-1 py-0.5 hover:bg-hover hover:text-fg', last && 'text-fg-muted')}
              >
                {last && <FileIcon path={file.path} className="size-3.5" />}
                <span className="truncate">{seg}</span>
              </button>
            </span>
          );
        })}
        {chain.map((item, i) => (
          <span key={`${item.line}-${i}`} className="flex min-w-0 shrink items-center gap-0.5">
            <ChevronRight className="size-3 shrink-0 opacity-60" />
            <button
              onClick={() => {
                useWorkspace.getState().revealLocation(file.id, item.line);
                requestAnimationFrame(() => getEditorBridge()?.focus());
              }}
              title={item.title}
              className={cn('flex min-w-0 items-center gap-1 rounded px-1 py-0.5 hover:bg-hover hover:text-fg', i === chain.length - 1 && 'text-fg-muted')}
            >
              <Hash className="size-3 shrink-0 opacity-70" />
              <span className="max-w-[220px] truncate">{item.title || item.kind}</span>
            </button>
          </span>
        ))}
      </div>
      {isTex && (
        <div className="flex shrink-0 items-center gap-0.5">
          <IconButton
            size="xs"
            label={richText ? 'Rich text: on' : 'Rich text: off'}
            active={richText}
            onClick={() => executeCommand('editor.toggleRichText')}
          >
            <Heading />
          </IconButton>
          <IconButton size="xs" label="Show in PDF" shortcut="Mod-Alt-j" onClick={() => executeCommand('editor.syncToPdf')}>
            <Crosshair />
          </IconButton>
        </div>
      )}
    </div>
  );
}

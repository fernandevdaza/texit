import { usePanelRegistry } from '@/services/panels';
import { useWorkspace } from '@/state/workspace';

/**
 * Bottom status bar. Built-in items: cursor position. Features and plugins add
 * items through `registerStatusItem` (compile status, collaborators, word count…).
 */
export function StatusBar() {
  const items = usePanelRegistry((s) => s.statusItems);
  const left = items.filter((i) => i.align === 'left');
  const right = items.filter((i) => i.align === 'right');
  const hasProject = useWorkspace((s) => !!s.project);

  return (
    <footer className="flex h-6 shrink-0 select-none items-center gap-0.5 border-t border-border bg-surface px-2 text-[11px] text-fg-subtle">
      {hasProject &&
        left.map((i) => {
          const C = i.component;
          return <C key={i.id} />;
        })}
      <div className="flex-1" />
      {hasProject && <CursorItem />}
      {hasProject &&
        right.map((i) => {
          const C = i.component;
          return <C key={i.id} />;
        })}
    </footer>
  );
}

function CursorItem() {
  const { line, column, selected } = useWorkspace((s) => s.cursor);
  const active = useWorkspace((s) => !!s.activeFileId);
  if (!active) return null;
  return (
    <span className="px-1.5 tabular-nums">
      Ln {line}, Col {column}
      {selected > 0 && <span className="text-fg-subtle/80"> ({selected} selected)</span>}
    </span>
  );
}

/** Shared styling for status bar items. */
export function StatusButton({ children, onClick, title, className }: { children: React.ReactNode; onClick?: () => void; title?: string; className?: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`flex h-5 items-center gap-1 rounded px-1.5 transition-colors hover:bg-hover hover:text-fg [&_svg]:size-3 ${className ?? ''}`}
    >
      {children}
    </button>
  );
}

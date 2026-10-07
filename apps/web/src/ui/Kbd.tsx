import { cn } from '@/lib/cn';
import { formatKeybinding } from '@/lib/platform';

/** Displays a CodeMirror-notation shortcut ("Mod-Shift-p") as keycaps. */
export function Kbd({ keys, className, variant = 'default' }: { keys: string; className?: string; variant?: 'default' | 'tooltip' }) {
  return (
    <span className={cn('inline-flex items-center gap-0.5', className)}>
      {formatKeybinding(keys).map((k, i) => (
        <kbd
          key={i}
          className={cn(
            'inline-flex h-[18px] min-w-[18px] items-center justify-center rounded px-1 font-sans text-[10.5px] font-medium',
            variant === 'tooltip' ? 'bg-white/15 text-white/80' : 'border border-border bg-surface-2 text-fg-subtle',
          )}
        >
          {k}
        </kbd>
      ))}
    </span>
  );
}

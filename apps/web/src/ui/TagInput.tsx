import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Hash, X } from 'lucide-react';
import { cn } from '@/lib/cn';

/** Normalise a free-form tag ("  Thesis 2025 " → "thesis-2025"). */
export function normalizeTag(t: string): string {
  return t
    .trim()
    .toLowerCase()
    .replace(/^#/, '')
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}_\-.]/gu, '')
    .slice(0, 32);
}

/** Chip-style tag editor with suggestions. Enter / comma adds, Backspace removes the last tag. */
export function TagInput({
  value,
  onChange,
  suggestions = [],
  placeholder = 'Add a tag…',
  autoFocus,
  className,
}: {
  value: string[];
  onChange: (tags: string[]) => void;
  suggestions?: string[];
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
}) {
  const [draft, setDraft] = useState('');
  const [hl, setHl] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const matches = useMemo(() => {
    const d = normalizeTag(draft);
    return suggestions.filter((s) => !value.includes(s) && (!d || s.includes(d))).slice(0, 6);
  }, [draft, suggestions, value]);

  const add = (raw: string) => {
    const t = normalizeTag(raw);
    if (t && !value.includes(t)) onChange([...value, t]);
    setDraft('');
    setHl(0);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === 'Tab') {
      if (!draft.trim()) return;
      e.preventDefault();
      add(matches.length && draft && hl >= 0 && matches[hl] && e.key !== ',' ? matches[hl]! : draft);
    } else if (e.key === 'Backspace' && !draft && value.length) {
      onChange(value.slice(0, -1));
    } else if (e.key === 'ArrowDown' && matches.length) {
      e.preventDefault();
      setHl((h) => (h + 1) % matches.length);
    } else if (e.key === 'ArrowUp' && matches.length) {
      e.preventDefault();
      setHl((h) => (h - 1 + matches.length) % matches.length);
    }
  };

  return (
    <div className={cn('space-y-2', className)}>
      <div
        onClick={() => inputRef.current?.focus()}
        className="flex min-h-8 w-full flex-wrap items-center gap-1 rounded-lg border border-border bg-surface px-1.5 py-1 shadow-xs transition-[border,box-shadow] focus-within:border-accent focus-within:ring-3 focus-within:ring-accent/15"
      >
        {value.map((t) => (
          <span
            key={t}
            className="inline-flex h-[22px] items-center gap-1 rounded-md bg-accent-soft pl-1.5 pr-0.5 text-[11.5px] font-medium text-accent"
          >
            <Hash className="size-3 opacity-60" />
            {t}
            <button
              type="button"
              aria-label={`Remove ${t}`}
              onClick={(e) => {
                e.stopPropagation();
                onChange(value.filter((x) => x !== t));
              }}
              className="flex size-4 items-center justify-center rounded opacity-60 hover:bg-accent/15 hover:opacity-100"
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          autoFocus={autoFocus}
          value={draft}
          spellCheck={false}
          onChange={(e) => {
            setDraft(e.target.value);
            setHl(0);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => draft.trim() && add(draft)}
          placeholder={value.length ? '' : placeholder}
          className="h-[22px] min-w-[80px] flex-1 bg-transparent px-1 text-[12.5px] text-fg outline-none placeholder:text-fg-subtle"
        />
      </div>
      {matches.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="mr-0.5 text-[11px] text-fg-subtle">Suggestions</span>
          {matches.map((s, i) => (
            <button
              key={s}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => add(s)}
              className={cn(
                'inline-flex h-[22px] items-center gap-0.5 rounded-md border border-border px-1.5 text-[11.5px] text-fg-muted transition-colors hover:border-accent/40 hover:text-fg',
                draft && i === hl && 'border-accent/40 bg-accent-soft text-accent',
              )}
            >
              <Hash className="size-3 opacity-50" />
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

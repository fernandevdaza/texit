import { useMemo } from 'react';
import { cn } from '@/lib/cn';

/**
 * Renders `text` with the characters at `positions` emphasised (fuzzy-match
 * highlighting). `offset` shifts positions when rendering a slice of a string.
 */
export function Highlight({
  text,
  positions,
  offset = 0,
  className,
  markClassName,
}: {
  text: string;
  positions?: number[] | null;
  offset?: number;
  className?: string;
  markClassName?: string;
}) {
  const parts = useMemo(() => {
    if (!positions?.length) return null;
    const set = new Set(positions.map((p) => p - offset));
    const out: { s: string; hit: boolean }[] = [];
    for (let i = 0; i < text.length; i++) {
      const hit = set.has(i);
      const last = out[out.length - 1];
      if (last && last.hit === hit) last.s += text[i];
      else out.push({ s: text[i]!, hit });
    }
    return out;
  }, [text, positions, offset]);

  if (!parts) return <span className={className}>{text}</span>;
  return (
    <span className={className}>
      {parts.map((p, i) =>
        p.hit ? (
          <mark key={i} className={cn('rounded-[2px] bg-transparent font-semibold text-accent', markClassName)}>
            {p.s}
          </mark>
        ) : (
          <span key={i}>{p.s}</span>
        ),
      )}
    </span>
  );
}

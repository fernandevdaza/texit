import { useId, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Switch } from '@/ui';

/** A titled group of rows (rounded card with dividers). */
export function Card({ title, description, children, className, action }: { title?: ReactNode; description?: ReactNode; children: ReactNode; className?: string; action?: ReactNode }) {
  return (
    <section className={cn('mb-7 last:mb-0', className)}>
      {(title || action) && (
        <div className="mb-2 flex items-end justify-between gap-3 px-0.5">
          {title && <h3 className="text-[12px] font-semibold tracking-tight text-fg-muted">{title}</h3>}
          {action}
        </div>
      )}
      <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface shadow-[0_1px_2px_rgb(0_0_0/0.03)]">{children}</div>
      {description && <p className="mt-2 px-0.5 text-[11.5px] leading-relaxed text-fg-subtle">{description}</p>}
    </section>
  );
}

/** Label/description on the left, control on the right. `stack` puts the control underneath. */
export function Row({
  title,
  description,
  children,
  htmlFor,
  stack,
  className,
  badge,
}: {
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  htmlFor?: string;
  stack?: boolean;
  className?: string;
  badge?: ReactNode;
}) {
  const label = (
    <div className="min-w-0">
      <label htmlFor={htmlFor} className="flex items-center gap-2 text-[13px] font-medium text-fg">
        {title}
        {badge}
      </label>
      {description && <div className="mt-0.5 text-[12px] leading-relaxed text-fg-subtle">{description}</div>}
    </div>
  );
  if (stack)
    return (
      <div className={cn('space-y-2.5 px-4 py-3.5', className)}>
        {label}
        {children}
      </div>
    );
  return (
    <div className={cn('flex min-h-[52px] items-center justify-between gap-6 px-4 py-3', className)}>
      {label}
      {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </div>
  );
}

export function ToggleRow({
  title,
  description,
  checked,
  onChange,
  disabled,
  badge,
}: {
  title: ReactNode;
  description?: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  badge?: ReactNode;
}) {
  const id = useId();
  return (
    <Row title={title} description={description} htmlFor={id} badge={badge} className={cn(disabled && 'opacity-60')}>
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </Row>
  );
}

/** Selectable tile used for theme / backend / PDF style choices. */
export function Tile({
  selected,
  onSelect,
  children,
  label,
  description,
  disabled,
  className,
}: {
  selected: boolean;
  onSelect: () => void;
  children?: ReactNode;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        'group relative flex flex-col overflow-hidden rounded-xl border bg-surface text-left outline-none transition-[border,box-shadow,transform] duration-150 focus-visible:ring-3 focus-visible:ring-accent/30 disabled:cursor-not-allowed disabled:opacity-55',
        selected ? 'border-accent shadow-[0_0_0_1px_var(--tx-accent),0_6px_20px_-8px_color-mix(in_srgb,var(--tx-accent)_45%,transparent)]' : 'border-border hover:border-border-strong',
        className,
      )}
    >
      {children}
      <div className="flex items-start gap-2 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="text-[12.5px] font-medium text-fg">{label}</div>
          {description && <div className="mt-0.5 text-[11.5px] leading-snug text-fg-subtle">{description}</div>}
        </div>
        <span
          className={cn(
            'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors',
            selected ? 'border-accent bg-accent text-accent-fg' : 'border-border-strong',
          )}
        >
          {selected && <Check className="size-2.5" strokeWidth={3.5} />}
        </span>
      </div>
    </button>
  );
}

export function ValuePill({ children }: { children: ReactNode }) {
  return <span className="min-w-[48px] rounded-md bg-surface-2 px-1.5 py-0.5 text-center font-mono text-[11.5px] tabular-nums text-fg-muted ring-1 ring-border">{children}</span>;
}

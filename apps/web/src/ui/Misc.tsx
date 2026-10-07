import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';
  className?: string;
}) {
  const tones = {
    neutral: 'bg-surface-2 text-fg-muted ring-border',
    accent: 'bg-accent-soft text-accent ring-accent/20',
    success: 'bg-success-soft text-success ring-success/20',
    warning: 'bg-warning-soft text-warning ring-warning/20',
    danger: 'bg-danger-soft text-danger ring-danger/20',
    info: 'bg-info-soft text-info ring-info/20',
  };
  return (
    <span
      className={cn(
        'inline-flex h-[18px] items-center gap-1 whitespace-nowrap rounded-full px-1.5 text-[10.5px] font-semibold ring-1 ring-inset [&_svg]:size-3',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-10 text-center', className)}>
      {icon && (
        <div className="mb-3 flex size-10 items-center justify-center rounded-xl bg-surface-2 text-fg-subtle ring-1 ring-border [&_svg]:size-5">
          {icon}
        </div>
      )}
      <div className="text-[13px] font-medium text-fg">{title}</div>
      {description && <div className="mt-1 max-w-xs text-[12px] leading-relaxed text-fg-subtle">{description}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Small uppercase section header used in side panels. */
export function PanelHeader({ title, actions, className }: { title: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex h-9 shrink-0 items-center justify-between gap-2 pl-3 pr-1.5', className)}>
      <span className="truncate text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">{title}</span>
      {actions && <div className="flex items-center gap-0.5">{actions}</div>}
    </div>
  );
}

const avatarColors = ['#f97316', '#eab308', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6', '#6366f1', '#a855f7', '#ec4899', '#f43f5e'];

export function colorForName(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return avatarColors[h % avatarColors.length];
}

export function Avatar({ name, color, size = 24, className, ring }: { name: string; color?: string; size?: number; className?: string; ring?: boolean }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]!.toUpperCase())
    .join('');
  return (
    <span
      title={name}
      className={cn('inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white', ring && 'ring-2 ring-surface', className)}
      style={{ width: size, height: size, fontSize: size * 0.4, background: color ?? colorForName(name) }}
    >
      {initials || '?'}
    </span>
  );
}

export function Logo({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} aria-label="TexIt">
      <defs>
        <linearGradient id="tx-logo-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6d6dff" />
          <stop offset="1" stopColor="#b25cff" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="url(#tx-logo-g)" />
      <path d="M9 10.5h14M16 10.5v12" stroke="white" strokeWidth="3" strokeLinecap="round" />
      <path d="M19.5 18.5l3.5 4M23 18.5l-3.5 4" stroke="white" strokeOpacity=".75" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

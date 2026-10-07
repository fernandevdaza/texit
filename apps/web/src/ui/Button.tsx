import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Tooltip } from './Tooltip';
import { Spinner } from './Spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'outline' | 'danger' | 'subtle' | 'gradient';
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg';

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-fg hover:bg-accent-hover shadow-sm shadow-accent/20',
  secondary: 'bg-surface text-fg border border-border hover:bg-hover hover:border-border-strong shadow-xs',
  ghost: 'text-fg-muted hover:text-fg hover:bg-hover',
  outline: 'border border-border-strong text-fg hover:bg-hover',
  danger: 'bg-danger text-white hover:brightness-110 shadow-sm',
  subtle: 'bg-accent-soft text-accent hover:bg-accent/20',
  gradient:
    'text-white shadow-md shadow-accent/25 bg-[linear-gradient(135deg,var(--tx-accent),#a35cff)] hover:brightness-110',
};

const sizes: Record<ButtonSize, string> = {
  xs: 'h-6 px-2 text-[11px] gap-1 rounded-md',
  sm: 'h-7 px-2.5 text-xs gap-1.5 rounded-md',
  md: 'h-8 px-3 text-[13px] gap-2 rounded-lg',
  lg: 'h-10 px-4 text-sm gap-2 rounded-lg',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
  iconRight?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, icon, iconRight, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap font-medium transition-[background,color,border,box-shadow,filter] duration-100 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-[1.15em] [&_svg]:shrink-0',
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner className="size-[1.1em]" /> : icon}
      {children}
      {iconRight}
    </button>
  );
});

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'title'> {
  label: string;
  /** Keyboard shortcut shown in the tooltip (CodeMirror notation, e.g. "Mod-b"). */
  shortcut?: string;
  active?: boolean;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  variant?: 'ghost' | 'secondary' | 'subtle';
  tooltipSide?: 'top' | 'bottom' | 'left' | 'right';
  noTooltip?: boolean;
}

const iconSizes = { xs: 'size-6 [&_svg]:size-3.5 rounded-md', sm: 'size-7 [&_svg]:size-4 rounded-md', md: 'size-8 [&_svg]:size-[17px] rounded-lg', lg: 'size-10 [&_svg]:size-5 rounded-lg' };

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, shortcut, active, size = 'sm', variant = 'ghost', className, tooltipSide = 'bottom', noTooltip, children, type = 'button', ...rest },
  ref,
) {
  const btn = (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        'inline-flex shrink-0 items-center justify-center transition-colors duration-100 disabled:pointer-events-none disabled:opacity-40',
        iconSizes[size],
        variant === 'ghost' && 'text-fg-muted hover:bg-hover hover:text-fg',
        variant === 'secondary' && 'border border-border bg-surface text-fg-muted hover:bg-hover hover:text-fg',
        variant === 'subtle' && 'bg-accent-soft text-accent hover:bg-accent/20',
        active && 'bg-active text-fg',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
  if (noTooltip) return btn;
  return (
    <Tooltip content={label} shortcut={shortcut} side={tooltipSide}>
      {btn}
    </Tooltip>
  );
});

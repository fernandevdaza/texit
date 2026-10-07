import { forwardRef, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { Select as S, Switch as Sw, Popover as P, Tabs as Tb } from 'radix-ui';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';

const fieldCls =
  'w-full rounded-lg border border-border bg-surface px-2.5 text-[13px] text-fg placeholder:text-fg-subtle shadow-xs outline-none transition-[border,box-shadow] focus:border-accent focus:ring-3 focus:ring-accent/15 disabled:opacity-60';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { icon?: ReactNode; inputSize?: 'sm' | 'md' }>(
  function Input({ className, icon, inputSize = 'md', ...rest }, ref) {
    const input = (
      <input
        ref={ref}
        spellCheck={false}
        className={cn(fieldCls, inputSize === 'sm' ? 'h-7 text-xs' : 'h-8', icon && 'pl-8', className)}
        {...rest}
      />
    );
    if (!icon) return input;
    return (
      <div className="relative w-full">
        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle [&_svg]:size-3.5">{icon}</span>
        {input}
      </div>
    );
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...rest },
  ref,
) {
  return <textarea ref={ref} className={cn(fieldCls, 'min-h-20 resize-y py-2 leading-relaxed', className)} {...rest} />;
});

export function Label({ children, hint, className, htmlFor }: { children: ReactNode; hint?: ReactNode; className?: string; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className={cn('mb-1.5 block text-[12px] font-medium text-fg', className)}>
      {children}
      {hint && <span className="ml-1.5 font-normal text-fg-subtle">{hint}</span>}
    </label>
  );
}

export function Field({ label, hint, description, children, className }: { label: ReactNode; hint?: ReactNode; description?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn('space-y-1', className)}>
      <Label hint={hint}>{label}</Label>
      {children}
      {description && <p className="text-[11.5px] leading-relaxed text-fg-subtle">{description}</p>}
    </div>
  );
}

export interface SelectOption<T extends string = string> {
  value: T;
  label: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
}

export function Select<T extends string = string>({
  value,
  onValueChange,
  options,
  placeholder,
  className,
  size = 'md',
  align = 'start',
}: {
  value: T | undefined;
  onValueChange: (v: T) => void;
  options: SelectOption<T>[];
  placeholder?: string;
  className?: string;
  size?: 'sm' | 'md';
  align?: 'start' | 'center' | 'end';
}) {
  return (
    <S.Root value={value} onValueChange={(v) => onValueChange(v as T)}>
      <S.Trigger
        className={cn(
          fieldCls,
          'inline-flex items-center justify-between gap-2 text-left',
          size === 'sm' ? 'h-7 text-xs' : 'h-8',
          className,
        )}
      >
        <S.Value placeholder={placeholder} />
        <S.Icon>
          <ChevronDown className="size-3.5 text-fg-subtle" />
        </S.Icon>
      </S.Trigger>
      <S.Portal>
        <S.Content
          position="popper"
          align={align}
          sideOffset={4}
          className="z-[95] max-h-[min(400px,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] animate-scale-in overflow-hidden rounded-lg border border-border bg-elevated p-1 shadow-pop"
        >
          <S.Viewport>
            {options.map((o) => (
              <S.Item
                key={o.value}
                value={o.value}
                disabled={o.disabled}
                className="relative flex cursor-default select-none items-center gap-2 rounded-md py-1.5 pl-2 pr-7 text-[12.5px] text-fg outline-none data-[disabled]:opacity-40 data-[highlighted]:bg-hover [&_svg]:size-3.5"
              >
                {o.icon && <span className="text-fg-muted">{o.icon}</span>}
                <div className="min-w-0">
                  <S.ItemText>{o.label}</S.ItemText>
                  {o.description && <div className="text-[11px] text-fg-subtle">{o.description}</div>}
                </div>
                <S.ItemIndicator className="absolute right-2">
                  <Check className="text-accent" />
                </S.ItemIndicator>
              </S.Item>
            ))}
          </S.Viewport>
        </S.Content>
      </S.Portal>
    </S.Root>
  );
}

export function Switch({ checked, onCheckedChange, disabled, size = 'md', id }: { checked: boolean; onCheckedChange: (v: boolean) => void; disabled?: boolean; size?: 'sm' | 'md'; id?: string }) {
  return (
    <Sw.Root
      id={id}
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      className={cn(
        'relative inline-flex shrink-0 items-center rounded-full border border-transparent bg-border-strong transition-colors data-[state=checked]:bg-accent disabled:opacity-50',
        size === 'sm' ? 'h-4 w-7' : 'h-5 w-9',
      )}
    >
      <Sw.Thumb
        className={cn(
          'block rounded-full bg-white shadow-sm transition-transform data-[state=unchecked]:translate-x-0.5',
          size === 'sm' ? 'size-3 data-[state=checked]:translate-x-3.5' : 'size-4 data-[state=checked]:translate-x-[18px]',
        )}
      />
    </Sw.Root>
  );
}

/** A row with a label/description on the left and a control on the right (settings screens). */
export function SettingRow({ title, description, children, className }: { title: ReactNode; description?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-center justify-between gap-6 py-3', className)}>
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-fg">{title}</div>
        {description && <div className="mt-0.5 text-[12px] leading-relaxed text-fg-subtle">{description}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function Popover({
  trigger,
  children,
  side = 'bottom',
  align = 'center',
  className,
  open,
  onOpenChange,
}: {
  trigger: ReactNode;
  children: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  align?: 'start' | 'center' | 'end';
  className?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <P.Root open={open} onOpenChange={onOpenChange}>
      <P.Trigger asChild>{trigger}</P.Trigger>
      <P.Portal>
        <P.Content
          side={side}
          align={align}
          sideOffset={6}
          collisionPadding={8}
          className={cn('z-[90] animate-scale-in rounded-xl border border-border bg-elevated p-3 shadow-pop outline-none', className)}
        >
          {children}
        </P.Content>
      </P.Portal>
    </P.Root>
  );
}

/** Pill-style segmented control. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = 'md',
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; icon?: ReactNode; title?: string }[];
  size?: 'sm' | 'md';
  className?: string;
}) {
  return (
    <Tb.Root value={value} onValueChange={(v) => onChange(v as T)} className={className}>
      <Tb.List className={cn('inline-flex items-center gap-0.5 rounded-lg bg-surface-2 p-0.5 ring-1 ring-border', size === 'sm' ? 'h-7' : 'h-8')}>
        {options.map((o) => (
          <Tb.Trigger
            key={o.value}
            value={o.value}
            title={o.title}
            className={cn(
              'inline-flex h-full items-center gap-1.5 rounded-md px-2.5 font-medium text-fg-muted transition-colors hover:text-fg data-[state=active]:bg-surface data-[state=active]:text-fg data-[state=active]:shadow-sm [&_svg]:size-3.5',
              size === 'sm' ? 'text-[11.5px]' : 'text-[12.5px]',
            )}
          >
            {o.icon}
            {o.label}
          </Tb.Trigger>
        ))}
      </Tb.List>
    </Tb.Root>
  );
}

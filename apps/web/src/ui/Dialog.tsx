import { Dialog as D } from 'radix-ui';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export const DialogRoot = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

export interface DialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title?: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  /** Tailwind max-width class, e.g. 'max-w-lg'. */
  width?: string;
  className?: string;
  bodyClassName?: string;
  trigger?: ReactNode;
  hideClose?: boolean;
  /** Render without padding/header (custom layouts like the settings dialog). */
  bare?: boolean;
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  icon,
  children,
  footer,
  width = 'max-w-lg',
  className,
  bodyClassName,
  trigger,
  hideClose,
  bare,
}: DialogProps) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      {trigger && <D.Trigger asChild>{trigger}</D.Trigger>}
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 animate-fade-in bg-black/30 backdrop-blur-[2px] dark:bg-black/50" />
        <D.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 flex max-h-[min(88vh,900px)] w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 animate-scale-in flex-col overflow-hidden rounded-xl border border-border bg-elevated shadow-2xl outline-none',
            width,
            className,
          )}
          onOpenAutoFocus={(e) => {
            // Focus the first field if any (instead of the close button).
            const el = (e.currentTarget as HTMLElement).querySelector<HTMLElement>('input,textarea,select,[data-autofocus]');
            if (el) {
              e.preventDefault();
              el.focus();
            }
          }}
        >
          {bare ? (
            <>
              <D.Title className="sr-only">{title ?? 'Dialog'}</D.Title>
              <D.Description className="sr-only">{typeof title === 'string' ? title : 'Dialog'}</D.Description>
              {children}
            </>
          ) : (
            <>
              {(title || !hideClose) && (
                <div className="flex items-start gap-3 px-5 pb-1 pt-4">
                  {icon && (
                    <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent [&_svg]:size-4">
                      {icon}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    {title && <D.Title className="text-[15px] font-semibold tracking-tight text-fg">{title}</D.Title>}
                    {description ? (
                      <D.Description className="mt-0.5 text-[12.5px] leading-relaxed text-fg-muted">{description}</D.Description>
                    ) : (
                      <D.Description className="sr-only">{typeof title === 'string' ? title : 'Dialog'}</D.Description>
                    )}
                  </div>
                  {!hideClose && (
                    <D.Close
                      className="-mr-1.5 -mt-0.5 rounded-md p-1.5 text-fg-subtle transition-colors hover:bg-hover hover:text-fg"
                      aria-label="Close"
                    >
                      <X className="size-4" />
                    </D.Close>
                  )}
                </div>
              )}
              <div className={cn('min-h-0 flex-1 overflow-y-auto px-5 py-3', bodyClassName)}>{children}</div>
              {footer && (
                <div className="flex items-center justify-end gap-2 border-t border-border bg-surface-2/50 px-5 py-3">{footer}</div>
              )}
            </>
          )}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

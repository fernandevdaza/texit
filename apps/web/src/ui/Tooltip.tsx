import { Tooltip as T } from 'radix-ui';
import type { ReactNode } from 'react';
import { Kbd } from './Kbd';

export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <T.Provider delayDuration={450} skipDelayDuration={250}>
      {children}
    </T.Provider>
  );
}

export function Tooltip({
  content,
  shortcut,
  side = 'bottom',
  children,
  disabled,
}: {
  content: ReactNode;
  shortcut?: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
  children: ReactNode;
  disabled?: boolean;
}) {
  if (disabled || (!content && !shortcut)) return <>{children}</>;
  return (
    <T.Root>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content
          side={side}
          sideOffset={6}
          collisionPadding={8}
          className="z-[100] flex max-w-xs animate-fade-in items-center gap-2 rounded-md bg-[#18181b] px-2 py-1 text-[11.5px] font-medium text-white shadow-lg dark:bg-[#2a2a33]"
        >
          {content}
          {shortcut && <Kbd keys={shortcut} variant="tooltip" />}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}

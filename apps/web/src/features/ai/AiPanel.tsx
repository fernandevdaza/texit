/**
 * Right-dock AI chat panel. The implementation (Markdown, KaTeX, diff, @texit/ai) is
 * code-split and loaded the first time the panel opens.
 */
import { lazy, Suspense, useEffect } from 'react';
import { Spinner } from '@/ui';
import { focusComposer } from './chat/store';

const ChatPanel = lazy(() => import('./panel/ChatPanel'));

export function AiPanel() {
  useEffect(() => {
    // Opening the panel (Mod-l / toolbar) puts the cursor in the composer.
    focusComposer();
  }, []);
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center gap-2 text-[12px] text-fg-subtle">
          <Spinner /> Loading assistant…
        </div>
      }
    >
      <ChatPanel />
    </Suspense>
  );
}

/**
 * AI section of the global Settings dialog (providers, keys, models, CLI agents, MCP).
 * Code-split: loads together with @texit/ai when the section is opened.
 */
import { lazy, Suspense } from 'react';
import { Spinner } from '@/ui';

const AiSettingsView = lazy(() => import('./settings/AiSettingsView'));

export function AiSettings() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center gap-2 py-10 text-[12px] text-fg-subtle">
          <Spinner /> Loading AI settings…
        </div>
      }
    >
      <AiSettingsView />
    </Suspense>
  );
}

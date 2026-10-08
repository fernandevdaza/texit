/**
 * AI section of the global Settings dialog (providers, keys, models, CLI agents, MCP).
 * Code-split: loads together with @texit/ai when the section is opened.
 */
import './i18n';
import { lazy, Suspense } from 'react';
import { useT } from '@/lib/i18n';
import { Spinner } from '@/ui';

const AiSettingsView = lazy(() => import('./settings/AiSettingsView'));

export function AiSettings() {
  const t = useT();
  return (
    <Suspense
      fallback={
        <div className="flex items-center gap-2 py-10 text-[12px] text-fg-subtle">
          <Spinner /> {t('ai.loadingSettings')}
        </div>
      }
    >
      <AiSettingsView />
    </Suspense>
  );
}

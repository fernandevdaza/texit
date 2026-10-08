import { useSettings, type PdfSettings } from '@/state/settings';
import { cn } from '@/lib/cn';
import { useT } from '@/lib/i18n';
import { Segmented } from '@/ui';
import { Card, Row, Tile, ToggleRow } from '../parts';

const styles: { value: PdfSettings['darkMode']; page: string; ink: string; accent: string }[] = [
  { value: 'off', page: '#ffffff', ink: '#2b2b33', accent: '#4f46e5' },
  { value: 'dim', page: '#c9c9cf', ink: '#1f1f25', accent: '#4338ca' },
  { value: 'invert', page: '#1b1b21', ink: '#d9d9e0', accent: '#a5b4fc' },
];

function Page({ page, ink, accent }: { page: string; ink: string; accent: string }) {
  return (
    <div className="flex h-full items-center justify-center bg-pdf-bg p-3">
      <div className="flex aspect-[1/1.25] h-full flex-col gap-1 rounded-[2px] p-2 shadow-md" style={{ background: page }}>
        <div className="mx-auto mb-1 h-1.5 w-2/3 rounded-full" style={{ background: ink }} />
        <div className="mx-auto mb-1.5 h-1 w-1/3 rounded-full opacity-60" style={{ background: ink }} />
        <div className="h-1 w-1/2 rounded-full" style={{ background: accent }} />
        {[1, 0.92, 0.97, 0.8].map((w, i) => (
          <div key={i} className="h-[3px] rounded-full opacity-50" style={{ background: ink, width: `${w * 100}%` }} />
        ))}
        <div className="mx-auto my-1 h-1 w-2/5 rounded-full opacity-70" style={{ background: ink }} />
        {[0.95, 0.88].map((w, i) => (
          <div key={i} className="h-[3px] rounded-full opacity-50" style={{ background: ink, width: `${w * 100}%` }} />
        ))}
      </div>
    </div>
  );
}

export function PdfSection() {
  const p = useSettings((s) => s.pdf);
  const setPdf = useSettings((s) => s.setPdf);
  const t = useT();
  return (
    <>
      <Card title={t('settings.pdf.darkMode')} description={t('settings.pdf.darkModeHint')}>
        <div role="radiogroup" aria-label={t('settings.pdf.darkModeAria')} className="grid grid-cols-3 gap-3 p-4">
          {styles.map((s) => (
            <Tile key={s.value} selected={p.darkMode === s.value} onSelect={() => setPdf({ darkMode: s.value })} label={t(`settings.pdf.${s.value}`)} description={t(`settings.pdf.${s.value}Hint`)}>
              <div className={cn('aspect-[16/10] w-full overflow-hidden border-b border-border')}>
                <Page page={s.page} ink={s.ink} accent={s.accent} />
              </div>
            </Tile>
          ))}
        </div>
      </Card>

      <Card title={t('settings.pdf.viewer')}>
        <Row title={t('settings.pdf.defaultZoom')}>
          <Segmented
            size="sm"
            value={p.defaultZoom}
            onChange={(v) => setPdf({ defaultZoom: v })}
            options={[
              { value: 'page-width', label: t('settings.pdf.fitWidth') },
              { value: 'page-fit', label: t('settings.pdf.wholePage') },
              { value: 'auto', label: t('common.auto') },
            ]}
          />
        </Row>
        <ToggleRow title={t('settings.pdf.followCursor')} description={t('settings.pdf.followCursorHint')} checked={p.followCursor} onChange={(v) => setPdf({ followCursor: v })} />
        <ToggleRow title={t('settings.pdf.doubleClick')} description={t('settings.pdf.doubleClickHint')} checked={p.doubleClickToSource} onChange={(v) => setPdf({ doubleClickToSource: v })} />
      </Card>
    </>
  );
}

import { useSettings, type PdfSettings } from '@/state/settings';
import { cn } from '@/lib/cn';
import { Segmented } from '@/ui';
import { Card, Row, Tile, ToggleRow } from '../parts';

const styles: { value: PdfSettings['darkMode']; label: string; description: string; page: string; ink: string; accent: string }[] = [
  { value: 'off', label: 'Original', description: 'Always show the real page colors.', page: '#ffffff', ink: '#2b2b33', accent: '#4f46e5' },
  { value: 'dim', label: 'Dimmed', description: 'Softer paper in dark mode, colors kept.', page: '#c9c9cf', ink: '#1f1f25', accent: '#4338ca' },
  { value: 'invert', label: 'Inverted', description: 'Dark paper, light ink. Easiest at night.', page: '#1b1b21', ink: '#d9d9e0', accent: '#a5b4fc' },
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
  return (
    <>
      <Card title="Dark mode" description="Only applies while TexIt uses the dark theme. Exported PDFs are never modified.">
        <div role="radiogroup" aria-label="PDF dark mode" className="grid grid-cols-3 gap-3 p-4">
          {styles.map((s) => (
            <Tile key={s.value} selected={p.darkMode === s.value} onSelect={() => setPdf({ darkMode: s.value })} label={s.label} description={s.description}>
              <div className={cn('aspect-[16/10] w-full overflow-hidden border-b border-border')}>
                <Page page={s.page} ink={s.ink} accent={s.accent} />
              </div>
            </Tile>
          ))}
        </div>
      </Card>

      <Card title="Viewer">
        <Row title="Default zoom">
          <Segmented
            size="sm"
            value={p.defaultZoom}
            onChange={(v) => setPdf({ defaultZoom: v })}
            options={[
              { value: 'page-width', label: 'Fit width' },
              { value: 'page-fit', label: 'Whole page' },
              { value: 'auto', label: 'Auto' },
            ]}
          />
        </Row>
        <ToggleRow title="Follow cursor" description="After each compile, scroll the PDF to where you are typing." checked={p.followCursor} onChange={(v) => setPdf({ followCursor: v })} />
        <ToggleRow title="Double-click to source" description="Double-click anywhere in the PDF to jump to that line in the editor." checked={p.doubleClickToSource} onChange={(v) => setPdf({ doubleClickToSource: v })} />
      </Card>
    </>
  );
}

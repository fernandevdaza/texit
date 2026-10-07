import { Check, Languages, Monitor, Moon, Sun } from 'lucide-react';
import { accentPresets, useResolvedTheme, useSettings, type AccentPreset, type ThemePref } from '@/state/settings';
import { cn } from '@/lib/cn';
import { Segmented, Tooltip } from '@/ui';
import { Card, Row, Tile } from '../parts';

const light = { bg: '#f4f4f6', surface: '#ffffff', line: '#e4e4ea', text: '#d4d4dc', strong: '#a1a1aa' };
const dark = { bg: '#0c0c10', surface: '#17171d', line: '#26262e', text: '#33333d', strong: '#52525b' };

function MiniUi({ c, accent }: { c: typeof light; accent: string }) {
  return (
    <div className="flex h-full w-full" style={{ background: c.bg }}>
      <div className="flex w-[22%] flex-col gap-1.5 border-r p-2" style={{ background: c.surface, borderColor: c.line }}>
        <div className="h-1.5 w-3/4 rounded-full" style={{ background: accent }} />
        <div className="h-1.5 w-full rounded-full" style={{ background: c.text }} />
        <div className="h-1.5 w-2/3 rounded-full" style={{ background: c.text }} />
        <div className="h-1.5 w-5/6 rounded-full" style={{ background: c.text }} />
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-2.5">
        <div className="h-2 w-1/2 rounded-full" style={{ background: c.strong }} />
        <div className="h-1.5 w-full rounded-full" style={{ background: c.text }} />
        <div className="h-1.5 w-11/12 rounded-full" style={{ background: c.text }} />
        <div className="h-1.5 w-4/5 rounded-full" style={{ background: c.text }} />
        <div className="mt-auto flex justify-end">
          <div className="h-3 w-8 rounded-[3px]" style={{ background: accent }} />
        </div>
      </div>
    </div>
  );
}

const themes: { value: ThemePref; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

export function AppearanceSection() {
  const theme = useSettings((s) => s.theme);
  const accent = useSettings((s) => s.accent);
  const locale = useSettings((s) => s.locale);
  const set = useSettings((s) => s.set);
  const resolved = useResolvedTheme((s) => s.theme);
  const a = accentPresets[accent] ?? accentPresets.indigo;

  return (
    <>
      <Card title="Theme">
        <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-3 p-4">
          {themes.map((t) => (
            <Tile
              key={t.value}
              selected={theme === t.value}
              onSelect={() => set({ theme: t.value })}
              label={
                <span className="flex items-center gap-1.5">
                  <t.icon className="size-3.5 text-fg-subtle" />
                  {t.label}
                </span>
              }
              description={t.value === 'system' ? `Follows your OS · ${resolved}` : undefined}
            >
              <div className="relative aspect-[16/10] w-full overflow-hidden border-b border-border">
                {t.value === 'system' ? (
                  <>
                    <div className="absolute inset-0">
                      <MiniUi c={light} accent={a.light} />
                    </div>
                    <div className="absolute inset-0 [clip-path:polygon(100%_0,100%_100%,0_100%)]">
                      <MiniUi c={dark} accent={a.dark} />
                    </div>
                  </>
                ) : (
                  <MiniUi c={t.value === 'dark' ? dark : light} accent={t.value === 'dark' ? a.dark : a.light} />
                )}
              </div>
            </Tile>
          ))}
        </div>
      </Card>

      <Card title="Accent color" description="Used for buttons, selections, links and focus rings across the app.">
        <div className="flex flex-wrap items-center gap-3 p-4">
          {(Object.keys(accentPresets) as AccentPreset[]).map((key) => {
            const p = accentPresets[key];
            const color = resolved === 'dark' ? p.dark : p.light;
            const active = key === accent;
            return (
              <Tooltip key={key} content={p.label}>
                <button
                  type="button"
                  aria-label={p.label}
                  aria-pressed={active}
                  onClick={() => set({ accent: key })}
                  className={cn(
                    'relative flex size-9 items-center justify-center rounded-full transition-transform duration-150 hover:scale-110',
                    active && 'ring-2 ring-offset-2 ring-offset-surface',
                  )}
                  style={{ background: `linear-gradient(135deg, ${color}, color-mix(in srgb, ${color} 70%, black))`, ['--tw-ring-color' as string]: color }}
                >
                  {active && <Check className="size-4" strokeWidth={3} style={{ color: key === 'graphite' && resolved === 'dark' ? '#111' : '#fff' }} />}
                </button>
              </Tooltip>
            );
          })}
          <span className="ml-1 text-[12px] font-medium text-fg-muted">{a.label}</span>
        </div>
      </Card>

      <Card title="Language" description="Translations are rolling out gradually — some screens may still appear in English.">
        <Row
          title={
            <span className="flex items-center gap-2">
              <Languages className="size-4 text-fg-subtle" /> Interface language
            </span>
          }
        >
          <Segmented
            value={locale}
            onChange={(v) => set({ locale: v })}
            options={[
              { value: 'en', label: 'English' },
              { value: 'es', label: 'Español' },
            ]}
          />
        </Row>
      </Card>
    </>
  );
}

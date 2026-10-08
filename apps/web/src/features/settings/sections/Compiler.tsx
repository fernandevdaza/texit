import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Cloud, Cpu, Globe, RefreshCw, ShieldAlert, Sparkles, Trash2, XCircle } from 'lucide-react';
import type { NativeTexInfo } from '@texit/core';
import { useSettings } from '@/state/settings';
import { getCommand, executeCommand } from '@/services/commands';
import { host, isDesktop } from '@/lib/platform';
import { cn } from '@/lib/cn';
import { formatDuration } from '@/lib/format';
import { t as tr, useT } from '@/lib/i18n';
import { Badge, Button, Input, Spinner, toast } from '@/ui';
import { Slider } from '@/ui/Slider';
import { Card, Row, Tile, ToggleRow, ValuePill } from '../parts';

const backends = [
  { value: 'auto', label: 'settings.compiler.auto', icon: Sparkles, description: isDesktop ? 'settings.compiler.autoDescDesktop' : 'settings.compiler.autoDescWeb' },
  { value: 'busytex', label: 'settings.compiler.busytex', icon: Globe, description: 'settings.compiler.busytexDesc' },
  { value: 'native', label: 'settings.compiler.native', icon: Cpu, description: 'settings.compiler.nativeDesc', desktopOnly: true },
  { value: 'remote', label: 'settings.compiler.remote', icon: Cloud, description: 'settings.compiler.remoteDesc' },
] as const;

function NativeTools() {
  const [info, setInfo] = useState<NativeTexInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = useT();
  const detect = useCallback(async () => {
    if (!host) return;
    setLoading(true);
    setError(null);
    try {
      setInfo(await host.tex.detect());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void detect();
  }, [detect]);

  if (!host) {
    return (
      <div className="flex items-center gap-2 px-4 py-3 text-[12px] text-fg-subtle">
        <Cpu className="size-4" /> {t('settings.compiler.nativeWebOnly')}
      </div>
    );
  }
  return (
    <div className="px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[12.5px] font-medium text-fg">
          {t('settings.compiler.detected')}
          {info?.distribution && <span className="ml-2 font-normal text-fg-subtle">{info.distribution}</span>}
        </div>
        <Button size="xs" variant="ghost" icon={loading ? <Spinner /> : <RefreshCw />} onClick={detect} disabled={loading}>
          {t('settings.compiler.rescan')}
        </Button>
      </div>
      {error && <p className="text-[12px] text-danger">{error}</p>}
      {info && info.tools.length === 0 && (
        <p className="text-[12px] text-fg-subtle">
          {t('settings.compiler.noTools')}
        </p>
      )}
      {info && info.tools.length > 0 && (
        <div className="grid gap-1 sm:grid-cols-2">
          {info.tools.map((t) => (
            <div key={t.id + t.path} className="flex min-w-0 items-center gap-2 rounded-lg bg-surface-2/70 px-2.5 py-1.5" title={t.path}>
              <CheckCircle2 className="size-3.5 shrink-0 text-success" />
              <span className="font-mono text-[12px] text-fg">{t.id}</span>
              <span className="truncate text-[11px] text-fg-subtle">{t.version ?? t.path}</span>
            </div>
          ))}
        </div>
      )}
      {!info && loading && (
        <div className="flex items-center gap-2 text-[12px] text-fg-subtle">
          <Spinner /> {t('settings.compiler.looking')}
        </div>
      )}
      {!info && !loading && !error && (
        <div className="flex items-center gap-2 text-[12px] text-fg-subtle">
          <XCircle className="size-3.5" /> {t('settings.compiler.notDetected')}
        </div>
      )}
    </div>
  );
}

export function CompilerSection() {
  const c = useSettings((s) => s.compile);
  const setCompile = useSettings((s) => s.setCompile);
  const t = useT();

  const clearCache = async () => {
    if (!getCommand('compile.clearCache')) {
      toast.info(tr('settings.compiler.nothingToClear'), { description: tr('settings.compiler.nothingToClearHint') });
      return;
    }
    await executeCommand('compile.clearCache');
  };

  return (
    <>
      <Card title={t('settings.compiler.backend')}>
        <div role="radiogroup" aria-label={t('settings.compiler.backend')} className="grid gap-3 p-4 sm:grid-cols-2">
          {backends.map((b) => {
            const disabled = 'desktopOnly' in b && b.desktopOnly && !isDesktop;
            return (
              <Tile
                key={b.value}
                selected={c.backend === b.value}
                onSelect={() => setCompile({ backend: b.value })}
                disabled={disabled}
                label={
                  <span className="flex items-center gap-2">
                    <span className={cn('flex size-6 items-center justify-center rounded-md', c.backend === b.value ? 'bg-accent text-accent-fg' : 'bg-surface-2 text-fg-muted ring-1 ring-border')}>
                      <b.icon className="size-3.5" />
                    </span>
                    {t(b.label)}
                    {disabled && <Badge>{t('settings.desktopBadge')}</Badge>}
                  </span>
                }
                description={t(b.description)}
              />
            );
          })}
        </div>
        {(c.backend === 'native' || c.backend === 'auto') && <NativeTools />}
        {c.backend === 'remote' && (
          <div className="grid gap-3 px-4 py-3.5 sm:grid-cols-2">
            <label className="space-y-1.5">
              <span className="block text-[12px] font-medium text-fg">{t('settings.compiler.serverUrl')}</span>
              <Input value={c.remoteUrl} placeholder="https://latex.example.com" onChange={(e) => setCompile({ remoteUrl: e.target.value })} />
            </label>
            <label className="space-y-1.5">
              <span className="block text-[12px] font-medium text-fg">{t('settings.compiler.accessToken')}</span>
              <Input type="password" value={c.remoteToken} placeholder={t('settings.compiler.optional')} autoComplete="off" onChange={(e) => setCompile({ remoteToken: e.target.value })} />
            </label>
            <p className="text-[11.5px] leading-relaxed text-fg-subtle sm:col-span-2">{t('settings.compiler.remoteWarning')}</p>
          </div>
        )}
      </Card>

      <Card title={t('settings.compiler.whileTyping')}>
        <ToggleRow title={t('settings.compiler.autoCompile')} description={t('settings.compiler.autoCompileHint')} checked={c.auto} onChange={(v) => setCompile({ auto: v })} />
        <Row title={t('settings.compiler.delay')} description={t('settings.compiler.delayHint')} className={cn(!c.auto && 'pointer-events-none opacity-50')}>
          <Slider aria-label={t('settings.compiler.delayAria')} min={300} max={5000} step={100} value={c.autoDelayMs} onValueChange={(v) => setCompile({ autoDelayMs: v })} disabled={!c.auto} />
          <ValuePill>{formatDuration(c.autoDelayMs)}</ValuePill>
        </Row>
        <ToggleRow title={t('settings.compiler.draft')} description={t('settings.compiler.draftHint')} checked={c.draftWhileTyping} onChange={(v) => setCompile({ draftWhileTyping: v })} />
        <ToggleRow title="SyncTeX" description={t('settings.compiler.synctexHint')} checked={c.synctex} onChange={(v) => setCompile({ synctex: v })} />
      </Card>

      <Card title={t('settings.compiler.advanced')}>
        <ToggleRow
          title={t('settings.compiler.shellEscape')}
          badge={
            <Badge tone="warning">
              <ShieldAlert /> {t('settings.compiler.security')}
            </Badge>
          }
          description={t('settings.compiler.shellEscapeHint')}
          checked={c.shellEscape}
          onChange={(v) => setCompile({ shellEscape: v })}
        />
        <Row title={t('settings.compiler.packageServer')} description={t('settings.compiler.packageServerHint')} stack>
          <Input value={c.texliveEndpoint} placeholder={t('settings.compiler.default')} onChange={(e) => setCompile({ texliveEndpoint: e.target.value })} className="font-mono text-[12px]" />
        </Row>
        <Row title={t('settings.compiler.cache')} description={t('settings.compiler.cacheHint')}>
          <Button size="sm" variant="secondary" icon={<Trash2 />} onClick={clearCache}>
            {t('settings.compiler.clearCache')}
          </Button>
        </Row>
      </Card>
    </>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Cloud, Cpu, Globe, RefreshCw, ShieldAlert, Sparkles, Trash2, XCircle } from 'lucide-react';
import type { NativeTexInfo } from '@texit/core';
import { useSettings } from '@/state/settings';
import { getCommand, executeCommand } from '@/services/commands';
import { host, isDesktop } from '@/lib/platform';
import { cn } from '@/lib/cn';
import { formatDuration } from '@/lib/format';
import { Badge, Button, Input, Spinner, toast } from '@/ui';
import { Slider } from '@/ui/Slider';
import { Card, Row, Tile, ToggleRow, ValuePill } from '../parts';

const backends = [
  { value: 'auto', label: 'Automatic', icon: Sparkles, description: isDesktop ? 'Native TeX when installed, otherwise in-browser.' : 'In-browser today; native TeX in the desktop app.' },
  { value: 'busytex', label: 'In-browser (WASM)', icon: Globe, description: 'TeX Live compiled to WebAssembly (BusyTeX). Private, works offline once cached.' },
  { value: 'native', label: 'Native TeX', icon: Cpu, description: 'Your TeX Live, MacTeX or MiKTeX install. Fastest builds.', desktopOnly: true },
  { value: 'remote', label: 'Remote server', icon: Cloud, description: 'Compile on a self-hosted TexIt compile server.' },
] as const;

function NativeTools() {
  const [info, setInfo] = useState<NativeTexInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
        <Cpu className="size-4" /> Native compilation is available in the TexIt desktop app for macOS, Windows and Linux.
      </div>
    );
  }
  return (
    <div className="px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[12.5px] font-medium text-fg">
          Detected TeX installation
          {info?.distribution && <span className="ml-2 font-normal text-fg-subtle">{info.distribution}</span>}
        </div>
        <Button size="xs" variant="ghost" icon={loading ? <Spinner /> : <RefreshCw />} onClick={detect} disabled={loading}>
          Re-scan
        </Button>
      </div>
      {error && <p className="text-[12px] text-danger">{error}</p>}
      {info && info.tools.length === 0 && (
        <p className="text-[12px] text-fg-subtle">
          No TeX tools found on your PATH. Install TeX Live, MacTeX, MiKTeX or Tectonic — TexIt will keep using the in-browser engine meanwhile.
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
          <Spinner /> Looking for latexmk, pdflatex, xelatex, lualatex, biber, tectonic…
        </div>
      )}
      {!info && !loading && !error && (
        <div className="flex items-center gap-2 text-[12px] text-fg-subtle">
          <XCircle className="size-3.5" /> Not detected yet.
        </div>
      )}
    </div>
  );
}

export function CompilerSection() {
  const c = useSettings((s) => s.compile);
  const setCompile = useSettings((s) => s.setCompile);

  const clearCache = async () => {
    if (!getCommand('compile.clearCache')) {
      toast.info('Nothing to clear yet', { description: 'The TeX Live package cache is created on your first in-browser compile.' });
      return;
    }
    await executeCommand('compile.clearCache');
  };

  return (
    <>
      <Card title="Compiler backend">
        <div role="radiogroup" aria-label="Compiler backend" className="grid gap-3 p-4 sm:grid-cols-2">
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
                    {b.label}
                    {disabled && <Badge>Desktop</Badge>}
                  </span>
                }
                description={b.description}
              />
            );
          })}
        </div>
        {(c.backend === 'native' || c.backend === 'auto') && <NativeTools />}
        {c.backend === 'remote' && (
          <div className="grid gap-3 px-4 py-3.5 sm:grid-cols-2">
            <label className="space-y-1.5">
              <span className="block text-[12px] font-medium text-fg">Server URL</span>
              <Input value={c.remoteUrl} placeholder="https://latex.example.com" onChange={(e) => setCompile({ remoteUrl: e.target.value })} />
            </label>
            <label className="space-y-1.5">
              <span className="block text-[12px] font-medium text-fg">Access token</span>
              <Input type="password" value={c.remoteToken} placeholder="Optional" autoComplete="off" onChange={(e) => setCompile({ remoteToken: e.target.value })} />
            </label>
            <p className="text-[11.5px] leading-relaxed text-fg-subtle sm:col-span-2">Your project files are sent to this server on every compile. Only use servers you trust.</p>
          </div>
        )}
      </Card>

      <Card title="While you type">
        <ToggleRow title="Auto-compile" description="Rebuild the PDF automatically after you pause typing." checked={c.auto} onChange={(v) => setCompile({ auto: v })} />
        <Row title="Delay" description="How long to wait after the last keystroke." className={cn(!c.auto && 'pointer-events-none opacity-50')}>
          <Slider aria-label="Auto-compile delay" min={300} max={5000} step={100} value={c.autoDelayMs} onValueChange={(v) => setCompile({ autoDelayMs: v })} disabled={!c.auto} />
          <ValuePill>{formatDuration(c.autoDelayMs)}</ValuePill>
        </Row>
        <ToggleRow title="Draft while typing" description="Single fast pass for previews; full build (bibliography, references) when you compile explicitly." checked={c.draftWhileTyping} onChange={(v) => setCompile({ draftWhileTyping: v })} />
        <ToggleRow title="SyncTeX" description="Jump between source and PDF (click ↔ cursor)." checked={c.synctex} onChange={(v) => setCompile({ synctex: v })} />
      </Card>

      <Card title="Advanced">
        <ToggleRow
          title="Shell escape"
          badge={
            <Badge tone="warning">
              <ShieldAlert /> Security
            </Badge>
          }
          description="Allow \write18 (minted, gnuplot, svg…). Only enable for projects you trust."
          checked={c.shellEscape}
          onChange={(v) => setCompile({ shellEscape: v })}
        />
        <Row title="TeX Live package server" description="On-demand package endpoint for the in-browser engine. Leave empty for the default." stack>
          <Input value={c.texliveEndpoint} placeholder="Default" onChange={(e) => setCompile({ texliveEndpoint: e.target.value })} className="font-mono text-[12px]" />
        </Row>
        <Row title="TeX Live cache" description="Packages downloaded by the in-browser engine are cached on this device.">
          <Button size="sm" variant="secondary" icon={<Trash2 />} onClick={clearCache}>
            Clear cache
          </Button>
        </Row>
      </Card>
    </>
  );
}

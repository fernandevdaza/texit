import { useState, type ReactNode } from 'react';
import { ArrowUpRight, BadgeCheck, Bug, Download, Heart, RefreshCw, Scale } from 'lucide-react';
import { host } from '@/lib/platform';
import { t as tr, useT } from '@/lib/i18n';
import { Badge, Button, Logo, Spinner, toast } from '@/ui';
import pkg from '../../../../package.json';

function GithubMark() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

export const REPO_URL = 'https://github.com/fernandevdaza/texit';

/** `what` is an i18n key. */
const credits: { name: string; what: string; url: string }[] = [
  { name: 'TeX Live', what: 'settings.about.credit.texlive', url: 'https://tug.org/texlive/' },
  { name: 'BusyTeX', what: 'settings.about.credit.busytex', url: 'https://github.com/busytex/busytex' },
  { name: 'pdf.js', what: 'settings.about.credit.pdfjs', url: 'https://mozilla.github.io/pdf.js/' },
  { name: 'CodeMirror', what: 'settings.about.credit.codemirror', url: 'https://codemirror.net/' },
  { name: 'Yjs', what: 'settings.about.credit.yjs', url: 'https://yjs.dev/' },
  { name: 'KaTeX', what: 'settings.about.credit.katex', url: 'https://katex.org/' },
  { name: 'Trystero', what: 'settings.about.credit.trystero', url: 'https://github.com/dmotz/trystero' },
  { name: 'Radix UI', what: 'settings.about.credit.radix', url: 'https://www.radix-ui.com/' },
];

function ExternalLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className={className}
      onClick={(e) => {
        if (host) {
          e.preventDefault();
          void host.shell.openExternal(href);
        }
      }}
    >
      {children}
    </a>
  );
}

export function AboutSection() {
  const version = host?.appVersion ?? (pkg as { version: string }).version;
  const [checking, setChecking] = useState(false);
  const t = useT();

  const check = async () => {
    if (!host) return;
    setChecking(true);
    try {
      const r = await host.app.checkForUpdates();
      if (r.available) toast.success(tr('settings.about.updateAvailable', { version: r.version ?? '' }), { description: tr('settings.about.updateAvailableHint') });
      else toast.success(tr('settings.about.upToDate'), { description: tr('settings.about.upToDateHint', { version }) });
    } catch (err) {
      toast.error(tr('settings.about.updateError'), { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setChecking(false);
    }
  };

  return (
    <>
      <div className="relative mb-7 overflow-hidden rounded-2xl border border-border bg-surface p-6">
        <div className="pointer-events-none absolute -right-16 -top-24 size-72 rounded-full bg-[radial-gradient(closest-side,color-mix(in_srgb,var(--tx-accent)_35%,transparent),transparent)] blur-2xl" />
        <div className="pointer-events-none absolute -bottom-28 right-24 size-64 rounded-full bg-[radial-gradient(closest-side,rgb(236_72_153/0.22),transparent)] blur-2xl" />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center">
          <Logo size={64} className="drop-shadow-[0_10px_24px_rgb(91_91_240/0.35)]" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-[22px] font-semibold tracking-tight text-fg">TexIt</h3>
              <Badge tone="accent">v{version}</Badge>
              <Badge>{host ? t('settings.about.desktopPlatform', { platform: host.platform }) : t('settings.platformWeb')}</Badge>
            </div>
            <p className="mt-1 max-w-md text-[13px] leading-relaxed text-fg-muted">
              {t('settings.about.tagline')}
            </p>
          </div>
        </div>
        <div className="relative mt-5 flex flex-wrap gap-2">
          <ExternalLink href={REPO_URL}>
            <Button size="sm" variant="secondary" icon={<GithubMark />} iconRight={<ArrowUpRight className="opacity-50" />}>
              {t('settings.about.source')}
            </Button>
          </ExternalLink>
          <ExternalLink href={`${REPO_URL}/issues/new`}>
            <Button size="sm" variant="ghost" icon={<Bug />}>
              {t('settings.about.report')}
            </Button>
          </ExternalLink>
          {host ? (
            <Button size="sm" variant="primary" icon={checking ? <Spinner /> : <RefreshCw />} onClick={check} disabled={checking}>
              {t('settings.about.checkUpdates')}
            </Button>
          ) : (
            <ExternalLink href={`${REPO_URL}/releases`}>
              <Button size="sm" variant="ghost" icon={<Download />}>
                {t('settings.about.getDesktop')}
              </Button>
            </ExternalLink>
          )}
        </div>
      </div>

      <section className="mb-7">
        <h3 className="mb-2 px-0.5 text-[12px] font-semibold text-fg-muted">{t('settings.about.license')}</h3>
        <div className="flex items-start gap-3 rounded-xl border border-border bg-surface p-4">
          <Scale className="mt-0.5 size-4 shrink-0 text-fg-subtle" />
          <p className="text-[12.5px] leading-relaxed text-fg-muted">
            {t('settings.about.licenseBefore')}
            <span className="font-medium text-fg">GNU Affero General Public License v3.0</span>
            {t('settings.about.licenseAfter')}
          </p>
        </div>
      </section>

      <section>
        <h3 className="mb-2 flex items-center gap-1.5 px-0.5 text-[12px] font-semibold text-fg-muted">
          {t('settings.about.giants')} <Heart className="size-3 fill-current text-danger" />
        </h3>
        <div className="grid gap-2 sm:grid-cols-2">
          {credits.map((c) => (
            <ExternalLink
              key={c.name}
              href={c.url}
              className="group flex items-center gap-3 rounded-xl border border-border bg-surface px-3.5 py-2.5 transition-colors hover:border-border-strong hover:bg-hover"
            >
              <BadgeCheck className="size-4 shrink-0 text-accent" />
              <span className="min-w-0 flex-1">
                <span className="block text-[12.5px] font-medium text-fg">{c.name}</span>
                <span className="block truncate text-[11.5px] text-fg-subtle">{t(c.what)}</span>
              </span>
              <ArrowUpRight className="size-3.5 text-fg-subtle opacity-0 transition-opacity group-hover:opacity-100" />
            </ExternalLink>
          ))}
        </div>
      </section>
    </>
  );
}

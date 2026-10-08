/** App-side UI services for plugins (toasts, dialogs, quick pick, DOM modals, permission prompt). */
import { useEffect, useRef } from 'react';
import { ShieldCheck, TriangleAlert } from 'lucide-react';
import type { PluginManifest } from '@texit/plugin-api';
import { Badge, Button, confirmDialog, openModal, promptDialog, toast } from '@/ui';
import { quickPick } from '@/ui/QuickPick';
import { PanelIcon } from '@/features/workspace/PanelIcon';
import { useLayout } from '@/state/workspace';
import type { HostUi } from './host';
import { PERMISSION_INFO } from './permissions';
import { pluginName, useLocalizedManifest } from './localize';
import { t, useT } from '@/lib/i18n';
import './i18n';

/** Tailwind needs static class names: map a pixel width to the closest max-w class. */
const WIDTHS: [number, string][] = [
  [448, 'max-w-md'],
  [512, 'max-w-lg'],
  [576, 'max-w-xl'],
  [672, 'max-w-2xl'],
  [768, 'max-w-3xl'],
  [896, 'max-w-4xl'],
  [1024, 'max-w-5xl'],
  [1152, 'max-w-6xl'],
];
export function widthClass(px?: number): string {
  if (!px) return 'max-w-2xl';
  for (const [w, cls] of WIDTHS) if (px <= w) return cls;
  return 'max-w-6xl';
}

function DomHost({
  render,
  close,
  onError,
}: {
  render: (el: HTMLElement, close: () => void) => void | (() => void);
  close: () => void;
  onError: (err: unknown) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let cleanup: void | (() => void);
    try {
      cleanup = render(el, close);
    } catch (err) {
      onError(err);
      el.textContent = t('plugins.dialogFailed', { error: err instanceof Error ? err.message : String(err) });
    }
    return () => {
      try {
        cleanup?.();
      } catch (err) {
        onError(err);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <div ref={ref} className="min-h-0" />;
}

export const appUi: HostUi = {
  toast(message, opts) {
    const fn = opts?.type && opts.type !== 'info' ? toast[opts.type] : toast.info;
    fn(message, { description: opts?.description });
  },
  quickPick(items, opts) {
    return quickPick(
      items.map((i) => ({ label: i.label, description: i.description, value: i.value })),
      { placeholder: opts?.placeholder, title: opts?.title },
    );
  },
  prompt(opts) {
    return promptDialog({ title: opts.title, placeholder: opts.placeholder, value: opts.value });
  },
  confirm(opts) {
    return confirmDialog({ title: opts.title, message: opts.message, danger: opts.danger, confirmLabel: opts.danger ? t('plugins.continue') : t('common.ok') });
  },
  modal(opts) {
    return openModal({
      title: opts.title,
      width: widthClass(opts.width),
      render: (close) => <DomHost render={opts.render} close={close} onError={opts.onError} />,
    });
  },
};

// ───────────────────────────── error toasts ─────────────────────────────

const lastToast = new Map<string, number>();

export function notifyPluginError(name: string, context: string, message: string, id: string) {
  const now = Date.now();
  if (now - (lastToast.get(id) ?? 0) < 6000) return;
  lastToast.set(id, now);
  toast.error(t('plugins.hitError', { name }), {
    description: `${context}: ${message}`,
    action: { label: t('plugins.details'), onClick: () => useLayout.getState().showSidebarPanel('plugins') },
  });
}

// ───────────────────────────── permission prompt ─────────────────────────────

export function PluginIconTile({ icon, size = 'md' }: { icon?: string; size?: 'sm' | 'md' | 'lg' }) {
  const cls = size === 'lg' ? 'size-11 rounded-xl [&_svg]:size-5' : size === 'sm' ? 'size-7 rounded-md [&_svg]:size-3.5' : 'size-9 rounded-lg [&_svg]:size-[18px]';
  return (
    <div className={`flex shrink-0 items-center justify-center bg-gradient-to-br from-accent-soft to-surface-2 text-accent ring-1 ring-inset ring-border ${cls}`}>
      <PanelIcon icon={icon} className={size === 'lg' ? 'size-5' : size === 'sm' ? 'size-3.5' : 'size-[18px]'} />
    </div>
  );
}

export function PermissionList({ permissions, highlight }: { permissions: PluginManifest['permissions']; highlight?: string[] }) {
  const t = useT();
  if (!permissions?.length)
    return <p className="rounded-lg bg-surface-2 px-3 py-2.5 text-[12.5px] text-fg-muted">{t('plugins.noPermissions')}</p>;
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
      {permissions.map((p) => {
        const info = PERMISSION_INFO[p];
        return (
          <li key={p} className="flex items-start gap-3 bg-surface px-3 py-2.5">
            <span className="mt-0.5 text-fg-muted">
              <PanelIcon icon={info?.icon ?? 'shield'} className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-[12.5px] font-medium text-fg">
                {info ? t(`plugins.perm.${p}.title`, undefined, info.title) : p}
                <code className="text-[10.5px] font-normal text-fg-subtle">{p}</code>
                {highlight?.includes(p) && <Badge tone="warning">{t('plugins.newBadge')}</Badge>}
              </div>
              <div className="text-[12px] leading-relaxed text-fg-subtle">{info ? t(`plugins.perm.${p}.description`, undefined, info.description) : null}</div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function requestPermissionApproval(manifest: PluginManifest, opts: { source?: string; newPermissions?: string[] } = {}): Promise<boolean> {
  let approved = false;
  const isUpdate = !!opts.newPermissions;
  return openModal({
    title: isUpdate ? t('plugins.requestsNewPermissions', { name: pluginName(manifest) }) : t('plugins.installConfirm', { name: pluginName(manifest) }),
    width: 'max-w-lg',
    render: (close) => <PermissionPrompt manifest={manifest} source={opts.source} newPermissions={opts.newPermissions} close={close} onApprove={() => (approved = true)} />,
  }).then(() => approved);
}

function PermissionPrompt({
  manifest: raw,
  source,
  newPermissions,
  close,
  onApprove,
}: {
  manifest: PluginManifest;
  source?: string;
  newPermissions?: string[];
  close: () => void;
  onApprove: () => void;
}) {
  const t = useT();
  const manifest = useLocalizedManifest(raw);
  const isUpdate = !!newPermissions;
  const opts = { source, newPermissions };
  return (
      <div className="space-y-4 pb-1">
        <div className="flex items-center gap-3">
          <PluginIconTile icon={manifest.icon} size="lg" />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate text-[14px] font-semibold text-fg">{manifest.name}</span>
              <Badge>v{manifest.version}</Badge>
            </div>
            <div className="truncate text-[12px] text-fg-subtle">
              {manifest.author ? `${t('plugins.byAuthor', { author: manifest.author })} · ` : ''}
              <span className="font-mono">{manifest.id}</span>
            </div>
          </div>
        </div>
        {manifest.description && <p className="text-[12.5px] leading-relaxed text-fg-muted">{manifest.description}</p>}
        {opts.source && (
          <div className="truncate rounded-md bg-surface-2 px-2.5 py-1.5 font-mono text-[11px] text-fg-subtle" title={opts.source}>
            {opts.source}
          </div>
        )}
        <div>
          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">
            <ShieldCheck className="size-3.5" /> {t('plugins.willBeAbleTo')}
          </div>
          <PermissionList permissions={manifest.permissions} highlight={opts.newPermissions} />
        </div>
        <div className="flex gap-2 rounded-lg bg-warning-soft px-3 py-2.5 text-[12px] leading-relaxed text-warning">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          <span>{t('plugins.trustWarning')}</span>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={close}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            data-autofocus
            onClick={() => {
              onApprove();
              close();
            }}
          >
            {isUpdate ? t('plugins.allow') : t('plugins.install')}
          </Button>
        </div>
      </div>
  );
}

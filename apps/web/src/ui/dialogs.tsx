/**
 * Imperative dialogs: `await confirmDialog({...})`, `await promptDialog({...})`,
 * `await openModal(...)`. Mount <DialogHost/> once at the app root.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { create } from 'zustand';
import { AlertTriangle } from 'lucide-react';
import { Dialog } from './Dialog';
import { Button } from './Button';
import { Input } from './Fields';
import { useT } from '@/lib/i18n';

type Pending =
  | {
      kind: 'confirm';
      id: number;
      title: ReactNode;
      message?: ReactNode;
      confirmLabel?: string;
      cancelLabel?: string;
      danger?: boolean;
      resolve: (v: boolean) => void;
    }
  | {
      kind: 'prompt';
      id: number;
      title: ReactNode;
      message?: ReactNode;
      placeholder?: string;
      value?: string;
      confirmLabel?: string;
      /** Select the file stem (before the extension) when opening, like Finder rename. */
      selectStem?: boolean;
      validate?: (v: string) => string | null;
      resolve: (v: string | undefined) => void;
    }
  | {
      kind: 'custom';
      id: number;
      title: ReactNode;
      width?: string;
      render: (close: () => void) => ReactNode;
      resolve: () => void;
    };

const useDialogs = create<{ stack: Pending[] }>(() => ({ stack: [] }));
let nextId = 1;

function push(p: Pending) {
  useDialogs.setState((s) => ({ stack: [...s.stack, p] }));
}
function pop(id: number) {
  useDialogs.setState((s) => ({ stack: s.stack.filter((p) => p.id !== id) }));
}

export function confirmDialog(opts: { title: ReactNode; message?: ReactNode; confirmLabel?: string; cancelLabel?: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => push({ kind: 'confirm', id: nextId++, ...opts, resolve }));
}

export function promptDialog(opts: {
  title: ReactNode;
  message?: ReactNode;
  placeholder?: string;
  value?: string;
  confirmLabel?: string;
  selectStem?: boolean;
  validate?: (v: string) => string | null;
}): Promise<string | undefined> {
  return new Promise((resolve) => push({ kind: 'prompt', id: nextId++, ...opts, resolve }));
}

export function openModal(opts: { title: ReactNode; width?: string; render: (close: () => void) => ReactNode }): Promise<void> {
  return new Promise((resolve) => push({ kind: 'custom', id: nextId++, ...opts, resolve }));
}

function PromptBody({ p, onDone }: { p: Extract<Pending, { kind: 'prompt' }>; onDone: (v: string | undefined) => void }) {
  const [value, setValue] = useState(p.value ?? '');
  const ref = useRef<HTMLInputElement>(null);
  const t = useT();
  const error = p.validate ? p.validate(value) : null;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.focus();
      const dot = p.selectStem ? value.lastIndexOf('.') : -1;
      el.setSelectionRange(0, dot > 0 ? dot : value.length);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!error && value.trim()) onDone(value.trim());
      }}
    >
      {p.message && <p className="mb-3 text-[12.5px] text-fg-muted">{p.message}</p>}
      <Input ref={ref} value={value} placeholder={p.placeholder} onChange={(e) => setValue(e.target.value)} />
      <div className="mt-1.5 h-4 text-[11.5px] text-danger">{value && error}</div>
      <div className="mt-2 flex justify-end gap-2">
        <Button variant="ghost" onClick={() => onDone(undefined)}>
          {t('common.cancel')}
        </Button>
        <Button variant="primary" type="submit" disabled={!!error || !value.trim()}>
          {p.confirmLabel ?? t('common.ok')}
        </Button>
      </div>
    </form>
  );
}

export function DialogHost() {
  const stack = useDialogs((s) => s.stack);
  const t = useT();
  return (
    <>
      {stack.map((p) => {
        if (p.kind === 'confirm') {
          const done = (v: boolean) => {
            pop(p.id);
            p.resolve(v);
          };
          return (
            <Dialog
              key={p.id}
              open
              onOpenChange={(o) => !o && done(false)}
              title={p.title}
              icon={p.danger ? <AlertTriangle /> : undefined}
              width="max-w-md"
              footer={
                <>
                  <Button variant="ghost" onClick={() => done(false)}>
                    {p.cancelLabel ?? t('common.cancel')}
                  </Button>
                  <Button data-autofocus variant={p.danger ? 'danger' : 'primary'} onClick={() => done(true)}>
                    {p.confirmLabel ?? t('common.confirm')}
                  </Button>
                </>
              }
            >
              {p.message && <div className="text-[13px] leading-relaxed text-fg-muted">{p.message}</div>}
            </Dialog>
          );
        }
        if (p.kind === 'prompt') {
          const done = (v: string | undefined) => {
            pop(p.id);
            p.resolve(v);
          };
          return (
            <Dialog key={p.id} open onOpenChange={(o) => !o && done(undefined)} title={p.title} width="max-w-md">
              <PromptBody p={p} onDone={done} />
            </Dialog>
          );
        }
        const close = () => {
          pop(p.id);
          p.resolve();
        };
        return (
          <Dialog key={p.id} open onOpenChange={(o) => !o && close()} title={p.title} width={p.width ?? 'max-w-2xl'}>
            {p.render(close)}
          </Dialog>
        );
      })}
    </>
  );
}

/**
 * Hardened `ipcMain.handle` wrapper: only our own app frames may call it, and
 * every argument list is validated with zod before reaching the handler.
 */
import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent, type WebContents } from 'electron';
import { z } from 'zod';
import { isAppUrl } from '../protocol-utils';
import { runtime } from '../paths';

export function isTrustedSender(event: IpcMainInvokeEvent | IpcMainEvent): boolean {
  const frame = event.senderFrame;
  if (!frame) return false;
  // Only the top-level frame gets the preload bridge; anything else is suspicious.
  if (frame !== event.sender.mainFrame) return false;
  return isAppUrl(frame.url, runtime.devServerUrl);
}

type Params<S extends z.ZodType> = Extract<z.output<S>, unknown[]>;

export function handle<S extends z.ZodType, R>(
  channel: string,
  args: S,
  fn: (event: IpcMainInvokeEvent, ...params: Params<S>) => Promise<R> | R,
): void {
  ipcMain.removeHandler(channel);
  ipcMain.handle(channel, async (event, ...raw) => {
    if (!isTrustedSender(event)) throw new Error(`Blocked IPC call to ${channel} from untrusted frame`);
    const parsed = args.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new Error(`Invalid arguments for ${channel}: ${issue ? `${issue.path.join('.') || 'args'}: ${issue.message}` : 'validation failed'}`);
    }
    return fn(event, ...(parsed.data as Params<S>));
  });
}

export function on<S extends z.ZodType>(channel: string, args: S, fn: (event: IpcMainEvent, ...params: Params<S>) => void): void {
  ipcMain.removeAllListeners(channel);
  ipcMain.on(channel, (event, ...raw) => {
    if (!isTrustedSender(event)) return;
    const parsed = args.safeParse(raw);
    if (!parsed.success) return;
    fn(event, ...(parsed.data as Params<S>));
  });
}

/** Send to a renderer if it is still alive. Returns false when it is gone. */
export function safeSend(wc: WebContents | null | undefined, channel: string, ...payload: unknown[]): boolean {
  if (!wc || wc.isDestroyed()) return false;
  try {
    wc.send(channel, ...payload);
    return true;
  } catch {
    return false;
  }
}

// ───────────────────────────── shared schemas ─────────────────────────────

export const zId = z.string().min(1).max(200).regex(/^[\w.:@-]+$/, 'must be an identifier');
export const zAbsPath = z
  .string()
  .min(1)
  .max(4096)
  .refine((p) => !p.includes('\0'), 'NUL byte in path')
  .refine((p) => /^(\/|[a-zA-Z]:[\\/]|\\\\)/.test(p), 'must be an absolute path');
export const zBytes = z.instanceof(Uint8Array);
export const zStringRecord = z.record(z.string(), z.string());
export const zFilters = z.array(z.object({ name: z.string().max(200), extensions: z.array(z.string().max(32)).max(64) })).max(32);

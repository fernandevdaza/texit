/**
 * Secret storage for API keys and MCP credentials.
 *
 *  - Desktop: OS keychain via `host.secrets` (never localStorage).
 *  - Web: kept in memory for the session; persisted to localStorage only after the
 *    user explicitly opts in ("Remember keys in this browser").
 *
 * Secrets never touch the project Y.Doc, so they are never synced to collaborators.
 */
import { create } from 'zustand';
import { host } from '@/lib/platform';

const WEB_STORE = 'texit:ai-secrets';
const WEB_OPT_IN = 'texit:ai-secrets-optin';
const DESKTOP_PREFIX = 'texit.ai.';

interface SecretsState {
  values: Record<string, string>;
  /** Web only: persist secrets in localStorage. */
  webPersist: boolean;
  loaded: boolean;
}

function readWeb(): { values: Record<string, string>; persist: boolean } {
  try {
    const persist = localStorage.getItem(WEB_OPT_IN) === '1';
    const values = persist ? (JSON.parse(localStorage.getItem(WEB_STORE) || '{}') as Record<string, string>) : {};
    return { values, persist };
  } catch {
    return { values: {}, persist: false };
  }
}

const initial = host ? { values: {}, persist: false } : readWeb();

export const useSecrets = create<SecretsState>(() => ({
  values: initial.values,
  webPersist: initial.persist,
  loaded: !host,
}));

function writeWeb() {
  const { values, webPersist } = useSecrets.getState();
  try {
    if (webPersist) localStorage.setItem(WEB_STORE, JSON.stringify(values));
    else localStorage.removeItem(WEB_STORE);
  } catch {
    /* storage full / disabled */
  }
}

export const secretKeys = {
  apiKey: (providerId: string) => `provider:${providerId}:apiKey`,
  mcpHeaders: (serverId: string) => `mcp:${serverId}:headers`,
  mcpEnv: (serverId: string) => `mcp:${serverId}:env`,
};

export function getSecret(key: string): string | undefined {
  return useSecrets.getState().values[key] || undefined;
}

export function getSecretJson<T>(key: string): T | undefined {
  const v = getSecret(key);
  if (!v) return undefined;
  try {
    return JSON.parse(v) as T;
  } catch {
    return undefined;
  }
}

export async function setSecret(key: string, value: string | null | undefined): Promise<void> {
  const values = { ...useSecrets.getState().values };
  if (value) values[key] = value;
  else delete values[key];
  useSecrets.setState({ values });
  if (host) {
    try {
      if (value) await host.secrets.set(DESKTOP_PREFIX + key, value);
      else await host.secrets.delete(DESKTOP_PREFIX + key);
    } catch (err) {
      console.error('[texit] failed to store secret', err);
      throw err;
    }
  } else {
    writeWeb();
  }
}

/** Desktop: load the given secrets from the OS keychain (idempotent per key). */
export async function loadSecrets(keys: string[]): Promise<void> {
  if (!host) return;
  const values = { ...useSecrets.getState().values };
  await Promise.all(
    keys
      .filter((k) => !(k in values))
      .map(async (k) => {
        try {
          const v = await host!.secrets.get(DESKTOP_PREFIX + k);
          if (v) values[k] = v;
        } catch {
          /* ignore */
        }
      }),
  );
  useSecrets.setState({ values, loaded: true });
}

/** Web: opt in/out of persisting secrets in localStorage. */
export function setWebPersist(on: boolean) {
  if (host) return;
  try {
    if (on) localStorage.setItem(WEB_OPT_IN, '1');
    else localStorage.removeItem(WEB_OPT_IN);
  } catch {
    /* ignore */
  }
  useSecrets.setState({ webPersist: on });
  writeWeb();
}

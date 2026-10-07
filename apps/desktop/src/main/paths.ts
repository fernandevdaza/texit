import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { APP_ORIGIN } from './protocol-utils';

export const paths = {
  userData: () => app.getPath('userData'),
  builds: () => path.join(app.getPath('userData'), 'builds'),
  projects: () => path.join(app.getPath('userData'), 'projects'),
  windowState: () => path.join(app.getPath('userData'), 'window-state.json'),
  secrets: () => path.join(app.getPath('userData'), 'secrets.json'),
  mcpToken: () => path.join(app.getPath('userData'), 'mcp-token'),
};

export const DEFAULT_DEV_SERVER_URL = 'http://localhost:5173';

/** Process-wide runtime state decided once at startup. */
export const runtime = {
  /** Origin of the Vite dev server when running in dev mode, otherwise null. */
  devServerUrl: null as string | null,
  /** `--smoke` self-test mode. */
  smoke: false,
  webRoot: '',
};

/**
 * Dev mode: unpackaged and either VITE_DEV_SERVER_URL is set, or no web build
 * exists (then the default Vite URL is used).
 */
export function resolveStartUrl(webRoot: string): string {
  if (!app.isPackaged) {
    const env = process.env.VITE_DEV_SERVER_URL;
    if (env) {
      runtime.devServerUrl = env;
      return env;
    }
    if (!fs.existsSync(path.join(webRoot, 'index.html'))) {
      runtime.devServerUrl = DEFAULT_DEV_SERVER_URL;
      return DEFAULT_DEV_SERVER_URL;
    }
  }
  return `${APP_ORIGIN}/`;
}

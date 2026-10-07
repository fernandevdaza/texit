import fs from 'node:fs';
import path from 'node:path';
import { getLoginPathDirs } from './env-path';

const WIN_EXTS = ['.exe', '.cmd', '.bat', '.com'];

function isExecutable(p: string): boolean {
  try {
    const st = fs.statSync(p);
    if (!st.isFile()) return false;
    if (process.platform === 'win32') return true;
    fs.accessSync(p, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Candidate file names for a command on the current platform. */
export function executableNames(cmd: string, platform: NodeJS.Platform = process.platform, pathExt?: string): string[] {
  if (platform !== 'win32') return [cmd];
  if (path.win32.extname(cmd)) return [cmd];
  const exts = (pathExt ?? process.env.PATHEXT ?? '')
    .split(';')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const all = Array.from(new Set([...WIN_EXTS, ...exts]));
  return all.map((e) => cmd + e);
}

/** Find `cmd` in the given directories (first match wins). */
export function whichIn(cmd: string, dirs: string[]): string | null {
  if (path.isAbsolute(cmd)) return isExecutable(cmd) ? cmd : null;
  const names = executableNames(cmd);
  for (const dir of dirs) {
    for (const name of names) {
      const full = path.join(dir, name);
      if (isExecutable(full)) return full;
    }
  }
  return null;
}

/** Find `cmd` using the user's login PATH plus well-known install dirs. */
export async function which(cmd: string, extraDirs: string[] = []): Promise<string | null> {
  const dirs = await getLoginPathDirs();
  return whichIn(cmd, [...extraDirs, ...dirs]);
}

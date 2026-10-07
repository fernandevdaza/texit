/**
 * Resolution of the user's real PATH.
 *
 * GUI apps on macOS (and many Linux desktop launchers) do not inherit the PATH
 * configured in the user's shell profile, so binaries installed with Homebrew,
 * MacTeX, TinyTeX, nvm, pipx… are invisible to `child_process.spawn`. We run
 * the login shell once (with a timeout), extract its PATH between markers (to
 * ignore anything printed by rc files) and merge it with well-known install
 * locations.
 *
 * The pure helpers are exported for unit tests; `getLoginPath()` is the cached
 * entry point used by the rest of the main process.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const PATH_START = '__TEXIT_PATH_START__';
export const PATH_END = '__TEXIT_PATH_END__';

type Platform = NodeJS.Platform;

export function pathDelimiter(platform: Platform = process.platform): string {
  return platform === 'win32' ? ';' : ':';
}

/** Extract the PATH printed between the markers (shell rc files may print banners). */
export function parseShellPathOutput(output: string): string | null {
  const start = output.lastIndexOf(PATH_START);
  if (start === -1) return null;
  const end = output.indexOf(PATH_END, start + PATH_START.length);
  if (end === -1) return null;
  const value = output.slice(start + PATH_START.length, end).trim();
  return value || null;
}

/** Build the `[shell, args]` used to print the login PATH. */
export function loginShellCommand(shell: string): [string, string[]] {
  const name = path.basename(shell);
  if (name === 'fish') {
    return [shell, ['-l', '-i', '-c', `printf '%s%s%s' '${PATH_START}' (string join : $PATH) '${PATH_END}'`]];
  }
  if (name === 'nu' || name === 'nushell') {
    return [shell, ['-l', '-i', '-c', `print -n ('${PATH_START}' + ($env.PATH | str join ':') + '${PATH_END}')`]];
  }
  // bash, zsh, sh, dash, ksh…
  return [shell, ['-ilc', `printf '%s%s%s' '${PATH_START}' "$PATH" '${PATH_END}'`]];
}

/** Merge PATH lists keeping the first occurrence of every entry. */
export function mergePathLists(lists: (string | string[] | undefined | null)[], platform: Platform = process.platform): string[] {
  const delim = pathDelimiter(platform);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    if (!list) continue;
    const entries = Array.isArray(list) ? list : list.split(delim);
    for (const raw of entries) {
      const entry = raw.trim().replace(/^"(.*)"$/, '$1');
      if (!entry) continue;
      const key = platform === 'win32' ? entry.toLowerCase().replace(/[\\/]+$/, '') : entry.replace(/\/+$/, '') || '/';
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(entry);
    }
  }
  return out;
}

export interface CommonDirsEnv {
  platform: Platform;
  home: string;
  env: Record<string, string | undefined>;
}

/**
 * Well-known install locations of TeX distributions and CLI agents.
 * Entries may contain `*` wildcards (expanded with `expandGlobDirs`).
 */
export function commonBinDirs({ platform, home, env }: CommonDirsEnv): string[] {
  if (platform === 'win32') {
    const local = env.LOCALAPPDATA ?? path.win32.join(home, 'AppData', 'Local');
    const roaming = env.APPDATA ?? path.win32.join(home, 'AppData', 'Roaming');
    const programFiles = env.ProgramFiles ?? 'C:\\Program Files';
    return [
      path.win32.join(local, 'Programs', 'MiKTeX', 'miktex', 'bin', 'x64'),
      path.win32.join(programFiles, 'MiKTeX', 'miktex', 'bin', 'x64'),
      'C:\\texlive\\*\\bin\\windows',
      'C:\\texlive\\*\\bin\\win64',
      'C:\\texlive\\*\\bin\\win32',
      path.win32.join(roaming, 'TinyTeX', 'bin', 'windows'),
      path.win32.join(roaming, 'TinyTeX', 'bin', 'win32'),
      path.win32.join(roaming, 'npm'),
      path.win32.join(local, 'Programs', 'tectonic'),
      path.win32.join(home, '.cargo', 'bin'),
      path.win32.join(home, '.local', 'bin'),
      path.win32.join(home, '.bun', 'bin'),
      path.win32.join(home, 'scoop', 'shims'),
      path.win32.join(local, 'Microsoft', 'WinGet', 'Links'),
    ];
  }
  const dirs = [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
    '/usr/local/texlive/*/bin/*',
    '/opt/texlive/*/bin/*',
    path.posix.join(home, '.local', 'bin'),
    path.posix.join(home, '.cargo', 'bin'),
    path.posix.join(home, '.bun', 'bin'),
    path.posix.join(home, '.volta', 'bin'),
    path.posix.join(home, '.npm-global', 'bin'),
    path.posix.join(home, '.opencode', 'bin'),
    path.posix.join(home, '.nvm', 'versions', 'node', '*', 'bin'),
    path.posix.join(home, '.local', 'share', 'fnm', 'aliases', 'default', 'bin'),
    path.posix.join(home, '.TinyTeX', 'bin', '*'),
  ];
  if (platform === 'darwin') {
    dirs.splice(0, 0, '/Library/TeX/texbin');
    dirs.push(path.posix.join(home, 'Library', 'TinyTeX', 'bin', '*'));
    dirs.push('/opt/local/bin'); // MacPorts
  } else {
    dirs.push('/snap/bin', '/var/lib/flatpak/exports/bin');
  }
  if (env.NVM_BIN) dirs.push(env.NVM_BIN);
  return dirs;
}

/** Compare version-ish directory names so that `2025` sorts before `2024`, `v24.1.0` before `v22.0.0`. */
function compareDesc(a: string, b: string): number {
  return b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' });
}

export interface GlobFs {
  readdir(dir: string): string[];
  isDirectory(p: string): boolean;
}

const realFs: GlobFs = {
  readdir: (dir) => {
    try {
      return fs.readdirSync(dir);
    } catch {
      return [];
    }
  },
  isDirectory: (p) => {
    try {
      return fs.statSync(p).isDirectory();
    } catch {
      return false;
    }
  },
};

/**
 * Expand `*` segments (newest/highest first) and keep only existing directories.
 * Only whole-segment wildcards are supported, which is all we need.
 */
export function expandGlobDirs(patterns: string[], platform: Platform = process.platform, gfs: GlobFs = realFs): string[] {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const out: string[] = [];
  for (const pattern of patterns) {
    if (!pattern.includes('*')) {
      if (gfs.isDirectory(pattern)) out.push(pattern);
      continue;
    }
    const sep = platform === 'win32' ? /[\\/]/ : /\//;
    const segments = pattern.split(sep);
    let bases = [segments[0] === '' ? p.sep : segments[0] + (platform === 'win32' && /:$/.test(segments[0]) ? p.sep : '')];
    for (let i = 1; i < segments.length; i++) {
      const seg = segments[i];
      if (!seg) continue;
      const next: string[] = [];
      for (const base of bases) {
        if (seg === '*') {
          const children = gfs.readdir(base).filter((c) => !c.startsWith('.')).sort(compareDesc);
          for (const c of children) {
            const full = p.join(base, c);
            if (gfs.isDirectory(full)) next.push(full);
          }
        } else {
          next.push(p.join(base, seg));
        }
      }
      bases = next;
      if (!bases.length) break;
    }
    for (const b of bases) if (gfs.isDirectory(b)) out.push(b);
  }
  return out;
}

// ───────────────────────────── runtime resolution ─────────────────────────────

let loginShellPath: Promise<string | null> | null = null;

function runLoginShell(timeoutMs: number): Promise<string | null> {
  if (process.platform === 'win32') return Promise.resolve(null);
  const shell = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash');
  const [cmd, args] = loginShellCommand(shell);
  return new Promise((resolve) => {
    try {
      execFile(
        cmd,
        args,
        {
          timeout: timeoutMs,
          killSignal: 'SIGKILL',
          maxBuffer: 4 * 1024 * 1024,
          encoding: 'utf8',
          env: {
            ...process.env,
            // Keep rc files quiet / non-interactive where they support it.
            DISABLE_AUTO_UPDATE: 'true',
            ZSH_TMUX_AUTOSTART: 'false',
            ZSH_TMUX_AUTOSTARTED: 'true',
            TERM: process.env.TERM || 'dumb',
          },
          windowsHide: true,
        },
        (_err, stdout) => resolve(parseShellPathOutput(String(stdout ?? ''))),
      );
    } catch {
      resolve(null);
    }
  });
}

/**
 * The merged list of PATH directories: login-shell PATH (resolved once), the
 * current process PATH and well-known install dirs (re-checked every call so
 * a freshly installed TeX distribution is picked up without restarting).
 */
export async function getLoginPathDirs(): Promise<string[]> {
  if (!loginShellPath) loginShellPath = runLoginShell(5000);
  const login = await loginShellPath;
  const extra = expandGlobDirs(commonBinDirs({ platform: process.platform, home: os.homedir(), env: process.env }));
  const current = process.env.PATH ?? process.env.Path;
  return mergePathLists([login, current, extra]);
}

/** The merged PATH string. */
export async function getLoginPath(): Promise<string> {
  return (await getLoginPathDirs()).join(pathDelimiter());
}

/** Forget the cached PATH (e.g. after the user installed a TeX distribution). */
export function resetLoginPathCache(): void {
  loginShellPath = null;
}

/** Environment for child processes: the user's PATH plus overrides. */
export async function childEnv(overrides?: Record<string, string | undefined>, prependDirs: string[] = []): Promise<NodeJS.ProcessEnv> {
  const dirs = mergePathLists([prependDirs, await getLoginPathDirs()]);
  const env: NodeJS.ProcessEnv = { ...process.env };
  // Never leak Electron-specific switches into children (they would e.g. make a child `electron`/`node` act weird).
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_NO_ATTACH_CONSOLE;
  delete env.VITE_DEV_SERVER_URL;
  const key = process.platform === 'win32' ? (Object.keys(env).find((k) => k.toLowerCase() === 'path') ?? 'Path') : 'PATH';
  env[key] = dirs.join(pathDelimiter());
  if (overrides) for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  return env;
}

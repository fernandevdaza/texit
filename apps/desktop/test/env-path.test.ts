import { describe, expect, it } from 'vitest';
import { commonBinDirs, expandGlobDirs, loginShellCommand, mergePathLists, parseShellPathOutput, PATH_END, PATH_START, type GlobFs } from '../src/main/util/env-path';
import { executableNames } from '../src/main/util/which';

describe('parseShellPathOutput', () => {
  it('extracts the PATH between markers, ignoring rc-file noise', () => {
    const out = `Welcome to zsh!\n[oh-my-zsh] update?\n${PATH_START}/opt/homebrew/bin:/usr/bin${PATH_END}\nbye`;
    expect(parseShellPathOutput(out)).toBe('/opt/homebrew/bin:/usr/bin');
  });
  it('returns null when markers are missing or empty', () => {
    expect(parseShellPathOutput('nothing here')).toBeNull();
    expect(parseShellPathOutput(`${PATH_START}${PATH_END}`)).toBeNull();
    expect(parseShellPathOutput(`${PATH_START}/usr/bin`)).toBeNull();
  });
});

describe('loginShellCommand', () => {
  it('uses -ilc for POSIX shells and a fish-specific join', () => {
    const [cmd, args] = loginShellCommand('/bin/zsh');
    expect(cmd).toBe('/bin/zsh');
    expect(args[0]).toBe('-ilc');
    expect(args[1]).toContain('"$PATH"');
    const [, fishArgs] = loginShellCommand('/opt/homebrew/bin/fish');
    expect(fishArgs.join(' ')).toContain('string join : $PATH');
  });
});

describe('mergePathLists', () => {
  it('dedupes while keeping order, ignoring trailing slashes and empty entries', () => {
    expect(mergePathLists(['/a:/b/:', ['/b', '/c'], undefined, '/a'], 'darwin')).toEqual(['/a', '/b/', '/c']);
  });
  it('is case-insensitive on Windows and splits on ;', () => {
    expect(mergePathLists(['C:\\Tex\\bin;c:\\tex\\BIN\\', 'D:\\x'], 'win32')).toEqual(['C:\\Tex\\bin', 'D:\\x']);
  });
});

describe('commonBinDirs', () => {
  it('includes TeX and agent locations on macOS', () => {
    const dirs = commonBinDirs({ platform: 'darwin', home: '/Users/me', env: {} });
    expect(dirs[0]).toBe('/Library/TeX/texbin');
    expect(dirs).toContain('/usr/local/texlive/*/bin/*');
    expect(dirs).toContain('/opt/homebrew/bin');
    expect(dirs).toContain('/Users/me/.TinyTeX/bin/*');
    expect(dirs).toContain('/Users/me/Library/TinyTeX/bin/*');
    expect(dirs).toContain('/Users/me/.local/bin');
    expect(dirs).toContain('/Users/me/.nvm/versions/node/*/bin');
  });
  it('includes MiKTeX / TeX Live locations on Windows', () => {
    const dirs = commonBinDirs({ platform: 'win32', home: 'C:\\Users\\me', env: { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local', APPDATA: 'C:\\Users\\me\\AppData\\Roaming' } });
    expect(dirs).toContain('C:\\Users\\me\\AppData\\Local\\Programs\\MiKTeX\\miktex\\bin\\x64');
    expect(dirs).toContain('C:\\texlive\\*\\bin\\windows');
    expect(dirs).toContain('C:\\Users\\me\\AppData\\Roaming\\npm');
  });
});

describe('expandGlobDirs', () => {
  const tree: Record<string, string[]> = {
    '/': ['usr', 'Library'],
    '/usr': ['local'],
    '/usr/local': ['texlive'],
    '/usr/local/texlive': ['2023', '2025', 'texmf-local', '.hidden'],
    '/usr/local/texlive/2023': ['bin'],
    '/usr/local/texlive/2023/bin': ['x86_64-linux'],
    '/usr/local/texlive/2025': ['bin'],
    '/usr/local/texlive/2025/bin': ['universal-darwin'],
    '/usr/local/texlive/texmf-local': [],
    '/Library': ['TeX'],
    '/Library/TeX': ['texbin'],
    '/Library/TeX/texbin': [],
  };
  const dirs = new Set<string>(Object.keys(tree));
  for (const [parent, children] of Object.entries(tree)) for (const c of children) dirs.add(parent === '/' ? `/${c}` : `${parent}/${c}`);
  const gfs: GlobFs = {
    readdir: (d) => tree[d] ?? [],
    isDirectory: (p) => dirs.has(p),
  };
  it('expands wildcards newest-first and keeps only existing dirs', () => {
    expect(expandGlobDirs(['/usr/local/texlive/*/bin/*', '/Library/TeX/texbin', '/nope'], 'darwin', gfs)).toEqual([
      '/usr/local/texlive/2025/bin/universal-darwin',
      '/usr/local/texlive/2023/bin/x86_64-linux',
      '/Library/TeX/texbin',
    ]);
  });
});

describe('executableNames', () => {
  it('adds PATHEXT candidates on Windows only', () => {
    expect(executableNames('latexmk', 'darwin')).toEqual(['latexmk']);
    const win = executableNames('claude', 'win32', '.COM;.EXE;.BAT;.CMD;.PS1');
    expect(win).toContain('claude.exe');
    expect(win).toContain('claude.cmd');
    expect(executableNames('x.exe', 'win32')).toEqual(['x.exe']);
  });
});

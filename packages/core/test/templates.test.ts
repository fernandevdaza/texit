import { describe, expect, it } from 'vitest';
import { getTemplate, templateCategories, templates } from '../src/templates';
import { analyzeLatex, lintLatex } from '../src/latex';
import { normalizePath, dirname, joinPath } from '../src/paths';
import { createProjectFromFiles } from '../src/project';

const text = (c: string | Uint8Array) => (typeof c === 'string' ? c : new TextDecoder().decode(c));

describe('templates', () => {
  it('has a rich, well-formed set', () => {
    expect(templates.length).toBeGreaterThanOrEqual(14);
    const ids = templates.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('blank');
    const accents = templates.map((t) => t.accent);
    expect(new Set(accents).size).toBe(accents.length);
    for (const t of templates) {
      expect(t.name, t.id).toBeTruthy();
      expect(t.description, t.id).toBeTruthy();
      expect(['pdflatex', 'xelatex', 'lualatex']).toContain(t.engine);
      expect(t.accent, t.id).toMatch(/gradient\(/);
      expect(t.tags?.length ?? 0, t.id).toBeGreaterThanOrEqual(2);
      for (const tag of t.tags ?? []) expect(tag, t.id).toBe(tag.toLowerCase());
      for (const f of t.files) {
        expect(f.path, t.id).toBe(normalizePath(f.path));
        expect(typeof f.content, `${t.id}/${f.path}`).toBe('string');
      }
    }
  });

  it('lists every used category', () => {
    const cats = new Set(templateCategories.map((c) => c.id));
    for (const t of templates) expect(cats.has(t.category), t.id).toBe(true);
    expect(new Set(templateCategories.map((c) => c.id)).size).toBe(templateCategories.length);
  });

  it('main files are complete documents', () => {
    for (const t of templates) {
      const main = t.files.find((f) => f.path === t.main);
      expect(main, t.id).toBeDefined();
      const src = text(main!.content);
      expect(src, t.id).toMatch(/\\documentclass/);
      expect(src, t.id).toMatch(/\\begin\{document\}/);
      expect(src, t.id).toMatch(/\\end\{document\}/);
    }
  });

  it('has no lint errors in any .tex file', () => {
    for (const t of templates) {
      for (const f of t.files) {
        if (!f.path.endsWith('.tex')) continue;
        const errors = lintLatex(text(f.content)).filter((d) => d.severity === 'error' && d.code !== 'missing-begin-document');
        expect(errors, `${t.id}/${f.path}`).toEqual([]);
      }
    }
  });

  it('covers both bibliography workflows and engine-appropriate fonts', () => {
    const mains = templates.map((t) => ({ t, a: analyzeLatex(text(t.files.find((f) => f.path === t.main)!.content)) }));
    expect(mains.some(({ a }) => a.packages.some((p) => p.name === 'biblatex') && a.includes.some((i) => i.command === 'addbibresource'))).toBe(true);
    expect(mains.some(({ t }) => /\\bibliographystyle\{/.test(text(t.files.find((f) => f.path === t.main)!.content)))).toBe(true);
    for (const { t, a } of mains) {
      const usesFontspec = a.packages.some((p) => p.name === 'fontspec');
      if (t.engine === 'pdflatex') expect(usesFontspec, t.id).toBe(false);
      if (t.engine === 'xelatex') {
        expect(usesFontspec, t.id).toBe(true);
        expect(a.magic.program, t.id).toBe('xelatex');
      }
    }
  });

  it('references only files that exist in the template', () => {
    for (const t of templates) {
      const paths = new Set(t.files.map((f) => f.path));
      for (const f of t.files) {
        if (!f.path.endsWith('.tex')) continue;
        for (const inc of analyzeLatex(text(f.content)).includes) {
          if (!['input', 'include', 'subfile', 'addbibresource', 'bibliography'].includes(inc.command)) continue;
          const ext = inc.command === 'addbibresource' ? '' : inc.command === 'bibliography' ? '.bib' : '.tex';
          const base = inc.path.endsWith(ext) || !ext ? inc.path : inc.path + ext;
          // LaTeX resolves relative to the main file directory.
          const resolved = joinPath(dirname(t.main), base);
          expect(paths.has(resolved), `${t.id}: ${inc.command}{${inc.path}}`).toBe(true);
        }
      }
    }
  });

  it('getTemplate works and templates turn into projects', () => {
    expect(getTemplate('blank')?.id).toBe('blank');
    expect(getTemplate('does-not-exist')).toBeUndefined();
    for (const t of templates) {
      const p = createProjectFromFiles({ id: t.id, name: t.name, engine: t.engine }, t.files, t.main);
      expect(p.getNode(p.getMainFileId()!)?.path, t.id).toBe(t.main);
      expect(p.listFiles().length).toBe(t.files.length);
    }
  });
});

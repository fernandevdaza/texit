/**
 * Diagnostics: live lint (`lintLatex`, debounced) + compile diagnostics for the
 * current file (refreshed when a compile finishes). Errors red, warnings
 * amber, bad boxes subtle.
 */
import { linter, lintGutter, type Diagnostic as CmDiagnostic } from '@codemirror/lint';
import { StateEffect, type Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { lintLatex, normalizePath, type Diagnostic } from '@texit/core';
import { latexLinter } from 'codemirror-lang-latex';
import { useWorkspace } from '@/state/workspace';
import { t } from '@/lib/i18n';
import { fileInfo } from './fileInfo';
import { languageIdFor } from './language';

/** Dispatched on the view when compile diagnostics changed. */
export const refreshDiagnostics = StateEffect.define<null>();

let coreLintBroken = false;

const fallbackLinter = latexLinter({
  checkMissingDocumentEnv: false,
  checkUnmatchedEnvironments: true,
  checkMissingReferences: false,
  checkUnclosedBraces: true,
  checkDuplicateLabels: false,
  checkCitesWithoutBibliography: false,
  checkMathModeCommands: false,
  checkDeprecatedCommands: true,
  checkMissingPackages: false,
});

function liveLint(view: EditorView): CmDiagnostic[] {
  const text = view.state.doc.toString();
  if (!coreLintBroken) {
    try {
      return lintLatex(text).map((d) => ({
        from: Math.max(0, Math.min(d.from, text.length)),
        to: Math.max(0, Math.min(Math.max(d.to, d.from), text.length)),
        severity: d.severity === 'error' ? 'error' : d.severity === 'warning' ? 'warning' : 'info',
        message: d.message,
        source: 'TexIt lint',
      }));
    } catch (err) {
      coreLintBroken = true;
      if (!String((err as Error)?.message).includes('not implemented')) console.warn('[editor] lintLatex failed, using fallback', err);
      setTimeout(() => (coreLintBroken = false), 60_000);
    }
  }
  try {
    return fallbackLinter(view).map((d) => ({ ...d, source: 'TexIt lint' }));
  } catch {
    return [];
  }
}

function samePath(a: string | undefined, b: string): boolean {
  if (!a) return false;
  const na = normalizePath(a.replace(/^\.\//, ''));
  return na === b || na.endsWith(`/${b}`) || b.endsWith(`/${na}`);
}

function compileDiagnostics(view: EditorView): CmDiagnostic[] {
  const info = view.state.facet(fileInfo);
  if (!info) return [];
  const all: Diagnostic[] = useWorkspace.getState().compile.diagnostics;
  const doc = view.state.doc;
  const out: CmDiagnostic[] = [];
  for (const d of all) {
    if (!d.line || !samePath(d.file, info.path)) continue;
    const lineNo = Math.min(Math.max(1, d.line), doc.lines);
    const line = doc.line(lineNo);
    const lead = line.text.length - line.text.trimStart().length;
    const from = line.from + lead;
    const to = Math.max(from, line.to);
    out.push({
      from,
      to,
      severity: d.severity === 'error' ? 'error' : d.severity === 'warning' ? 'warning' : 'info',
      markClass: d.severity === 'badbox' ? 'cm-badbox' : undefined,
      message: d.message + (d.context ? `\n${d.context.trim().slice(0, 400)}` : ''),
      source: d.severity === 'badbox' ? t('editor.diag.badBox') : t('editor.diag.compiler'),
    });
  }
  return out;
}

export function diagnosticsExtension(opts: { liveLint: boolean }): Extension {
  return [
    lintGutter({ hoverTime: 250 }),
    linter(
      (view) => {
        const info = view.state.facet(fileInfo);
        const isTex = !!info && languageIdFor(info.path) === 'latex';
        return [...(opts.liveLint && isTex ? liveLint(view) : []), ...compileDiagnostics(view)];
      },
      {
        delay: 600,
        needsRefresh: (u) => u.transactions.some((tr) => tr.effects.some((e) => e.is(refreshDiagnostics))),
        tooltipFilter: (diags) => diags.slice(0, 4),
      },
    ),
  ];
}

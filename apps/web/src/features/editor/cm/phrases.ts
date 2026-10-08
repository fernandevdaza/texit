/**
 * Translations of CodeMirror's built-in UI phrases (fold markers, lint panel,
 * screen-reader announcements…) via the `EditorState.phrases` facet.
 */
import { EditorState, type Extension } from '@codemirror/state';
import { getLocale, t } from '@/lib/i18n';

/** CodeMirror phrase → i18n key (messages live in `features/editor/i18n.ts`). */
const phraseKeys: Record<string, string> = {
  'Control character': 'editor.cm.controlCharacter',
  close: 'editor.cm.close',
  'folded code': 'editor.cm.foldedCode',
  unfold: 'editor.cm.unfold',
  'Fold line': 'editor.cm.foldLine',
  'Unfold line': 'editor.cm.unfoldLine',
  'Folded lines': 'editor.cm.foldedLines',
  'Unfolded lines': 'editor.cm.unfoldedLines',
  to: 'editor.cm.to',
  'Go to line': 'editor.cm.goToLine',
  go: 'editor.cm.go',
  'current match': 'editor.cm.currentMatch',
  'on line': 'editor.cm.onLine',
  'replaced $ matches': 'editor.cm.replacedMatches',
  'replaced match on line $': 'editor.cm.replacedMatchOnLine',
  Diagnostics: 'editor.cm.diagnostics',
  'No diagnostics': 'editor.cm.noDiagnostics',
  Completions: 'editor.cm.completions',
  'Selection deleted': 'editor.cm.selectionDeleted',
};

export function cmPhrases(): Extension {
  if (getLocale() === 'en') return [];
  const phrases: Record<string, string> = {};
  for (const [phrase, key] of Object.entries(phraseKeys)) phrases[phrase] = t(key);
  return EditorState.phrases.of(phrases);
}

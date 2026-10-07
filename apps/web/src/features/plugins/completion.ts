/**
 * Turns plugin snippets / completion sources into CodeMirror extensions.
 *
 * Sources are contributed through `EditorState.languageData` so they combine
 * with the editor's own completion sources (instead of replacing them, as an
 * `autocompletion({ override })` would).
 */
import { snippetCompletion, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { EditorState, type Extension } from '@codemirror/state';
import { extname } from '@texit/core';
import type { CompletionItem, CompletionSourceDef, Snippet } from '@texit/plugin-api';

const TYPE_MAP: Record<NonNullable<CompletionItem['type']>, string> = {
  command: 'function',
  environment: 'type',
  reference: 'variable',
  citation: 'constant',
  file: 'namespace',
  keyword: 'keyword',
  text: 'text',
};

function appliesTo(languages: string[] | undefined, path: string | null): boolean {
  if (!languages?.length) return true;
  const ext = path ? extname(path) : '';
  return languages.some((l) => l.replace(/^\./, '').toLowerCase() === ext);
}

export function snippetsExtension(snippets: Snippet[], getPath: () => string | null, section: string): Extension {
  const options = snippets.map((s) => ({
    snippet: s,
    completion: snippetCompletion(s.template, {
      label: s.label,
      detail: s.detail ?? 'snippet',
      type: 'text',
      section,
      boost: -5,
    }),
  }));
  const source = (ctx: CompletionContext): CompletionResult | null => {
    const word = ctx.matchBefore(/\\?[A-Za-z][\w:-]*$/);
    if (!word && !ctx.explicit) return null;
    const path = getPath();
    const list = options.filter((o) => appliesTo(o.snippet.languages, path)).map((o) => o.completion);
    if (!list.length) return null;
    return { from: word?.from ?? ctx.pos, options: list, validFor: /^\\?[\w:-]*$/ };
  };
  return EditorState.languageData.of(() => [{ autocomplete: source }]);
}

function toCompletion(item: CompletionItem, section: string): Completion {
  const insert = item.insert ?? item.label;
  const base: Completion = {
    label: item.label,
    detail: item.detail,
    info: item.info,
    type: item.type ? TYPE_MAP[item.type] : undefined,
    boost: item.boost,
    section,
  };
  if (item.snippet) return snippetCompletion(insert, base);
  return { ...base, apply: insert };
}

/**
 * `trigger` is matched against the text of the line before the cursor (an
 * implicit `$` anchor is added). The last capture group — or the whole match
 * when there are no groups — is the text being completed and gets replaced.
 */
export function completionSourceExtension(
  def: CompletionSourceDef,
  getPath: () => string | null,
  section: string,
  provide: (ctx: { before: string; match: RegExpMatchArray; path: string }) => Promise<CompletionItem[] | null | undefined>,
): Extension {
  const flags = def.trigger.flags.replace(/[gy]/g, '');
  const re = new RegExp(`(?:${def.trigger.source})$`, flags);
  const source = async (ctx: CompletionContext): Promise<CompletionResult | null> => {
    const line = ctx.state.doc.lineAt(ctx.pos);
    const before = line.text.slice(0, ctx.pos - line.from);
    const match = re.exec(before);
    if (!match) return null;
    const items = await provide({ before, match, path: getPath() ?? '' });
    if (!items?.length || ctx.aborted) return null;
    const current = match.length > 1 ? (match[match.length - 1] ?? '') : match[0];
    return {
      from: ctx.pos - current.length,
      options: items.map((i) => toCompletion(i, section)),
      validFor: /^[\w:.\-/]*$/,
    };
  };
  return EditorState.languageData.of(() => [{ autocomplete: source }]);
}

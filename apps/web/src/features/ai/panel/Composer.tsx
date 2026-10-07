import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react';
import { ArrowUp, AtSign, Bug, Languages, MessageSquareText, Plus, Sparkles, Square, Table2, Workflow } from 'lucide-react';
import { getQuickAction, type ChatAttachment } from '@texit/ai';
import { cn } from '@/lib/cn';
import { getEditorBridge, selectionChanged, type EditorSelectionInfo } from '@/services/editor';
import { useWorkspace } from '@/state/workspace';
import { IconButton, promptDialog, toast } from '@/ui';
import { activeFileInfo } from '../projectContext';
import { askAi, sendMessage, stopRun } from '../chat/runner';
import { useChat } from '../chat/store';
import { AttachmentChip } from './MessageList';

const MAX_IMAGE = 5 * 1024 * 1024;
const MAX_FILE_CHARS = 120_000;

function useLiveSelection(): EditorSelectionInfo | null {
  const [sel, setSel] = useState<EditorSelectionInfo | null>(() => getEditorBridge()?.getSelection() ?? null);
  useEffect(() => {
    const d = selectionChanged.on((s) => setSel(s && s.text ? s : null));
    return () => d.dispose();
  }, []);
  return sel?.text ? sel : null;
}

function readImage(file: File): Promise<ChatAttachment | null> {
  if (!file.type.startsWith('image/')) return Promise.resolve(null);
  if (file.size > MAX_IMAGE) {
    toast.error('Images must be smaller than 5 MB.');
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve({ kind: 'image', dataUrl: String(r.result), name: file.name || 'Pasted image' });
    r.onerror = () => resolve(null);
    r.readAsDataURL(file);
  });
}

function lineOf(sel: EditorSelectionInfo): number {
  const view = getEditorBridge()?.getView();
  return view ? view.state.doc.lineAt(Math.min(sel.from, view.state.doc.length)).number : sel.line;
}

export function Composer({ threadId, disabled }: { threadId: string | null; disabled?: boolean }) {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [dismissedSel, setDismissedSel] = useState<string | null>(null);
  const [mention, setMention] = useState<{ query: string; start: number; index: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);
  const running = useChat((s) => !!(threadId && s.running[threadId]));
  const seed = useChat((s) => s.composerSeed);
  const focusNonce = useChat((s) => s.focusNonce);
  const files = useWorkspace((s) => s.files);
  const diagnostics = useWorkspace((s) => s.compile.diagnostics);
  const activeId = useWorkspace((s) => s.activeFileId);
  const project = useWorkspace((s) => s.project);
  const sel = useLiveSelection();
  const selKey = sel ? `${sel.path}:${sel.from}:${sel.to}` : null;
  const selAttachment: ChatAttachment | null = sel && selKey !== dismissedSel ? { kind: 'selection', path: sel.path, line: lineOf(sel), text: sel.text } : null;
  const activePath = activeId && project?.has(activeId) ? project.getPath(activeId) : null;

  useEffect(() => {
    if (seed) {
      setText(seed.text);
      requestAnimationFrame(() => ta.current?.focus());
    }
  }, [seed]);
  useEffect(() => {
    requestAnimationFrame(() => ta.current?.focus());
  }, [focusNonce]);

  // Auto-grow.
  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [text]);

  const mentionItems = useMemo(() => {
    if (!mention) return [];
    const q = mention.query.toLowerCase();
    return files
      .filter((f) => f.kind === 'file' && f.path.toLowerCase().includes(q))
      .sort((a, b) => Number(!a.name.toLowerCase().startsWith(q)) - Number(!b.name.toLowerCase().startsWith(q)) || a.path.length - b.path.length)
      .slice(0, 8);
  }, [mention, files]);

  const addAttachment = (a: ChatAttachment) =>
    setAttachments((cur) => (cur.some((x) => x.kind === a.kind && x.path === a.path && a.kind !== 'image') ? cur : [...cur, a]));

  const pickMention = (path: string) => {
    if (!mention) return;
    const caret = ta.current?.selectionStart ?? text.length;
    setText(text.slice(0, mention.start) + text.slice(caret));
    addAttachment({ kind: 'file', path });
    setMention(null);
    requestAnimationFrame(() => {
      ta.current?.focus();
      ta.current?.setSelectionRange(mention.start, mention.start);
    });
  };

  const updateMention = (value: string, caret: number) => {
    const m = /(^|\s)@([\w./-]*)$/.exec(value.slice(0, caret));
    setMention(m ? { query: m[2], start: caret - m[2].length - 1, index: 0 } : null);
  };

  const resolveAttachments = (): ChatAttachment[] => {
    const out: ChatAttachment[] = [];
    if (selAttachment) out.push(selAttachment);
    for (const a of attachments) {
      if (a.kind === 'file' && a.path && a.text == null && project) {
        const id = project.findByPath(a.path);
        const node = id ? project.getNode(id) : null;
        out.push(node?.isText ? { ...a, text: project.readText(id!).slice(0, MAX_FILE_CHARS) } : a);
      } else out.push(a);
    }
    return out;
  };

  const submit = () => {
    const value = text.trim();
    if (!value || running || disabled) return;
    const atts = resolveAttachments();
    setText('');
    setAttachments([]);
    if (selKey) setDismissedSel(selKey);
    void sendMessage(value, { attachments: atts, threadId: threadId ?? undefined }).catch((e) => toast.error((e as Error).message));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mention && mentionItems.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const d = e.key === 'ArrowDown' ? 1 : -1;
        setMention({ ...mention, index: (mention.index + d + mentionItems.length) % mentionItems.length });
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        pickMention(mentionItems[mention.index].path);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMention(null);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const onPaste = async (e: ClipboardEvent) => {
    const imgs = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'));
    if (!imgs.length) return;
    e.preventDefault();
    for (const f of imgs) {
      const a = await readImage(f);
      if (a) addAttachment(a);
    }
  };

  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    for (const f of [...e.dataTransfer.files]) {
      const a = await readImage(f);
      if (a) addAttachment(a);
    }
  };

  const hasFileAtt = (path: string) => attachments.some((a) => a.kind === 'file' && a.path === path);
  const hasDiagAtt = attachments.some((a) => a.kind === 'diagnostics');

  const quick = [
    {
      id: 'fix',
      label: 'Fix compile errors',
      icon: Bug,
      run: () => askAi(getQuickAction('fix-error')!.buildPrompt({}).replace(/\n\nDiagnostics:[\s\S]*$/, ''), { includeDiagnostics: true }),
    },
    {
      id: 'explain',
      label: 'Explain selection',
      icon: MessageSquareText,
      run: () => {
        const a = activeFileInfo();
        if (!a?.selection?.text) return void toast.info('Select some LaTeX in the editor first.');
        void askAi(getQuickAction('explain-selection')!.buildPrompt({ selection: a.selection.text, path: a.path }));
      },
    },
    {
      id: 'improve',
      label: 'Improve writing',
      icon: Sparkles,
      run: () => {
        const a = activeFileInfo();
        const target = a?.selection?.text ? 'the selected text' : `the paragraph around the cursor in ${a?.path ?? 'the current file'}`;
        void askAi(`Improve the writing of ${target}: clarity, flow, grammar and concision. Keep the meaning, the LaTeX markup, citations and the language. Apply the change as a minimal edit.`, {
          includeSelection: true,
        });
      },
    },
    {
      id: 'translate',
      label: 'Translate…',
      icon: Languages,
      run: async () => {
        const lang = await promptDialog({ title: 'Translate to…', placeholder: 'e.g. Spanish, German, English', confirmLabel: 'Translate' });
        if (!lang) return;
        const a = activeFileInfo();
        const target = a?.selection?.text ? 'the selected text' : `the current file (${a?.path ?? 'main document'})`;
        void askAi(`Translate ${target} into ${lang}. Translate only natural-language text — keep commands, environments, labels, citation keys and math unchanged — and replace it in the document.`, {
          includeSelection: true,
        });
      },
    },
    {
      id: 'tikz',
      label: 'Generate TikZ…',
      icon: Workflow,
      run: async () => {
        const desc = await promptDialog({ title: 'Generate a TikZ figure', placeholder: 'e.g. a flowchart: input → process → output', confirmLabel: 'Generate' });
        if (!desc) return;
        const a = activeFileInfo();
        void askAi(
          `${getQuickAction('tikz')!.buildPrompt({ params: { description: desc } })}\nInsert it into ${a?.path ?? 'the main document'}${a?.selection ? ` at line ${a.selection.line}` : ''} and make sure the preamble loads tikz and the needed libraries.`,
        );
      },
    },
    {
      id: 'table',
      label: 'Table from description…',
      icon: Table2,
      run: async () => {
        const desc = await promptDialog({ title: 'Create a table', placeholder: 'e.g. 3 methods × accuracy, runtime, memory', confirmLabel: 'Create' });
        if (!desc) return;
        const a = activeFileInfo();
        void askAi(
          `Create a LaTeX table for: ${desc}. Use a table environment with caption and label and booktabs rules. Insert it into ${a?.path ?? 'the main document'}${a?.selection ? ` at line ${a.selection.line}` : ''}; add \\usepackage{booktabs} to the preamble if it is missing.`,
        );
      },
    },
  ];

  return (
    <div className="shrink-0 px-3 pb-3 pt-1">
      <div className="no-scrollbar -mx-3 mb-1.5 flex gap-1 overflow-x-auto px-3 [scrollbar-width:none]">
        {quick.map((q) => (
          <button
            key={q.id}
            disabled={running || disabled}
            onClick={() => void q.run()}
            className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full border border-border bg-surface px-2 text-[11px] text-fg-muted transition-colors hover:border-border-strong hover:text-fg disabled:opacity-50 [&_svg]:size-3"
          >
            <q.icon />
            {q.label}
          </button>
        ))}
      </div>
      <div
        onDragOver={(e) => {
          if ([...e.dataTransfer.types].includes('Files')) {
            e.preventDefault();
            setDragging(true);
          }
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          'relative rounded-xl border bg-surface shadow-xs transition-[border,box-shadow] focus-within:border-accent focus-within:ring-3 focus-within:ring-accent/15',
          dragging ? 'border-accent ring-3 ring-accent/20' : 'border-border',
        )}
      >
        {mention && mentionItems.length > 0 && (
          <div className="absolute bottom-full left-2 right-2 z-20 mb-1 overflow-hidden rounded-lg border border-border bg-elevated p-1 shadow-pop">
            <div className="px-2 pb-1 pt-0.5 text-[10.5px] font-semibold uppercase tracking-wider text-fg-subtle">Attach file</div>
            {mentionItems.map((f, i) => (
              <button
                key={f.id}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pickMention(f.path);
                }}
                className={cn('flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[12px]', i === mention.index ? 'bg-accent text-accent-fg' : 'text-fg hover:bg-hover')}
              >
                <span className="truncate font-medium">{f.name}</span>
                <span className={cn('truncate text-[11px]', i === mention.index ? 'text-accent-fg/70' : 'text-fg-subtle')}>{f.path}</span>
              </button>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-1 px-2 pt-2">
          {selAttachment && <AttachmentChip a={selAttachment} onRemove={() => setDismissedSel(selKey)} />}
          {attachments.map((a, i) => (
            <AttachmentChip key={i} a={a} onRemove={() => setAttachments(attachments.filter((_, k) => k !== i))} />
          ))}
          {activePath && !hasFileAtt(activePath) && (
            <AttachmentChip suggested a={{ kind: 'file', path: activePath }} onClick={() => addAttachment({ kind: 'file', path: activePath })} />
          )}
          {diagnostics.length > 0 && !hasDiagAtt && (
            <AttachmentChip suggested a={{ kind: 'diagnostics', diagnostics }} onClick={() => addAttachment({ kind: 'diagnostics', diagnostics })} />
          )}
        </div>
        <textarea
          ref={ta}
          value={text}
          rows={1}
          disabled={disabled}
          onChange={(e) => {
            setText(e.target.value);
            updateMention(e.target.value, e.target.selectionStart);
          }}
          onKeyDown={onKeyDown}
          onPaste={(e) => void onPaste(e)}
          onBlur={() => setTimeout(() => setMention(null), 120)}
          placeholder={disabled ? 'Configure a model provider to start chatting' : 'Ask anything, @ to attach files…'}
          className="block max-h-60 min-h-[44px] w-full resize-none bg-transparent px-3 py-2 text-[13px] leading-relaxed text-fg outline-none placeholder:text-fg-subtle"
        />
        <div className="flex items-center gap-1 px-2 pb-2">
          <IconButton
            size="xs"
            label="Attach file (@)"
            onClick={() => {
              const caret = ta.current?.selectionStart ?? text.length;
              const before = text.slice(0, caret);
              const insert = before && !/\s$/.test(before) ? ' @' : '@';
              const next = before + insert + text.slice(caret);
              setText(next);
              updateMention(next, caret + insert.length);
              requestAnimationFrame(() => {
                ta.current?.focus();
                ta.current?.setSelectionRange(caret + insert.length, caret + insert.length);
              });
            }}
          >
            <AtSign />
          </IconButton>
          <IconButton
            size="xs"
            label="Attach image"
            onClick={() => {
              const input = document.createElement('input');
              input.type = 'file';
              input.accept = 'image/*';
              input.multiple = true;
              input.onchange = async () => {
                for (const f of [...(input.files ?? [])]) {
                  const a = await readImage(f);
                  if (a) addAttachment(a);
                }
              };
              input.click();
            }}
          >
            <Plus />
          </IconButton>
          <span className="flex-1" />
          <span className="mr-1 hidden text-[10.5px] text-fg-subtle sm:inline">{running ? '' : '⏎ send · ⇧⏎ newline'}</span>
          {running ? (
            <button
              onClick={() => stopRun(threadId ?? undefined)}
              className="flex size-7 items-center justify-center rounded-lg bg-fg text-bg transition-opacity hover:opacity-85"
              aria-label="Stop"
              title="Stop"
            >
              <Square className="size-3 fill-current" />
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={!text.trim() || disabled}
              className="flex size-7 items-center justify-center rounded-lg bg-accent text-accent-fg shadow-sm shadow-accent/25 transition-[opacity,filter] hover:brightness-110 disabled:opacity-35"
              aria-label="Send"
              title="Send (Enter)"
            >
              <ArrowUp className="size-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

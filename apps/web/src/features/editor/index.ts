/**
 * Editor feature: registers the EditorBridge, editor/file commands, status bar
 * items and wires the CodeMirror controller to workspace state.
 */
import './i18n';
import {
  Bold,
  Braces,
  ChevronsDownUp,
  ChevronsUpDown,
  Crosshair,
  Image,
  Italic,
  List,
  ListOrdered,
  MessageSquareCode,
  Save,
  Search,
  Sigma,
  Table2,
  Underline,
  WrapText,
  X,
  Type,
  Heading,
} from 'lucide-react';
import { foldAll, unfoldAll } from '@codemirror/language';
import { openSearchPanel } from '@codemirror/search';
import { awarenessChanged } from '@/services/collab';
import { executeCommand, registerCommands, type Command } from '@/services/commands';
import { extensionsChanged, setEditorBridge } from '@/services/editor';
import { registerStatusItem } from '@/services/panels';
import { useResolvedTheme, useSettings } from '@/state/settings';
import { useWorkspace } from '@/state/workspace';
import { toast } from '@/ui';
import { t } from '@/lib/i18n';
import { editorController, gotoLineCommand } from './cm/controller';
import { insertSnippet, toggleComment, wrapSelection } from './cm/editing';
import { FileTypeStatus, KeymapStatus } from './StatusItems';

const inProject = () => !!useWorkspace.getState().project;
const hasEditor = () => !!editorController.activeView();

function withView(fn: (view: NonNullable<ReturnType<typeof editorController.activeView>>) => unknown) {
  return () => {
    const v = editorController.activeView();
    if (!v) return;
    fn(v);
    v.focus();
  };
}

const snippets = {
  figure: '\\begin{figure}[htbp]\n\t\\centering\n\t\\includegraphics[width=0.8\\linewidth]{${1:image}}\n\t\\caption{${2:Caption}}\n\t\\label{fig:${3:label}}\n\\end{figure}\n${0}',
  table:
    '\\begin{table}[htbp]\n\t\\centering\n\t\\caption{${1:Caption}}\n\t\\label{tab:${2:label}}\n\t\\begin{tabular}{${3:lll}}\n\t\t\\toprule\n\t\t${4:A} & ${5:B} & ${6:C} \\\\\n\t\t\\midrule\n\t\t${7} \\\\\n\t\t\\bottomrule\n\t\\end{tabular}\n\\end{table}\n${0}',
  equation: '\\begin{equation}\n\t${1}\n\t\\label{eq:${2:label}}\n\\end{equation}\n${0}',
  align: '\\begin{align}\n\t${1} &= ${2}\n\\end{align}\n${0}',
  itemize: '\\begin{itemize}\n\t\\item ${1}\n\\end{itemize}\n${0}',
  enumerate: '\\begin{enumerate}\n\t\\item ${1}\n\\end{enumerate}\n${0}',
  section: '\\section{${1:Title}}\n\\label{sec:${2:label}}\n${0}',
  subsection: '\\subsection{${1:Title}}\n${0}',
  footnote: '\\footnote{${1:${SELECTION}}}',
  displayMath: '\\[\n\t${1:${SELECTION}}\n\\]',
};

export function activate(): void | (() => void) {
  const c = editorController;
  if (import.meta.env.DEV) (window as unknown as { __texitEditor: unknown }).__texitEditor = c;

  setEditorBridge({
    getView: () => c.activeView(),
    getSelection: () => c.getSelectionInfo(),
    replaceSelection(text) {
      const v = c.activeView();
      if (!v) return;
      v.dispatch(v.state.replaceSelection(text), { userEvent: 'input', scrollIntoView: true });
    },
    insertText(text) {
      const v = c.activeView();
      if (!v) return;
      const pos = v.state.selection.main.head;
      v.dispatch({ changes: { from: pos, insert: text }, selection: { anchor: pos + text.length }, userEvent: 'input', scrollIntoView: true });
    },
    wrapSelection(before, after) {
      const v = c.activeView();
      if (v) wrapSelection(v, before, after);
    },
    focus() {
      c.activeView()?.focus();
    },
  });

  const unsubs: (() => void)[] = [];
  // Project / tree / reveal / diagnostics wiring.
  unsubs.push(
    useWorkspace.subscribe((s, p) => {
      if (s.project !== p.project) c.setProject(s.project);
      if (s.treeVersion !== p.treeVersion) c.onTreeChanged();
      if (s.revealRequest && s.revealRequest !== p.revealRequest) c.reveal(s.revealRequest);
      if (s.compile.diagnostics !== p.compile.diagnostics) c.refreshDiagnostics();
    }),
  );
  unsubs.push(useSettings.subscribe((s, p) => s.editor !== p.editor && c.applySettings(s.editor, p.editor)));
  unsubs.push(useSettings.subscribe((s, p) => s.locale !== p.locale && c.applyLocale()));
  unsubs.push(useResolvedTheme.subscribe((s, p) => s.theme !== p.theme && c.applyTheme()));
  const d1 = awarenessChanged.on(() => c.applyAwareness());
  const d2 = extensionsChanged.on(() => c.applyContributed());
  c.setProject(useWorkspace.getState().project);

  const fmt = (id: string, title: string, icon: Command['icon'], keybinding: string | undefined, before: string, after: string): Command => ({
    id,
    title,
    category: 'Edit',
    icon,
    keybinding,
    when: hasEditor,
    run: withView((v) => wrapSelection(v, before, after)),
  });
  const ins = (id: string, title: string, icon: Command['icon'], tpl: string, keywords?: string[]): Command => ({
    id,
    title,
    category: 'Insert',
    icon,
    keywords,
    when: hasEditor,
    run: withView((v) => insertSnippet(v, tpl)),
  });

  const disposables = [
    registerCommands([
      {
        id: 'editor.syncToPdf',
        title: 'Show in PDF',
        category: 'View',
        icon: Crosshair,
        keybinding: 'Mod-Alt-j',
        global: true,
        keywords: ['synctex', 'forward search'],
        when: () => !!c.getSelectionInfo(),
        run: () => {
          const info = c.getSelectionInfo();
          if (info) useWorkspace.getState().syncPdfTo(info.path, info.line);
        },
      },
      {
        id: 'file.close',
        title: 'Close editor tab',
        category: 'File',
        icon: X,
        keybinding: 'Mod-w',
        global: true,
        when: inProject,
        run: () => {
          const ws = useWorkspace.getState();
          if (ws.activeFileId) ws.closeTab(ws.activeFileId);
        },
      },
      {
        id: 'file.closeAll',
        title: 'Close all editor tabs',
        category: 'File',
        when: inProject,
        run: () => useWorkspace.setState({ openTabs: [], activeFileId: null, previewTabId: null }),
      },
      {
        id: 'file.save',
        title: 'Save & compile',
        category: 'File',
        icon: Save,
        keybinding: 'Mod-s',
        global: true,
        when: inProject,
        run: () => {
          void executeCommand('compile.run');
          try {
            if (!localStorage.getItem('texit:saveHint')) {
              localStorage.setItem('texit:saveHint', '1');
              toast(t('editor.saved'), { description: t('editor.savedHint') });
            }
          } catch {
            /* ignore */
          }
        },
      },
      {
        id: 'view.nextTab',
        title: 'Next editor tab',
        category: 'View',
        keybinding: 'Mod-Alt-ArrowRight',
        global: true,
        when: inProject,
        run: () => cycleTab(1),
      },
      {
        id: 'view.prevTab',
        title: 'Previous editor tab',
        category: 'View',
        keybinding: 'Mod-Alt-ArrowLeft',
        global: true,
        when: inProject,
        run: () => cycleTab(-1),
      },
      fmt('edit.bold', 'Bold', Bold, 'Mod-b', '\\textbf{', '}'),
      fmt('edit.italic', 'Italic', Italic, 'Mod-i', '\\textit{', '}'),
      fmt('edit.underline', 'Underline', Underline, 'Mod-u', '\\underline{', '}'),
      fmt('edit.emph', 'Emphasize', Type, undefined, '\\emph{', '}'),
      fmt('edit.inlineMath', 'Inline math', Sigma, 'Mod-Shift-m', '$', '$'),
      fmt('edit.monospace', 'Monospace (\\texttt)', Braces, undefined, '\\texttt{', '}'),
      { id: 'edit.toggleComment', title: 'Toggle line comment', category: 'Edit', icon: MessageSquareCode, keybinding: 'Mod-/', when: hasEditor, run: withView((v) => toggleComment(v)) },
      { id: 'editor.find', title: 'Find in file', category: 'Edit', icon: Search, keybinding: 'Mod-f', when: hasEditor, run: withView((v) => openSearchPanel(v)) },
      {
        id: 'editor.gotoLine',
        title: 'Go to line…',
        category: 'Edit',
        keybinding: 'Ctrl-g',
        when: hasEditor,
        run: () => {
          const v = c.activeView();
          if (v) gotoLineCommand(v);
        },
      },
      { id: 'editor.foldAll', title: 'Fold all', category: 'Edit', icon: ChevronsDownUp, when: hasEditor, run: withView((v) => foldAll(v)) },
      { id: 'editor.unfoldAll', title: 'Unfold all', category: 'Edit', icon: ChevronsUpDown, when: hasEditor, run: withView((v) => unfoldAll(v)) },
      {
        id: 'editor.toggleRichText',
        title: 'Toggle rich text mode',
        category: 'View',
        icon: Heading,
        run: () => useSettings.getState().setEditor({ richText: !useSettings.getState().editor.richText }),
      },
      {
        id: 'editor.toggleWordWrap',
        title: 'Toggle word wrap',
        category: 'View',
        icon: WrapText,
        keybinding: 'Alt-z',
        global: true,
        when: inProject,
        run: () => useSettings.getState().setEditor({ wordWrap: !useSettings.getState().editor.wordWrap }),
      },
      ins('insert.figure', 'Figure', Image, snippets.figure, ['includegraphics', 'image']),
      ins('insert.table', 'Table', Table2, snippets.table, ['tabular', 'booktabs']),
      ins('insert.equation', 'Equation', Sigma, snippets.equation, ['math', 'formula']),
      ins('insert.align', 'Aligned equations', Sigma, snippets.align, ['math', 'align']),
      ins('insert.displayMath', 'Display math \\[ \\]', Sigma, snippets.displayMath, ['math']),
      ins('insert.itemize', 'Bulleted list', List, snippets.itemize, ['itemize']),
      ins('insert.enumerate', 'Numbered list', ListOrdered, snippets.enumerate, ['enumerate']),
      ins('insert.section', 'Section', Heading, snippets.section, ['heading']),
      ins('insert.subsection', 'Subsection', Heading, snippets.subsection, ['heading']),
      ins('insert.footnote', 'Footnote', Type, snippets.footnote),
    ]),
    registerStatusItem({ id: 'editor.fileType', align: 'right', order: 30, component: FileTypeStatus }),
    registerStatusItem({ id: 'editor.keymap', align: 'right', order: 40, component: KeymapStatus }),
  ];

  return () => {
    unsubs.forEach((u) => u());
    d1.dispose();
    d2.dispose();
    disposables.forEach((d) => d.dispose());
    setEditorBridge(null);
  };
}

function cycleTab(dir: 1 | -1) {
  const ws = useWorkspace.getState();
  if (!ws.openTabs.length) return;
  const i = ws.openTabs.indexOf(ws.activeFileId ?? '');
  const next = ws.openTabs[(i + dir + ws.openTabs.length) % ws.openTabs.length];
  ws.setActive(next);
}

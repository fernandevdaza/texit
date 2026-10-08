/**
 * AI feature activation: AI bridge, commands, editor extensions (Cmd-K inline edit,
 * ghost text), status-bar item, per-project chat threads, desktop MCP server wiring.
 *
 * Nothing here imports @texit/ai statically — it is loaded on first use (sdk.ts).
 */
import './i18n';
import { Bug, MessageSquarePlus, MessageSquareText, Sparkles, Wand2 } from 'lucide-react';
import { setAiBridge } from '@/services/ai';
import { registerCommands } from '@/services/commands';
import { contributeEditorExtension, getEditorBridge } from '@/services/editor';
import { registerStatusItem } from '@/services/panels';
import { useLayout, useWorkspace } from '@/state/workspace';
import { toast } from '@/ui';
import { t } from '@/lib/i18n';
import { loadAi } from './sdk';
import { chatModelRef, ensureSecrets, isConfigured, registerPluginTool, resolveModel } from './runtime';
import { focusComposer, loadProject, newThread, useChat } from './chat/store';
import { askAi, stopRun } from './chat/runner';
import { inlineEditExtension, openInlineEdit } from './inline/inlineEdit';
import { ghostTextExtension } from './inline/ghostText';
import { startMcpServerWiring } from './mcpServer';
import { AiStatusItem } from './StatusItem';

export { AiPanel } from './AiPanel';
export { AiSettings } from './AiSettings';

const inProject = () => !!useWorkspace.getState().project;

function openPanel() {
  useLayout.getState().set({ aiOpen: true });
  focusComposer();
}

export function activate(): void | (() => void) {
  void ensureSecrets();

  setAiBridge({
    async complete(prompt, opts) {
      const resolved = await resolveModel(chatModelRef());
      if (!resolved.model) throw new Error(t('ai.err.cliNoCompletions'));
      const ai = await loadAi();
      return ai.completeText({ model: resolved.model, prompt, system: opts?.system, signal: opts?.signal });
    },
    registerTool: registerPluginTool,
    ask(message, opts) {
      void askAi(message, opts).catch((e) => toast.error((e as Error).message));
    },
    isConfigured,
  });

  // Per-project threads.
  void loadProject(useWorkspace.getState().session?.id ?? null);
  const unsubProject = useWorkspace.subscribe((s, p) => {
    if (s.session?.id !== p.session?.id) {
      for (const id of Object.keys(useChat.getState().running)) stopRun(id);
      void loadProject(s.session?.id ?? null);
    }
  });

  const disposables = [
    contributeEditorExtension('ai.inlineEdit', inlineEditExtension()),
    contributeEditorExtension('ai.ghostText', ghostTextExtension()),
    registerStatusItem({ id: 'ai.status', align: 'right', order: 80, component: AiStatusItem }),
    registerCommands([
      { id: 'ai.openChat', title: 'Open AI assistant', category: 'AI', icon: Sparkles, keywords: ['chat', 'copilot', 'agent', 'ia', 'asistente'], run: openPanel },
      {
        id: 'ai.inlineEdit',
        title: 'Edit with AI (inline)',
        category: 'AI',
        icon: Wand2,
        keybinding: 'Mod-k',
        when: inProject,
        run: () => {
          const view = getEditorBridge()?.getView();
          if (!view) return void toast.info(t('ai.openFileFirst'));
          view.focus();
          openInlineEdit(view);
        },
      },
      {
        id: 'ai.explainSelection',
        title: 'Explain selection with AI',
        category: 'AI',
        icon: MessageSquareText,
        when: inProject,
        run: () => {
          const sel = getEditorBridge()?.getSelection();
          if (!sel?.text) return void toast.info(t('ai.selectLatexFirst'));
          void askAi('Explain what the selected LaTeX does, briefly. Do not change any files.', { includeSelection: true });
        },
      },
      {
        id: 'ai.fixErrors',
        title: 'Fix compile errors with AI',
        category: 'AI',
        icon: Bug,
        keywords: ['debug', 'diagnostics', 'problems'],
        when: inProject,
        run: () =>
          void askAi('Fix the compile errors with minimal, targeted changes, then compile to verify. The diagnostics and the end of the log are attached.', {
            includeDiagnostics: true,
          }),
      },
      {
        id: 'ai.newThread',
        title: 'New AI chat',
        category: 'AI',
        icon: MessageSquarePlus,
        when: inProject,
        run: () => {
          newThread();
          openPanel();
        },
      },
      { id: 'ai.stop', title: 'Stop AI response', category: 'AI', hidden: true, run: () => stopRun() },
    ]),
  ];

  const stopMcp = startMcpServerWiring();

  return () => {
    unsubProject();
    stopMcp();
    disposables.forEach((d) => d.dispose());
    setAiBridge(null);
  };
}


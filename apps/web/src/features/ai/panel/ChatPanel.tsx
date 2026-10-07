import { useMemo } from 'react';
import { Bot, Check, ChevronDown, History, KeyRound, MessageSquarePlus, Settings2, Sparkles, Trash2, X } from 'lucide-react';
import { timeAgo } from '@/lib/format';
import { executeCommand, getCommand } from '@/services/commands';
import { useLayout, useWorkspace } from '@/state/workspace';
import { Button, DropdownMenu, IconButton, Segmented, type MenuEntry } from '@/ui';
import { useSettingsUi } from '@/features/settings/store';
import { DEV, isConfigured, providerReady } from '../runtime';
import { useSecrets } from '../secrets';
import { useAiSettings } from '../store';
import { deleteThread, newThread, openThread, useChat } from '../chat/store';
import { sendMessage } from '../chat/runner';
import { ProviderLogo } from '../components/ProviderLogo';
import { Composer } from './Composer';
import { MessageList } from './MessageList';

export function openAiSettings() {
  if (getCommand('app.settings')) void executeCommand('app.settings', 'ai');
  else useSettingsUi.getState().show('ai');
}

function ModelPicker() {
  const providers = useAiSettings((s) => s.providers);
  const chatModel = useAiSettings((s) => s.chatModel);
  useSecrets((s) => s.values);
  const current = providers.find((p) => p.id === chatModel?.providerId);
  const items: MenuEntry[] = [];
  for (const p of providers) {
    if (!p.enabled) continue;
    const ready = providerReady(p);
    const models = [...new Set([...(p.defaultModel ? [p.defaultModel] : []), ...p.models])];
    if (!models.length) continue;
    items.push({ type: 'label', label: `${p.name}${ready ? '' : ' · needs setup'}` });
    for (const m of models.slice(0, 12)) {
      items.push({
        label: m,
        checked: chatModel?.providerId === p.id && chatModel.modelId === m,
        disabled: !ready,
        onSelect: () => useAiSettings.getState().set({ chatModel: { providerId: p.id, modelId: m } }),
      });
    }
  }
  if (items.length) items.push({ type: 'separator' });
  items.push({ label: 'Manage providers…', icon: <Settings2 />, onSelect: openAiSettings });
  return (
    <DropdownMenu
      align="end"
      items={items}
      trigger={
        <button className="flex h-7 min-w-0 max-w-[170px] items-center gap-1.5 rounded-md px-1.5 text-[12px] text-fg-muted hover:bg-hover hover:text-fg">
          {current ? <ProviderLogo kind={current.kind} cliAgent={current.cliAgent} size={16} /> : <Bot className="size-3.5" />}
          <span className="truncate">{chatModel?.modelId ?? 'Choose model'}</span>
          <ChevronDown className="size-3 shrink-0 opacity-60" />
        </button>
      }
    />
  );
}

function ThreadMenu() {
  const index = useChat((s) => s.index);
  const activeId = useChat((s) => s.activeId);
  const items: MenuEntry[] = [{ label: 'New chat', icon: <MessageSquarePlus />, onSelect: () => newThread() }];
  if (index.length) items.push({ type: 'separator' }, { type: 'label', label: 'Recent chats' });
  for (const t of index.slice(0, 30)) {
    items.push({
      label: (
        <span className="flex items-center gap-1.5">
          {t.external && <Bot className="size-3 shrink-0" />}
          <span className="truncate">{t.title}</span>
        </span>
      ),
      hint: timeAgo(t.updatedAt),
      checked: t.id === activeId,
      onSelect: () => void openThread(t.id),
    });
  }
  if (activeId) items.push({ type: 'separator' }, { label: 'Delete this chat', icon: <Trash2 />, danger: true, onSelect: () => void deleteThread(activeId) });
  return (
    <DropdownMenu
      items={items}
      trigger={
        <IconButton label="Chat history" size="sm">
          <History />
        </IconButton>
      }
    />
  );
}

const EXAMPLES = [
  'Fix the compile errors in my document',
  'Make the abstract more concise',
  'Add a table comparing the three methods in the results section',
  'Explain what the selected equation means',
  'Check my bibliography for unused entries',
];

function Intro({ configured }: { configured: boolean }) {
  const hasProject = useWorkspace((s) => !!s.project);
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-6 py-8 text-center">
      <div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,var(--tx-accent),#b06cff)] text-white shadow-lg shadow-accent/25">
        <Sparkles className="size-6" />
      </div>
      <h2 className="text-[16px] font-semibold tracking-tight">
        Your <span className="text-gradient">LaTeX copilot</span>
      </h2>
      <p className="mt-1.5 max-w-[280px] text-[12.5px] leading-relaxed text-fg-subtle">
        Ask questions, fix compile errors, rewrite passages, generate tables and figures. Edits are shown as diffs for you to review.
      </p>
      {!configured ? (
        <div className="mt-5 w-full max-w-[300px] rounded-xl border border-border bg-surface-2/60 p-4 text-left">
          <div className="flex items-center gap-2 text-[12.5px] font-medium">
            <KeyRound className="size-4 text-accent" /> Connect a model to get started
          </div>
          <p className="mt-1 text-[11.5px] leading-relaxed text-fg-subtle">
            Use your own API key (OpenAI, Anthropic, Gemini, OpenRouter…), a local model (Ollama, LM Studio){DEV ? ', or the dev mock' : ''}.
          </p>
          <Button className="mt-3 w-full" variant="primary" size="sm" onClick={openAiSettings}>
            Add a model provider
          </Button>
        </div>
      ) : (
        hasProject && (
          <div className="mt-5 flex w-full max-w-[320px] flex-col gap-1.5">
            {EXAMPLES.map((e) => (
              <button
                key={e}
                onClick={() => void sendMessage(e)}
                className="rounded-lg border border-border bg-surface px-3 py-2 text-left text-[12px] text-fg-muted shadow-xs transition-colors hover:border-accent/40 hover:text-fg"
              >
                {e}
              </button>
            ))}
          </div>
        )
      )}
    </div>
  );
}

export default function ChatPanel() {
  const activeId = useChat((s) => s.activeId);
  const thread = useChat((s) => (s.activeId ? s.threads[s.activeId] : null));
  const running = useChat((s) => !!(s.activeId && s.running[s.activeId]));
  const mode = useAiSettings((s) => s.mode);
  const providers = useAiSettings((s) => s.providers);
  const chatModel = useAiSettings((s) => s.chatModel);
  const secrets = useSecrets((s) => s.values);
  const configured = useMemo(() => isConfigured(), [providers, chatModel, secrets]);
  const hasProject = useWorkspace((s) => !!s.project);

  return (
    <div className="flex h-full min-w-0 flex-col bg-surface">
      <header className="flex h-10 shrink-0 items-center gap-1 border-b border-border pl-2 pr-1">
        <ThreadMenu />
        <div className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-fg" title={thread?.title}>
          {thread?.external && <Bot className="mr-1 inline size-3.5 text-fg-subtle" />}
          {thread?.title ?? 'AI assistant'}
          {running && <span className="ml-2 inline-block size-1.5 animate-pulse rounded-full bg-accent align-middle" />}
        </div>
        <Segmented
          size="sm"
          value={mode}
          onChange={(v) => useAiSettings.getState().set({ mode: v })}
          options={[
            { value: 'agent', label: 'Agent', title: 'Agent: can read, edit and compile the project' },
            { value: 'ask', label: 'Ask', title: 'Ask: read-only, never edits files' },
          ]}
        />
        <ModelPicker />
        <IconButton label="New chat" onClick={() => newThread()} disabled={!hasProject}>
          <MessageSquarePlus />
        </IconButton>
        <IconButton label="Close" shortcut="Mod-l" onClick={() => useLayout.getState().set({ aiOpen: false })}>
          <X />
        </IconButton>
      </header>
      {thread && thread.messages.length > 0 ? <MessageList key={activeId} thread={thread} /> : <Intro configured={configured} />}
      {thread?.external ? (
        <div className="shrink-0 border-t border-border px-3 py-2 text-[11.5px] text-fg-subtle">
          <Check className="mr-1 inline size-3" /> Activity from external agents connected to TexIt's MCP server.
        </div>
      ) : (
        <Composer threadId={thread?.id ?? null} disabled={!configured || !hasProject} />
      )}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Check, Copy, Download, Plug, Plus, RefreshCw, Server, Terminal, Trash2 } from 'lucide-react';
import { CLI_AGENT_PRESETS } from '@texit/ai';
import type { CliAgentInfo, McpClientConfigSnippet, McpServerInfo } from '@texit/core';
import { host } from '@/lib/platform';
import { Badge, Button, confirmDialog, IconButton, Input, openModal, Segmented, Spinner, Switch, Textarea, toast } from '@/ui';
import { Card, Row } from '@/features/settings/parts';
import { reconnectMcp, syncMcpServers, useMcpStatus } from '../runtime';
import { getSecretJson, secretKeys, setSecret } from '../secrets';
import { newId, useAiSettings, type McpEntry } from '../store';
import { ProviderLogo } from '../components/ProviderLogo';
import { StatusDot } from './ProviderCard';

// ─────────────────────────── MCP servers ───────────────────────────

function parsePairs(text: string, sep: ':' | '='): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const i = line.indexOf(sep);
    if (i <= 0) continue;
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return Object.keys(out).length ? out : undefined;
}

function formatPairs(rec: Record<string, string> | undefined, sep: string): string {
  return rec ? Object.entries(rec).map(([k, v]) => `${k}${sep}${v}`).join('\n') : '';
}

function splitArgs(s: string): string[] {
  return (s.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((a) => a.replace(/^["']|["']$/g, ''));
}

function McpForm({ initial, close }: { initial?: McpEntry; close: () => void }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [transport, setTransport] = useState<McpEntry['transport']>(initial?.transport ?? 'http');
  const [url, setUrl] = useState(initial?.url ?? '');
  const [headers, setHeaders] = useState(() => formatPairs(initial ? getSecretJson(secretKeys.mcpHeaders(initial.id)) : undefined, ': '));
  const [command, setCommand] = useState(initial?.command ?? '');
  const [args, setArgs] = useState(initial?.args?.join(' ') ?? '');
  const [env, setEnv] = useState(() => formatPairs(initial ? getSecretJson(secretKeys.mcpEnv(initial.id)) : undefined, '='));
  const valid = name.trim() && (transport === 'stdio' ? command.trim() : /^https?:\/\//.test(url.trim()));

  const save = async () => {
    const id = initial?.id ?? newId('mcp');
    const entry: McpEntry = {
      id,
      name: name.trim(),
      enabled: initial?.enabled ?? true,
      transport,
      url: transport === 'stdio' ? undefined : url.trim(),
      command: transport === 'stdio' ? command.trim() : undefined,
      args: transport === 'stdio' ? splitArgs(args) : undefined,
    };
    const h = parsePairs(headers, ':');
    const e = parsePairs(env, '=');
    await setSecret(secretKeys.mcpHeaders(id), h ? JSON.stringify(h) : null);
    await setSecret(secretKeys.mcpEnv(id), e ? JSON.stringify(e) : null);
    const s = useAiSettings.getState();
    if (initial) s.updateMcpServer(id, entry);
    else s.addMcpServer(entry);
    close();
    void syncMcpServers();
  };

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) void save();
      }}
    >
      <div className="space-y-1.5">
        <label className="text-[12px] font-medium">Name</label>
        <Input autoFocus value={name} placeholder="e.g. Zotero, GitHub, arXiv" onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <label className="text-[12px] font-medium">Transport</label>
        <div>
          <Segmented
            size="sm"
            value={transport}
            onChange={setTransport}
            options={[
              { value: 'http', label: 'Streamable HTTP' },
              { value: 'sse', label: 'SSE' },
              ...(host ? [{ value: 'stdio' as const, label: 'stdio (local command)' }] : []),
            ]}
          />
        </div>
      </div>
      {transport === 'stdio' ? (
        <>
          <div className="space-y-1.5">
            <label className="text-[12px] font-medium">Command</label>
            <Input value={command} placeholder="npx" onChange={(e) => setCommand(e.target.value)} className="font-mono" />
          </div>
          <div className="space-y-1.5">
            <label className="text-[12px] font-medium">Arguments</label>
            <Input value={args} placeholder="-y @modelcontextprotocol/server-filesystem ~/papers" onChange={(e) => setArgs(e.target.value)} className="font-mono" />
          </div>
          <div className="space-y-1.5">
            <label className="text-[12px] font-medium">Environment</label>
            <Textarea value={env} placeholder={'API_TOKEN=…'} onChange={(e) => setEnv(e.target.value)} className="min-h-16 font-mono text-[12px]" />
          </div>
        </>
      ) : (
        <>
          <div className="space-y-1.5">
            <label className="text-[12px] font-medium">URL</label>
            <Input value={url} placeholder="https://example.com/mcp" onChange={(e) => setUrl(e.target.value)} className="font-mono" />
            {!host && <p className="text-[11px] text-fg-subtle">The server must allow cross-origin requests from this site (CORS).</p>}
          </div>
          <div className="space-y-1.5">
            <label className="text-[12px] font-medium">Headers</label>
            <Textarea value={headers} placeholder={'Authorization: Bearer …'} onChange={(e) => setHeaders(e.target.value)} className="min-h-16 font-mono text-[12px]" />
          </div>
        </>
      )}
      <p className="text-[11px] text-fg-subtle">Headers and environment variables are stored with your API keys (never synced).</p>
      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" onClick={close}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={!valid}>
          {initial ? 'Save' : 'Add server'}
        </Button>
      </div>
    </form>
  );
}

export function editMcpServer(initial?: McpEntry) {
  void openModal({ title: initial ? `Edit ${initial.name}` : 'Add MCP server', width: 'max-w-lg', render: (close) => <McpForm initial={initial} close={close} /> });
}

export function McpSection() {
  const servers = useAiSettings((s) => s.mcpServers);
  const statuses = useMcpStatus((s) => s.statuses);
  useEffect(() => {
    void syncMcpServers();
  }, [servers]);
  return (
    <Card
      title="MCP servers"
      description="Tools from Model Context Protocol servers are offered to the agent as mcp__<server>__<tool>."
      action={
        <Button size="xs" variant="ghost" icon={<Plus />} onClick={() => editMcpServer()}>
          Add server
        </Button>
      }
    >
      {servers.length === 0 && (
        <div className="flex items-center gap-3 px-4 py-4 text-[12px] text-fg-subtle">
          <Plug className="size-4" /> No MCP servers yet. Connect search, reference managers, databases and more.
        </div>
      )}
      {servers.map((s) => {
        const st = statuses.find((x) => x.id === s.id);
        const tone = !s.enabled ? 'off' : st?.state === 'connected' ? 'ok' : st?.state === 'error' ? 'error' : st?.state === 'connecting' ? 'busy' : 'warn';
        return (
          <div key={s.id} className="flex items-center gap-3 px-4 py-2.5">
            <Server className="size-4 shrink-0 text-fg-subtle" />
            <button className="min-w-0 flex-1 text-left" onClick={() => editMcpServer(s)}>
              <div className="flex items-center gap-2 text-[13px] font-medium">
                {s.name}
                <Badge tone="neutral">{s.transport}</Badge>
              </div>
              <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-fg-subtle">
                <StatusDot tone={tone} />
                <span className="truncate" title={st?.error}>
                  {!s.enabled
                    ? 'Disabled'
                    : st?.state === 'connected'
                      ? `Connected · ${st.toolCount} tool${st.toolCount === 1 ? '' : 's'}`
                      : st?.state === 'error'
                        ? st.error
                        : st?.state === 'connecting'
                          ? 'Connecting…'
                          : (s.url ?? [s.command, ...(s.args ?? [])].join(' '))}
                </span>
              </div>
            </button>
            <IconButton label="Reconnect" onClick={() => void reconnectMcp(s.id)} disabled={!s.enabled}>
              <RefreshCw />
            </IconButton>
            <Switch size="sm" checked={s.enabled} onCheckedChange={(v) => useAiSettings.getState().updateMcpServer(s.id, { enabled: v })} />
            <IconButton
              label="Remove"
              onClick={async () => {
                if (!(await confirmDialog({ title: `Remove ${s.name}?`, confirmLabel: 'Remove', danger: true }))) return;
                await setSecret(secretKeys.mcpHeaders(s.id), null);
                await setSecret(secretKeys.mcpEnv(s.id), null);
                useAiSettings.getState().removeMcpServer(s.id);
              }}
            >
              <Trash2 />
            </IconButton>
          </div>
        );
      })}
    </Card>
  );
}

// ─────────────────────────── Expose TexIt as MCP server ───────────────────────────

export function buildSnippets(info: McpServerInfo): McpClientConfigSnippet[] {
  const url = info.url ?? 'http://127.0.0.1:4317/mcp';
  const token = info.token ?? '<token>';
  return [
    {
      id: 'claude-code',
      label: 'Claude Code',
      language: 'shell',
      target: 'terminal',
      snippet: `claude mcp add --transport http texit ${url} --header "Authorization: Bearer ${token}"`,
    },
    {
      id: 'codex',
      label: 'Codex CLI',
      language: 'toml',
      target: '~/.codex/config.toml',
      snippet: `[mcp_servers.texit]\nurl = "${url}"\nhttp_headers = { Authorization = "Bearer ${token}" }`,
    },
    {
      id: 'cursor',
      label: 'Cursor',
      language: 'json',
      target: '~/.cursor/mcp.json',
      snippet: JSON.stringify({ mcpServers: { texit: { url, headers: { Authorization: `Bearer ${token}` } } } }, null, 2),
    },
  ];
}

function Snippet({ s }: { s: McpClientConfigSnippet }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface-2">
      <div className="flex h-7 items-center justify-between border-b border-border pl-2.5 pr-1 text-[11px]">
        <span className="font-medium text-fg-muted">
          {s.label} <span className="font-normal text-fg-subtle">· {s.target}</span>
        </span>
        <IconButton
          size="xs"
          label="Copy"
          onClick={() =>
            void navigator.clipboard.writeText(s.snippet).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            })
          }
        >
          {copied ? <Check className="text-success" /> : <Copy />}
        </IconButton>
      </div>
      <pre className="overflow-x-auto px-2.5 py-2 font-mono text-[11px] leading-relaxed">{s.snippet}</pre>
    </div>
  );
}

export function ExposeSection() {
  const expose = useAiSettings((s) => s.exposeMcpServer);
  const autoApply = useAiSettings((s) => s.autoApplyEdits);
  const [info, setInfo] = useState<McpServerInfo | null>(null);
  const [snippets, setSnippets] = useState<McpClientConfigSnippet[]>([]);
  const [showToken, setShowToken] = useState(false);

  useEffect(() => {
    if (!host || !expose) {
      setInfo(null);
      return;
    }
    let alive = true;
    const poll = async () => {
      try {
        const i = await host!.mcp.serverInfo();
        if (!alive) return;
        setInfo(i);
        if (i.running) setSnippets((await host!.mcp.clientConfigSnippets?.()) ?? buildSnippets(i));
      } catch {
        /* ignore */
      }
    };
    void poll();
    const t = setInterval(poll, 2500);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [expose]);

  if (!host) {
    return (
      <Card title="TexIt as an MCP server" description="Let external agents (Claude Code, Codex, Cursor…) read, edit and compile the open project.">
        <Row title="Available in the desktop app" description="The browser cannot host a local server." />
      </Card>
    );
  }
  return (
    <Card title="TexIt as an MCP server" description="External agents connect over Streamable HTTP on localhost with a bearer token. Their edits follow your auto-apply setting.">
      <Row
        title="Expose the open project"
        description={autoApply ? 'Edits from external agents are applied immediately.' : 'Edits from external agents appear in the AI panel for review.'}
      >
        <Switch checked={expose} onCheckedChange={(v) => useAiSettings.getState().set({ exposeMcpServer: v })} />
      </Row>
      {expose && (
        <div className="space-y-2.5 px-4 py-3.5">
          {!info?.running ? (
            <div className="flex items-center gap-2 text-[12px] text-fg-subtle">
              <Spinner className="size-3.5" /> Starting server… (open a project)
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
                <span className="flex items-center gap-1.5">
                  <StatusDot tone="ok" /> Running
                </span>
                <span className="font-mono text-fg-muted">{info.url}</span>
                {info.token && (
                  <button className="font-mono text-[11.5px] text-fg-subtle hover:text-fg" onClick={() => setShowToken(!showToken)}>
                    token: {showToken ? info.token : '••••••••'}
                  </button>
                )}
              </div>
              {snippets.map((s) => (
                <Snippet key={s.id} s={s} />
              ))}
            </>
          )}
        </div>
      )}
    </Card>
  );
}

// ─────────────────────────── CLI agents ───────────────────────────

export function CliSection() {
  const [agents, setAgents] = useState<CliAgentInfo[] | null>(null);
  const providers = useAiSettings((s) => s.providers);
  const detect = async () => {
    setAgents(null);
    try {
      setAgents((await host?.agents.detect()) ?? []);
    } catch (e) {
      toast.error('Could not detect CLI agents', { description: (e as Error).message });
      setAgents([]);
    }
  };
  useEffect(() => {
    if (host) void detect();
  }, []);
  if (!host) {
    return (
      <Card title="Use your subscription (CLI agents)" description="Codex CLI (ChatGPT), Claude Code (Claude) and Gemini CLI run locally through the desktop app.">
        <Row title="Available in the desktop app" description="Download TexIt for macOS, Windows or Linux to use your existing subscription instead of an API key." />
      </Card>
    );
  }
  return (
    <Card
      title="Use your subscription (CLI agents)"
      description="The project is mirrored to a local folder; the agent edits it there and changes sync back into TexIt."
      action={
        <Button size="xs" variant="ghost" icon={<RefreshCw />} onClick={() => void detect()}>
          Detect
        </Button>
      }
    >
      {!agents && (
        <div className="flex items-center gap-2 px-4 py-4 text-[12px] text-fg-subtle">
          <Spinner className="size-3.5" /> Looking for installed agents…
        </div>
      )}
      {agents &&
        CLI_AGENT_PRESETS.map((preset) => {
          const a = agents.find((x) => x.id === preset.id);
          const added = providers.find((p) => p.kind === 'cli' && p.cliAgent === preset.id);
          return (
            <div key={preset.id} className="flex items-center gap-3 px-4 py-2.5">
              <ProviderLogo kind="cli" cliAgent={preset.id} size={28} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[13px] font-medium">
                  {preset.label}
                  {a?.installed ? <Badge tone="success">{a.version ?? 'installed'}</Badge> : <Badge tone="neutral">not found</Badge>}
                </div>
                <div className="mt-0.5 truncate text-[11.5px] text-fg-subtle" title={a?.installed ? a.path : (a?.hint ?? preset.installHint)}>
                  {a?.installed ? preset.description : (a?.hint ?? preset.installHint)}
                </div>
              </div>
              {added ? (
                <Badge tone="accent">
                  <Check /> Added
                </Badge>
              ) : (
                <Button
                  size="sm"
                  variant={a?.installed ? 'primary' : 'secondary'}
                  icon={a?.installed ? <Terminal /> : <Download />}
                  disabled={!a?.installed}
                  onClick={() =>
                    useAiSettings.getState().addProvider({
                      id: newId('cli'),
                      kind: 'cli',
                      name: preset.label,
                      enabled: true,
                      cliAgent: preset.id,
                      models: ['default', ...preset.suggestedModels.map((m) => m.id)],
                      defaultModel: 'default',
                    })
                  }
                >
                  Use
                </Button>
              )}
            </div>
          );
        })}
    </Card>
  );
}


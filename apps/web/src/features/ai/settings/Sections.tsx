import { useEffect, useState } from 'react';
import { Check, Copy, Download, Plug, Plus, RefreshCw, Server, Terminal, Trash2 } from 'lucide-react';
import { CLI_AGENT_PRESETS } from '@texit/ai';
import type { CliAgentInfo, McpClientConfigSnippet, McpServerInfo } from '@texit/core';
import { host } from '@/lib/platform';
import { t as tr, useT } from '@/lib/i18n';
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
  const t = useT();
  const [name, setName] = useState(initial?.name ?? '');
  const [transport, setTransport] = useState<McpEntry['transport']>(initial?.transport ?? 'http');
  const [url, setUrl] = useState(initial?.url ?? '');
  const [headers, setHeaders] = useState(() => formatPairs(initial ? getSecretJson(secretKeys.mcpHeaders(initial.id)) : undefined, ': '));
  const [command, setCommand] = useState(initial?.command ?? '');
  const [args, setArgs] = useState(initial?.args?.join(' ') ?? '');
  const [env, setEnv] = useState(() => formatPairs(initial ? getSecretJson(secretKeys.mcpEnv(initial.id)) : undefined, '='));
  const urlOk = /^https?:\/\//.test(url.trim());
  const valid = name.trim() && (transport === 'stdio' ? command.trim() : urlOk);

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
        <label className="text-[12px] font-medium">{t('ai.mcp.name')}</label>
        <Input autoFocus value={name} placeholder={t('ai.mcp.namePlaceholder')} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <label className="text-[12px] font-medium">{t('ai.mcp.transport')}</label>
        <div>
          <Segmented
            size="sm"
            value={transport}
            onChange={setTransport}
            options={[
              { value: 'http', label: 'Streamable HTTP' },
              { value: 'sse', label: 'SSE' },
              ...(host ? [{ value: 'stdio' as const, label: t('ai.mcp.stdio') }] : []),
            ]}
          />
        </div>
      </div>
      {transport === 'stdio' ? (
        <>
          <div className="space-y-1.5">
            <label className="text-[12px] font-medium">{t('ai.mcp.command')}</label>
            <Input value={command} placeholder="npx" onChange={(e) => setCommand(e.target.value)} className="font-mono" />
          </div>
          <div className="space-y-1.5">
            <label className="text-[12px] font-medium">{t('ai.mcp.arguments')}</label>
            <Input value={args} placeholder="-y @modelcontextprotocol/server-filesystem ~/papers" onChange={(e) => setArgs(e.target.value)} className="font-mono" />
          </div>
          <div className="space-y-1.5">
            <label className="text-[12px] font-medium">{t('ai.mcp.environment')}</label>
            <Textarea value={env} placeholder={'API_TOKEN=…'} onChange={(e) => setEnv(e.target.value)} className="min-h-16 font-mono text-[12px]" />
          </div>
        </>
      ) : (
        <>
          <div className="space-y-1.5">
            <label className="text-[12px] font-medium">{t('ai.mcp.url')}</label>
            <Input value={url} placeholder="https://example.com/mcp" onChange={(e) => setUrl(e.target.value)} className="font-mono" />
            {url.trim() && !urlOk && <p className="text-[11px] text-danger">{t('ai.mcp.invalidUrl')}</p>}
            {!host && <p className="text-[11px] text-fg-subtle">{t('ai.mcp.cors')}</p>}
          </div>
          <div className="space-y-1.5">
            <label className="text-[12px] font-medium">{t('ai.mcp.headers')}</label>
            <Textarea value={headers} placeholder={'Authorization: Bearer …'} onChange={(e) => setHeaders(e.target.value)} className="min-h-16 font-mono text-[12px]" />
          </div>
        </>
      )}
      <p className="text-[11px] text-fg-subtle">{t('ai.mcp.secretsNote')}</p>
      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" onClick={close}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" variant="primary" disabled={!valid}>
          {initial ? t('common.save') : t('ai.mcp.addServer')}
        </Button>
      </div>
    </form>
  );
}

export function editMcpServer(initial?: McpEntry) {
  void openModal({ title: initial ? tr('ai.mcp.editTitle', { name: initial.name }) : tr('ai.mcp.addTitle'), width: 'max-w-lg', render: (close) => <McpForm initial={initial} close={close} /> });
}

export function McpSection() {
  const t = useT();
  const servers = useAiSettings((s) => s.mcpServers);
  const statuses = useMcpStatus((s) => s.statuses);
  useEffect(() => {
    void syncMcpServers();
  }, [servers]);
  return (
    <Card
      title={t('ai.mcp.title')}
      description={t('ai.mcp.desc')}
      action={
        <Button size="xs" variant="ghost" icon={<Plus />} onClick={() => editMcpServer()}>
          {t('ai.mcp.addServer')}
        </Button>
      }
    >
      {servers.length === 0 && (
        <div className="flex items-center gap-3 px-4 py-4 text-[12px] text-fg-subtle">
          <Plug className="size-4" /> {t('ai.mcp.empty')}
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
                    ? t('common.disabled')
                    : st?.state === 'connected'
                      ? t('ai.mcp.connected', { count: st.toolCount })
                      : st?.state === 'error'
                        ? st.error
                        : st?.state === 'connecting'
                          ? t('ai.mcp.connecting')
                          : (s.url ?? [s.command, ...(s.args ?? [])].join(' '))}
                </span>
              </div>
            </button>
            <IconButton label={t('ai.mcp.reconnect')} onClick={() => void reconnectMcp(s.id)} disabled={!s.enabled}>
              <RefreshCw />
            </IconButton>
            <Switch size="sm" checked={s.enabled} onCheckedChange={(v) => useAiSettings.getState().updateMcpServer(s.id, { enabled: v })} />
            <IconButton
              label={t('common.remove')}
              onClick={async () => {
                if (!(await confirmDialog({ title: t('ai.mcp.removeTitle', { name: s.name }), confirmLabel: t('common.remove'), danger: true }))) return;
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
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface-2">
      <div className="flex h-7 items-center justify-between border-b border-border pl-2.5 pr-1 text-[11px]">
        <span className="font-medium text-fg-muted">
          {s.label} <span className="font-normal text-fg-subtle">· {s.target}</span>
        </span>
        <IconButton
          size="xs"
          label={copied ? t('common.copied') : t('common.copy')}
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
  const t = useT();
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
    const timer = setInterval(poll, 2500);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [expose]);

  if (!host) {
    return (
      <Card title={t('ai.expose.title')} description={t('ai.expose.descWeb')}>
        <Row title={t('ai.expose.desktopOnly')} description={t('ai.expose.noLocalServer')} />
      </Card>
    );
  }
  return (
    <Card title={t('ai.expose.title')} description={t('ai.expose.desc')}>
      <Row
        title={t('ai.expose.toggle')}
        description={autoApply ? t('ai.expose.autoApplied') : t('ai.expose.reviewed')}
      >
        <Switch checked={expose} onCheckedChange={(v) => useAiSettings.getState().set({ exposeMcpServer: v })} />
      </Row>
      {expose && (
        <div className="space-y-2.5 px-4 py-3.5">
          {!info?.running ? (
            <div className="flex items-center gap-2 text-[12px] text-fg-subtle">
              <Spinner className="size-3.5" /> {t('ai.expose.starting')}
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
                <span className="flex items-center gap-1.5">
                  <StatusDot tone="ok" /> {t('ai.expose.running')}
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
  const t = useT();
  const [agents, setAgents] = useState<CliAgentInfo[] | null>(null);
  const providers = useAiSettings((s) => s.providers);
  const detect = async () => {
    setAgents(null);
    try {
      setAgents((await host?.agents.detect()) ?? []);
    } catch (e) {
      toast.error(tr('ai.cli.detectFailed'), { description: (e as Error).message });
      setAgents([]);
    }
  };
  useEffect(() => {
    if (host) void detect();
  }, []);
  if (!host) {
    return (
      <Card title={t('ai.cli.title')} description={t('ai.cli.descWeb')}>
        <Row title={t('ai.expose.desktopOnly')} description={t('ai.cli.downloadDesktop')} />
      </Card>
    );
  }
  return (
    <Card
      title={t('ai.cli.title')}
      description={t('ai.cli.desc')}
      action={
        <Button size="xs" variant="ghost" icon={<RefreshCw />} onClick={() => void detect()}>
          {t('ai.cli.detect')}
        </Button>
      }
    >
      {!agents && (
        <div className="flex items-center gap-2 px-4 py-4 text-[12px] text-fg-subtle">
          <Spinner className="size-3.5" /> {t('ai.cli.looking')}
        </div>
      )}
      {agents &&
        CLI_AGENT_PRESETS.map((preset) => {
          const a = agents.find((x) => x.id === preset.id);
          const added = providers.find((p) => p.kind === 'cli' && p.cliAgent === preset.id);
          const installHint = a?.hint ?? t(`ai.cli.${preset.id}.installHint`, undefined, preset.installHint);
          const description = t(`ai.cli.${preset.id}.description`, undefined, preset.description);
          return (
            <div key={preset.id} className="flex items-center gap-3 px-4 py-2.5">
              <ProviderLogo kind="cli" cliAgent={preset.id} size={28} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[13px] font-medium">
                  {preset.label}
                  {a?.installed ? <Badge tone="success">{a.version ?? t('ai.cli.installed')}</Badge> : <Badge tone="neutral">{t('ai.cli.notFound')}</Badge>}
                </div>
                <div className="mt-0.5 truncate text-[11.5px] text-fg-subtle" title={a?.installed ? a.path : installHint}>
                  {a?.installed ? description : installHint}
                </div>
              </div>
              {added ? (
                <Badge tone="accent">
                  <Check /> {t('ai.cli.added')}
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
                  {t('ai.cli.use')}
                </Button>
              )}
            </div>
          );
        })}
    </Card>
  );
}


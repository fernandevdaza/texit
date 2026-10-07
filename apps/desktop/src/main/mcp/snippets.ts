/**
 * Ready-to-paste client configurations for TexIt's MCP server (unit tested).
 */

export interface McpClientSnippet {
  id: 'claude-code' | 'codex' | 'cursor' | 'vscode' | 'gemini' | string;
  label: string;
  language: 'shell' | 'toml' | 'json';
  /** Where the snippet goes (file path or "terminal"). */
  target: string;
  snippet: string;
}

export function clientConfigSnippets(opts: { url: string; token: string; name?: string }): McpClientSnippet[] {
  const name = opts.name ?? 'texit';
  const auth = `Bearer ${opts.token}`;
  const json = (v: unknown) => JSON.stringify(v, null, 2);
  return [
    {
      id: 'claude-code',
      label: 'Claude Code',
      language: 'shell',
      target: 'terminal',
      snippet: `claude mcp add --transport http ${name} ${opts.url} --header "Authorization: ${auth}"`,
    },
    {
      id: 'codex',
      label: 'Codex CLI',
      language: 'toml',
      target: '~/.codex/config.toml',
      snippet: [`[mcp_servers.${name}]`, `url = "${opts.url}"`, `http_headers = { "Authorization" = "${auth}" }`, ''].join('\n'),
    },
    {
      id: 'cursor',
      label: 'Cursor',
      language: 'json',
      target: '~/.cursor/mcp.json',
      snippet: json({ mcpServers: { [name]: { url: opts.url, headers: { Authorization: auth } } } }),
    },
    {
      id: 'vscode',
      label: 'VS Code',
      language: 'json',
      target: '.vscode/mcp.json',
      snippet: json({ servers: { [name]: { type: 'http', url: opts.url, headers: { Authorization: auth } } } }),
    },
    {
      id: 'gemini',
      label: 'Gemini CLI',
      language: 'json',
      target: '~/.gemini/settings.json',
      snippet: json({ mcpServers: { [name]: { httpUrl: opts.url, headers: { Authorization: auth } } } }),
    },
  ];
}

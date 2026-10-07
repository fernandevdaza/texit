/**
 * @texit/ai — TexIt's AI layer (browser-safe entry).
 *
 *  - providers:   provider catalog, `createLanguageModel`, `listModels`, `testConnection`
 *  - agent:       `runAgent` (multi-step tool loop → AgentEvents), `toModelMessages`
 *  - prompt:      `buildSystemPrompt`, `buildProjectContext`
 *  - tools:       `createProjectTools` (AI SDK), `createProjectToolDefs` (MCP), `pluginToolsToAiTools`
 *  - cli:         `runCliAgent`, `buildCliPrompt` (desktop subscription CLIs)
 *  - mcp:         `McpManager` (MCP client), `HostMcpStdioTransport`
 *  - mcp-server:  `serveProjectTools` (expose the project as an MCP server, desktop)
 *  - inline:      `inlineComplete`, `rewriteSelection`, `quickActions`
 */
export * from './types';
export * from './providers';
export * from './agent';
export * from './prompt';
export * from './tools';
export * from './cli';
export * from './mcp';
export * from './mcp-server';
export * from './inline';
export * from './memory-context';

import type { PluginPermission } from '@texit/plugin-api';

export const PERMISSION_INFO: Record<PluginPermission, { title: string; description: string; icon: string; enforced: boolean }> = {
  'project:read': { title: 'Read project files', description: 'List and read every file of the open project.', icon: 'file-search', enforced: true },
  'project:write': { title: 'Modify project files', description: 'Create, change and delete files in the open project.', icon: 'file-pen', enforced: true },
  editor: { title: 'Use the editor', description: 'Read the selection and insert or replace text at the cursor.', icon: 'text-cursor-input', enforced: true },
  ui: { title: 'Add interface elements', description: 'Show panels, status-bar items and dialogs.', icon: 'layout-panel-left', enforced: false },
  compiler: { title: 'Use the compiler', description: 'Trigger compiles, read results and add compile backends or hooks.', icon: 'hammer', enforced: true },
  ai: { title: 'Use AI', description: 'Send prompts to your configured AI model (may incur cost) and add tools for the assistant.', icon: 'sparkles', enforced: true },
  network: { title: 'Access the network', description: 'Contact external services (e.g. to look up references).', icon: 'globe', enforced: false },
  storage: { title: 'Store data', description: 'Keep its own data in this browser.', icon: 'database', enforced: false },
};

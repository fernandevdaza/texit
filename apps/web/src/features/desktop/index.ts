/**
 * Web-side integration of desktop-only services (window.texit).
 */
export { FolderSync, threeWayMerge, type FolderSyncConflict, type FolderSyncOptions, type FolderSyncStatus, type InitialSyncMode } from './folder-sync';
export { McpServerBridge, type McpServerBridgeOptions, type McpToolDef } from './mcp-bridge';
export { hashBytes, hashContent, hashString } from './hash';
export { useDesktopHost, useFolderSync, useMcpServerBridge, useMenuCommand, useOpenPath } from './hooks';
export { activate } from './activate';

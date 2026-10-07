import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from 'react';
import {
  ChevronRight,
  ChevronsDownUp,
  Copy,
  CopyPlus,
  Download,
  FilePlus,
  FolderPlus,
  Pencil,
  Search,
  Star,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { basename, exportZip, isTexPath, joinPath, ROOT_ID, uniquePath, type FileNode } from '@texit/core';
import { useWorkspace } from '@/state/workspace';
import { cn } from '@/lib/cn';
import { downloadBlob } from '@/lib/format';
import { confirmDialog, ContextMenu, EmptyState, IconButton, PanelHeader, toast, type MenuEntry } from '@/ui';
import { usePeersByFile } from '@/features/editor/presence';
import { PresenceDots } from '@/features/editor/TabBar';
import { FileIcon } from './FileIcon';
import { ancestors, childrenMap, isInside, validateName, visibleRows, type Row } from './tree';
import { collectDropped, importIntoProject } from './importFiles';
import { filesActionRequested, filesPanelMounted, type FilesAction } from './api';

type Editing = { mode: 'create'; parentId: string; kind: 'file' | 'folder' } | { mode: 'rename'; id: string } | null;

const DRAG_TYPE = 'application/x-texit-nodes';

function loadExpanded(projectId: string | undefined): Set<string> {
  if (!projectId) return new Set();
  try {
    const raw = localStorage.getItem(`texit:files:expanded:${projectId}`);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

export function FilesPanel() {
  const project = useWorkspace((s) => s.project);
  const projectId = useWorkspace((s) => s.meta?.id ?? s.session?.id);
  const files = useWorkspace((s) => s.files);
  const activeId = useWorkspace((s) => s.activeFileId);
  const mainId = useWorkspace((s) => {
    try {
      return s.project?.getMainFileId() ?? null;
    } catch {
      return null;
    }
  });
  const peers = usePeersByFile();

  const [expanded, setExpanded] = useState<Set<string>>(() => loadExpanded(projectId));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [focusId, setFocusId] = useState<string | null>(null);
  const [anchorId, setAnchorId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [filter, setFilter] = useState('');
  const [showFilter, setShowFilter] = useState(false);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const uploadTarget = useRef<string>(ROOT_ID);
  const expandTimer = useRef<{ id: string; t: ReturnType<typeof setTimeout> } | null>(null);

  useEffect(() => setExpanded(loadExpanded(projectId)), [projectId]);
  useEffect(() => {
    if (!projectId) return;
    try {
      localStorage.setItem(`texit:files:expanded:${projectId}`, JSON.stringify([...expanded]));
    } catch {
      /* ignore */
    }
  }, [expanded, projectId]);

  const byId = useMemo(() => new Map(files.map((f) => [f.id, f])), [files]);
  const kids = useMemo(() => childrenMap(files), [files]);
  const rows = useMemo(() => visibleRows(files, expanded, filter), [files, expanded, filter]);

  // Drop stale selection.
  useEffect(() => {
    setSelected((s) => {
      const next = new Set([...s].filter((id) => byId.has(id)));
      return next.size === s.size ? s : next;
    });
  }, [byId]);

  const expand = useCallback((ids: string[]) => {
    setExpanded((prev) => {
      if (ids.every((id) => prev.has(id))) return prev;
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      return next;
    });
  }, []);

  const scrollTo = (id: string) =>
    requestAnimationFrame(() => treeRef.current?.querySelector<HTMLElement>(`[data-node-id="${id}"]`)?.scrollIntoView({ block: 'nearest' }));

  const reveal = useCallback(
    (id: string, focus = true) => {
      expand(ancestors(useWorkspace.getState().files, id));
      setSelected(new Set([id]));
      setFocusId(id);
      setAnchorId(id);
      scrollTo(id);
      if (focus) requestAnimationFrame(() => treeRef.current?.focus());
    },
    [expand],
  );

  // Follow the active editor tab.
  useEffect(() => {
    if (!activeId || !byId.has(activeId)) return;
    expand(ancestors(files, activeId));
    setFocusId(activeId);
    setSelected((s) => (s.size === 1 && s.has(activeId) ? s : new Set([activeId])));
    scrollTo(activeId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  // ───────────── targets ─────────────

  /** Folder that "new"/upload actions apply to, based on the focused node. */
  const contextFolder = (id: string | null): string => {
    if (!id) return ROOT_ID;
    const n = byId.get(id);
    if (!n) return ROOT_ID;
    return n.kind === 'folder' ? n.id : n.parentId;
  };
  const folderPath = (folderId: string) => (folderId === ROOT_ID ? '' : (byId.get(folderId)?.path ?? ''));

  // ───────────── actions ─────────────

  const startCreate = (kind: 'file' | 'folder', parentId = contextFolder(focusId)) => {
    if (parentId !== ROOT_ID) expand([parentId]);
    setFilter('');
    setEditing({ mode: 'create', parentId, kind });
  };

  const startRename = (id: string | null = focusId) => {
    if (!id || !byId.has(id)) return;
    setEditing({ mode: 'rename', id });
  };

  const commitEdit = (value: string) => {
    const ed = editing;
    setEditing(null);
    if (!ed || !project) return;
    const name = value.trim();
    if (!name) return;
    try {
      if (ed.mode === 'create') {
        const siblings = kids.get(ed.parentId) ?? [];
        const err = validateName(name, siblings);
        if (err) {
          toast.error(err);
          return;
        }
        const path = joinPath(folderPath(ed.parentId), name);
        if (ed.kind === 'folder') {
          const id = project.createFolder(path);
          expand([id]);
          reveal(id);
        } else {
          const id = project.createFile(path, '');
          useWorkspace.getState().refreshTree();
          useWorkspace.getState().openFile(id);
          reveal(id, false);
        }
      } else {
        const node = byId.get(ed.id);
        if (!node || node.name === name) return;
        const err = validateName(name, kids.get(node.parentId) ?? [], node.id);
        if (err) {
          toast.error(err);
          return;
        }
        if (name.includes('/')) {
          toast.error('Use drag & drop to move files between folders');
          return;
        }
        project.rename(ed.id, name);
        requestAnimationFrame(() => treeRef.current?.focus());
      }
    } catch (err) {
      toast.error('Something went wrong', { description: String((err as Error)?.message ?? err) });
    }
  };

  /** Selected ids without descendants of other selected folders. */
  const topLevel = (ids: Iterable<string>) => {
    const set = new Set(ids);
    return [...set].filter((id) => !ancestors(files, id).some((a) => set.has(a)));
  };

  const deleteNodes = async (ids: string[]) => {
    if (!project || !ids.length) return;
    const nodes = topLevel(ids)
      .map((id) => byId.get(id))
      .filter((n): n is FileNode => !!n);
    const folderCount = nodes.filter((n) => n.kind === 'folder').length;
    const ok = await confirmDialog({
      title: nodes.length === 1 ? `Delete “${nodes[0].name}”?` : `Delete ${nodes.length} items?`,
      message:
        (folderCount ? 'Folders are deleted with everything inside them. ' : '') +
        'You can restore deleted files from History if snapshots were taken.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    project.doc.transact(() => nodes.forEach((n) => project.delete(n.id)));
    setSelected(new Set());
    toast.success(nodes.length === 1 ? `Deleted ${nodes[0].name}` : `Deleted ${nodes.length} items`);
  };

  const duplicate = (id: string) => {
    if (!project) return;
    const newId = project.duplicate(id);
    if (newId) {
      useWorkspace.getState().refreshTree();
      reveal(newId);
      setEditing({ mode: 'rename', id: newId });
    }
  };

  const download = (node: FileNode) => {
    if (!project) return;
    if (node.kind === 'file') {
      downloadBlob(project.readFile(node.id), node.name);
      return;
    }
    try {
      const prefix = `${node.path}/`;
      const filesIn = project
        .snapshot()
        .filter((f) => f.path.startsWith(prefix))
        .map((f) => ({ ...f, path: f.path.slice(prefix.length) }));
      downloadBlob(exportZip(filesIn), `${node.name}.zip`, 'application/zip');
    } catch (err) {
      toast.error('Could not create the archive', { description: String((err as Error)?.message ?? err) });
    }
  };

  const copyPath = (node: FileNode) => {
    void navigator.clipboard?.writeText(node.path);
    toast.success('Path copied', { description: node.path });
  };

  const setMain = (node: FileNode) => {
    project?.setMeta({ mainFileId: node.id });
    toast.success(`${node.name} is now the main file`);
  };

  const moveNodes = (ids: string[], targetFolder: string) => {
    if (!project) return;
    const nodes = topLevel(ids)
      .map((id) => byId.get(id))
      .filter((n): n is FileNode => !!n && n.parentId !== targetFolder && !(n.kind === 'folder' && isInside(files, targetFolder, n.id)));
    if (!nodes.length) return;
    const targetPath = folderPath(targetFolder);
    try {
      project.doc.transact(() => {
        for (const n of nodes) {
          const dest = joinPath(targetPath, n.name);
          if (project.existsPath(dest)) project.rename(n.id, basename(uniquePath(dest, (p) => project.existsPath(p))));
          project.move(n.id, targetFolder);
        }
      });
      if (targetFolder !== ROOT_ID) expand([targetFolder]);
      toast.success(nodes.length === 1 ? `Moved ${nodes[0].name}` : `Moved ${nodes.length} items`, { description: `to ${targetPath || 'project root'}` });
    } catch (err) {
      toast.error('Could not move', { description: String((err as Error)?.message ?? err) });
    }
  };

  const upload = (folderId = contextFolder(focusId)) => {
    uploadTarget.current = folderId;
    uploadRef.current?.click();
  };

  // External requests (commands, tabs, breadcrumbs).
  const handleAction = useRef<(a: FilesAction) => void>(() => {});
  handleAction.current = (a) => {
    if (a.type === 'reveal') reveal(a.id);
    else if (a.type === 'newFile') startCreate('file');
    else if (a.type === 'newFolder') startCreate('folder');
    else if (a.type === 'upload') upload();
    else if (a.type === 'rename') startRename(a.id ?? focusId ?? activeId);
  };
  useEffect(() => {
    const { pending, unmount } = filesPanelMounted();
    if (pending) setTimeout(() => handleAction.current(pending), 0);
    const d = filesActionRequested.on((a) => handleAction.current(a));
    return () => {
      d.dispose();
      unmount();
    };
  }, []);

  // ───────────── selection & keyboard ─────────────

  const openNode = (node: FileNode, preview: boolean) => {
    if (node.kind === 'folder') return;
    useWorkspace.getState().openFile(node.id, { preview });
  };

  const onRowClick = (e: MouseEvent, node: FileNode) => {
    const mod = e.metaKey || e.ctrlKey;
    if (e.shiftKey && anchorId) {
      const ids = rows.map((r) => r.node.id);
      const a = ids.indexOf(anchorId);
      const b = ids.indexOf(node.id);
      if (a >= 0 && b >= 0) setSelected(new Set(ids.slice(Math.min(a, b), Math.max(a, b) + 1)));
      setFocusId(node.id);
      return;
    }
    if (mod) {
      setSelected((s) => {
        const next = new Set(s);
        if (next.has(node.id)) next.delete(node.id);
        else next.add(node.id);
        return next;
      });
      setFocusId(node.id);
      setAnchorId(node.id);
      return;
    }
    setSelected(new Set([node.id]));
    setFocusId(node.id);
    setAnchorId(node.id);
    if (node.kind === 'folder') toggle(node.id);
    else openNode(node, true);
  };

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const onKeyDown = (e: KeyboardEvent) => {
    if (editing) return;
    const ids = rows.map((r) => r.node.id);
    const idx = focusId ? ids.indexOf(focusId) : -1;
    const node = focusId ? byId.get(focusId) : undefined;
    const move = (to: number, extend = false) => {
      const id = ids[Math.max(0, Math.min(ids.length - 1, to))];
      if (!id) return;
      setFocusId(id);
      if (extend && anchorId) {
        const a = ids.indexOf(anchorId);
        const b = ids.indexOf(id);
        setSelected(new Set(ids.slice(Math.min(a, b), Math.max(a, b) + 1)));
      } else {
        setSelected(new Set([id]));
        setAnchorId(id);
      }
      scrollTo(id);
    };
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        move(idx + 1, e.shiftKey);
        break;
      case 'ArrowUp':
        e.preventDefault();
        move(idx < 0 ? ids.length - 1 : idx - 1, e.shiftKey);
        break;
      case 'Home':
        e.preventDefault();
        move(0);
        break;
      case 'End':
        e.preventDefault();
        move(ids.length - 1);
        break;
      case 'ArrowRight':
        e.preventDefault();
        if (node?.kind === 'folder') {
          if (!expanded.has(node.id) && !filter) toggle(node.id);
          else move(idx + 1);
        }
        break;
      case 'ArrowLeft':
        e.preventDefault();
        if (node?.kind === 'folder' && expanded.has(node.id) && !filter) toggle(node.id);
        else if (node && node.parentId !== ROOT_ID) move(ids.indexOf(node.parentId));
        break;
      case 'Enter':
        e.preventDefault();
        if (node?.kind === 'folder') toggle(node.id);
        else if (node) openNode(node, false);
        break;
      case ' ':
        e.preventDefault();
        if (node && node.kind === 'file') openNode(node, true);
        break;
      case 'F2':
        e.preventDefault();
        startRename();
        break;
      case 'Delete':
      case 'Backspace':
        if (e.key === 'Backspace' && !(e.metaKey || e.ctrlKey)) break;
        e.preventDefault();
        void deleteNodes(selected.size ? [...selected] : focusId ? [focusId] : []);
        break;
      case 'Escape':
        if (filter) setFilter('');
        else setSelected(new Set());
        break;
      case 'a':
        if (e.metaKey || e.ctrlKey) {
          e.preventDefault();
          setSelected(new Set(ids));
        }
        break;
      default:
        // Type-ahead: jump to the next row starting with the typed letter.
        if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey && /\S/.test(e.key)) {
          const ch = e.key.toLowerCase();
          for (let i = 1; i <= ids.length; i++) {
            const id = ids[(idx + i) % ids.length];
            if (byId.get(id)?.name.toLowerCase().startsWith(ch)) {
              move((idx + i) % ids.length);
              break;
            }
          }
        }
    }
  };

  // ───────────── drag & drop ─────────────

  const dropFolderFor = (node: FileNode | null): string => (!node ? ROOT_ID : node.kind === 'folder' ? node.id : node.parentId);

  const onDragStartRow = (e: DragEvent, node: FileNode) => {
    const ids = selected.has(node.id) ? [...selected] : [node.id];
    if (!selected.has(node.id)) setSelected(new Set([node.id]));
    e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(ids));
    e.dataTransfer.setData('text/plain', ids.map((id) => byId.get(id)?.path).join('\n'));
    e.dataTransfer.effectAllowed = 'move';
  };

  const onDragOver = (e: DragEvent, node: FileNode | null) => {
    const internal = e.dataTransfer.types.includes(DRAG_TYPE);
    const external = e.dataTransfer.types.includes('Files');
    if (!internal && !external) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = internal ? 'move' : 'copy';
    const target = dropFolderFor(node);
    if (target !== dropTarget) setDropTarget(target);
    // Auto-expand collapsed folders while hovering.
    if (node?.kind === 'folder' && !expanded.has(node.id)) {
      if (expandTimer.current?.id !== node.id) {
        if (expandTimer.current) clearTimeout(expandTimer.current.t);
        expandTimer.current = { id: node.id, t: setTimeout(() => expand([node.id]), 600) };
      }
    }
  };

  const onDrop = async (e: DragEvent, node: FileNode | null) => {
    e.preventDefault();
    e.stopPropagation();
    if (expandTimer.current) clearTimeout(expandTimer.current.t);
    expandTimer.current = null;
    setDropTarget(null);
    const target = dropFolderFor(node);
    const raw = e.dataTransfer.getData(DRAG_TYPE);
    if (raw) {
      moveNodes(JSON.parse(raw) as string[], target);
      return;
    }
    if (!project || !e.dataTransfer.types.includes('Files')) return;
    const pending = await collectDropped(e.dataTransfer);
    const ids = await importIntoProject(project, folderPath(target), pending);
    if (target !== ROOT_ID) expand([target]);
    if (ids.length === 1) reveal(ids[0], false);
  };

  // ───────────── menus ─────────────

  const menuFor = (node: FileNode | null): MenuEntry[] => {
    const multi = node && selected.has(node.id) && selected.size > 1;
    if (multi) {
      return [
        { type: 'label', label: `${selected.size} items selected` },
        { label: `Delete ${selected.size} items`, icon: <Trash2 />, danger: true, shortcut: 'Mod-Backspace', onSelect: () => void deleteNodes([...selected]) },
      ];
    }
    const folder = dropFolderFor(node);
    const base: MenuEntry[] = [
      { label: 'New file…', icon: <FilePlus />, onSelect: () => startCreate('file', folder) },
      { label: 'New folder…', icon: <FolderPlus />, onSelect: () => startCreate('folder', folder) },
      { label: 'Upload files…', icon: <Upload />, onSelect: () => upload(folder) },
    ];
    if (!node) return [...base, { type: 'separator' }, { label: 'Collapse all folders', icon: <ChevronsDownUp />, onSelect: () => setExpanded(new Set()) }];
    return [
      ...(node.kind === 'file'
        ? ([
            { label: 'Open', onSelect: () => openNode(node, false) },
            ...(isTexPath(node.path) && node.id !== mainId ? [{ label: 'Set as main file', icon: <Star />, onSelect: () => setMain(node) }] : []),
            { type: 'separator' },
          ] as MenuEntry[])
        : []),
      ...base,
      { type: 'separator' },
      { label: 'Rename', icon: <Pencil />, shortcut: 'F2', onSelect: () => startRename(node.id) },
      ...(node.kind === 'file' ? [{ label: 'Duplicate', icon: <CopyPlus />, onSelect: () => duplicate(node.id) }] : []),
      { label: node.kind === 'folder' ? 'Download as .zip' : 'Download', icon: <Download />, onSelect: () => download(node) },
      { label: 'Copy path', icon: <Copy />, onSelect: () => copyPath(node) },
      { type: 'separator' },
      { label: 'Delete', icon: <Trash2 />, danger: true, shortcut: 'Mod-Backspace', onSelect: () => void deleteNodes([node.id]) },
    ];
  };

  // ───────────── render ─────────────

  const createRowIndex = useMemo(() => {
    if (editing?.mode !== 'create') return -1;
    if (editing.parentId === ROOT_ID) return 0;
    const i = rows.findIndex((r) => r.node.id === editing.parentId);
    return i < 0 ? 0 : i + 1;
  }, [editing, rows]);
  const createDepth = editing?.mode === 'create' && editing.parentId !== ROOT_ID ? (rows.find((r) => r.node.id === editing.parentId)?.depth ?? -1) + 1 : 0;

  const items: ({ type: 'row'; row: Row } | { type: 'create' })[] = rows.map((row) => ({ type: 'row' as const, row }));
  if (createRowIndex >= 0) items.splice(createRowIndex, 0, { type: 'create' });

  return (
    <div className="flex h-full min-h-0 flex-col" data-keep-focus>
      <PanelHeader
        title="Files"
        actions={
          <>
            <IconButton size="xs" label="New file" onClick={() => startCreate('file')}>
              <FilePlus />
            </IconButton>
            <IconButton size="xs" label="New folder" onClick={() => startCreate('folder')}>
              <FolderPlus />
            </IconButton>
            <IconButton size="xs" label="Upload files" onClick={() => upload()}>
              <Upload />
            </IconButton>
            <IconButton size="xs" label="Filter files" active={showFilter || !!filter} onClick={() => setShowFilter((v) => !v || !!filter)}>
              <Search />
            </IconButton>
            <IconButton size="xs" label="Collapse all" onClick={() => setExpanded(new Set())}>
              <ChevronsDownUp />
            </IconButton>
          </>
        }
      />
      {(showFilter || filter) && (
        <div className="px-2 pb-1.5">
          <div className="flex h-7 items-center gap-1.5 rounded-md border border-border bg-surface-2/60 px-2 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/15">
            <Search className="size-3.5 shrink-0 text-fg-subtle" />
            <input
              autoFocus
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setFilter('');
                  setShowFilter(false);
                  treeRef.current?.focus();
                } else if (e.key === 'ArrowDown' || e.key === 'Enter') {
                  e.preventDefault();
                  const first = rows.find((r) => r.node.kind === 'file');
                  if (first) {
                    setFocusId(first.node.id);
                    setSelected(new Set([first.node.id]));
                    if (e.key === 'Enter') openNode(first.node, false);
                  }
                  treeRef.current?.focus();
                }
              }}
              placeholder="Filter files"
              spellCheck={false}
              className="h-full min-w-0 flex-1 bg-transparent text-[12px] text-fg outline-none placeholder:text-fg-subtle"
            />
            {filter && (
              <button onClick={() => setFilter('')} className="text-fg-subtle hover:text-fg" aria-label="Clear filter">
                <X className="size-3.5" />
              </button>
            )}
          </div>
        </div>
      )}
      <ContextMenu items={() => menuFor(null)}>
        <div
          ref={treeRef}
          role="tree"
          aria-label="Project files"
          aria-multiselectable
          tabIndex={0}
          onKeyDown={onKeyDown}
          onDragOver={(e) => onDragOver(e, null)}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropTarget(null);
          }}
          onDrop={(e) => void onDrop(e, null)}
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelected(new Set());
          }}
          className={cn(
            'relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-6 outline-none',
            dropTarget === ROOT_ID && 'bg-accent-soft/60 ring-1 ring-inset ring-accent/40',
          )}
        >
          {items.map((it) => {
            if (it.type === 'create' && editing?.mode === 'create') {
              return (
                <EditRow
                  key="__create"
                  depth={createDepth}
                  kind={editing.kind}
                  initial=""
                  validate={(v) => validateName(v, kids.get(editing.parentId) ?? [])}
                  onCommit={commitEdit}
                  onCancel={() => setEditing(null)}
                />
              );
            }
            if (it.type !== 'row') return null;
            const { node, depth } = it.row;
            if (editing?.mode === 'rename' && editing.id === node.id) {
              return (
                <EditRow
                  key={node.id}
                  depth={depth}
                  kind={node.kind}
                  path={node.path}
                  initial={node.name}
                  validate={(v) => validateName(v, kids.get(node.parentId) ?? [], node.id)}
                  onCommit={commitEdit}
                  onCancel={() => {
                    setEditing(null);
                    treeRef.current?.focus();
                  }}
                />
              );
            }
            const isFolder = node.kind === 'folder';
            const open = isFolder && (expanded.has(node.id) || !!filter);
            const isSelected = selected.has(node.id);
            const isDrop = isFolder && dropTarget === node.id;
            const folderPeers = isFolder ? undefined : peers.get(node.id);
            return (
              <ContextMenu key={node.id} items={() => menuFor(node)}>
                <div
                  role="treeitem"
                  aria-selected={isSelected}
                  aria-expanded={isFolder ? open : undefined}
                  aria-level={depth + 1}
                  data-node-id={node.id}
                  draggable
                  onDragStart={(e) => onDragStartRow(e, node)}
                  onDragOver={(e) => onDragOver(e, node)}
                  onDrop={(e) => void onDrop(e, node)}
                  onClick={(e) => onRowClick(e, node)}
                  onDoubleClick={() => (isFolder ? undefined : openNode(node, false))}
                  onContextMenu={() => {
                    if (!selected.has(node.id)) {
                      setSelected(new Set([node.id]));
                      setAnchorId(node.id);
                    }
                    setFocusId(node.id);
                  }}
                  style={{ paddingLeft: 8 + depth * 14 }}
                  className={cn(
                    'group relative flex h-[26px] cursor-default select-none items-center gap-1.5 pr-2 text-[12.5px] transition-colors',
                    isSelected ? 'bg-accent-soft text-fg' : 'text-fg-muted hover:bg-hover hover:text-fg',
                    node.id === activeId && !isSelected && 'text-fg',
                    focusId === node.id && 'shadow-[inset_2px_0_0_var(--tx-accent)]',
                    isDrop && 'bg-accent-soft ring-1 ring-inset ring-accent/50',
                    dropTarget && dropTarget !== ROOT_ID && !isFolder && node.parentId === dropTarget && 'bg-accent-soft/50',
                  )}
                >
                  {Array.from({ length: depth }, (_, i) => (
                    <span key={i} className="pointer-events-none absolute inset-y-0 w-px bg-border opacity-0 transition-opacity group-hover:opacity-100 [[role=tree]:hover_&]:opacity-100" style={{ left: 15 + i * 14 }} />
                  ))}
                  <span className="flex w-3.5 shrink-0 items-center justify-center">
                    {isFolder && <ChevronRight className={cn('size-3.5 text-fg-subtle transition-transform duration-150', open && 'rotate-90')} />}
                  </span>
                  <FileIcon path={node.path} folder={isFolder} open={open} className="size-[15px]" />
                  <span className={cn('min-w-0 flex-1 truncate', node.id === activeId && 'font-medium')}>
                    <Highlight text={node.name} query={filter} />
                  </span>
                  {node.id === mainId && (
                    <span title="Main file (compiled)" className="flex shrink-0 items-center gap-0.5 rounded px-1 text-[10px] font-semibold uppercase tracking-wide text-accent">
                      <Star className="size-3 fill-current" />
                      main
                    </span>
                  )}
                  <PresenceDots peers={folderPeers} className={isSelected ? '[--dot-ring:transparent]' : undefined} />
                </div>
              </ContextMenu>
            );
          })}
          {!files.length && !editing && (
            <EmptyState
              icon={<FilePlus />}
              title="No files yet"
              description="Create a file, or drop files and folders here."
              className="py-8"
            />
          )}
          {filter && !rows.length && <div className="px-4 py-6 text-center text-[12px] text-fg-subtle">No files match “{filter}”</div>}
        </div>
      </ContextMenu>
      <input
        ref={uploadRef}
        type="file"
        multiple
        hidden
        onChange={async (e) => {
          const list = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (!project || !list.length) return;
          const target = uploadTarget.current;
          const ids = await importIntoProject(project, folderPath(target), list.map((f) => ({ path: f.name, file: f })));
          if (target !== ROOT_ID) expand([target]);
          if (ids.length === 1) reveal(ids[0], false);
        }}
      />
    </div>
  );
}

function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim().toLowerCase();
  const i = q ? text.toLowerCase().indexOf(q) : -1;
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded-sm bg-warning/25 text-inherit">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

function EditRow({
  depth,
  kind,
  path,
  initial,
  validate,
  onCommit,
  onCancel,
}: {
  depth: number;
  kind: 'file' | 'folder';
  path?: string;
  initial: string;
  validate: (v: string) => string | null;
  onCommit: (v: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const dot = kind === 'file' ? initial.lastIndexOf('.') : -1;
    el.setSelectionRange(0, dot > 0 ? dot : initial.length);
  }, [initial, kind]);
  const error = value.trim() && value !== initial ? validate(value) : null;
  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    if (commit && value.trim() && !error) onCommit(value);
    else onCancel();
  };
  return (
    <div className="relative" style={{ paddingLeft: 8 + depth * 14 }}>
      <div className="flex h-[26px] items-center gap-1.5 pr-2">
        <span className="w-3.5 shrink-0" />
        <FileIcon path={path ?? (value || (kind === 'file' ? 'untitled.tex' : ''))} folder={kind === 'folder'} className="size-[15px]" />
        <input
          ref={ref}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') {
              e.preventDefault();
              finish(true);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              finish(false);
            }
          }}
          onBlur={() => finish(true)}
          placeholder={kind === 'file' ? 'name.tex' : 'folder name'}
          spellCheck={false}
          className={cn(
            'h-[22px] min-w-0 flex-1 rounded border bg-surface px-1.5 text-[12.5px] text-fg outline-none ring-2',
            error ? 'border-danger ring-danger/15' : 'border-accent ring-accent/15',
          )}
        />
      </div>
      {error && (
        <div className="absolute inset-x-2 top-[26px] z-10 rounded-md bg-danger px-2 py-1 text-[11.5px] font-medium text-white shadow-lg" style={{ marginLeft: 8 + depth * 14 + 20 }}>
          {error}
        </div>
      )}
    </div>
  );
}


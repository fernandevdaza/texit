import { useEffect, useState } from 'react';
import { isTexPath } from '@texit/core';
import { useWorkspace } from '@/state/workspace';
import { useSettings } from '@/state/settings';
import { useT } from '@/lib/i18n';
import { StatusButton } from '@/features/workspace/StatusBar';
import { fileTypeLabel } from '@/features/files/FileIcon';
import { editorController } from './cm/controller';
import { safeCountWords } from './projectIndex';

function useActiveFile() {
  const id = useWorkspace((s) => s.activeFileId);
  const file = useWorkspace((s) => (id ? s.files.find((f) => f.id === id) : undefined));
  return file;
}

export function WordCountStatus() {
  const file = useActiveFile();
  const project = useWorkspace((s) => s.project);
  const [words, setWords] = useState<number | null>(null);
  const t = useT();
  const isTex = !!file && isTexPath(file.path);
  useEffect(() => {
    if (!project || !file || !isTex) {
      setWords(null);
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = () => setWords(safeCountWords(project.readText(file.id)));
    run();
    const off = project.onContentChange((ids) => {
      if (!ids.has(file.id)) return;
      clearTimeout(timer);
      timer = setTimeout(run, 700);
    });
    return () => {
      clearTimeout(timer);
      off();
    };
  }, [project, file?.id, isTex]);
  if (words === null) return null;
  return (
    <StatusButton title={t('editor.wordCountTitle')} className="tabular-nums">
      {t('editor.wordCount', { count: words })}
    </StatusButton>
  );
}

export function FileTypeStatus() {
  const file = useActiveFile();
  useT(); // re-render on language change (fileTypeLabel is translated)
  if (!file) return null;
  return <span className="px-1.5">{fileTypeLabel(file.path)}</span>;
}

export function KeymapStatus() {
  const keymap = useSettings((s) => s.editor.keymap);
  const [mode, setMode] = useState(editorController.vimModeValue);
  const t = useT();
  useEffect(() => {
    const d = editorController.vimMode.on(setMode);
    return () => d.dispose();
  }, []);
  if (keymap === 'default') return null;
  const label = keymap === 'vim' ? `VIM · ${mode.toUpperCase()}` : 'EMACS';
  return (
    <StatusButton
      title={t('editor.keymapTitle')}
      onClick={() => useSettings.getState().setEditor({ keymap: 'default' })}
      className="font-mono text-[10.5px] font-semibold tracking-wide text-accent"
    >
      {label}
    </StatusButton>
  );
}

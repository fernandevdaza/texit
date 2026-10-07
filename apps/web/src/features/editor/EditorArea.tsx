import { useEffect, useLayoutEffect, useRef } from 'react';
import { isImagePath, isPdfPath } from '@texit/core';
import { useWorkspace } from '@/state/workspace';
import { cn } from '@/lib/cn';
import { editorController } from './cm/controller';
import { TabBar } from './TabBar';
import { Breadcrumbs } from './Breadcrumbs';
import { BinaryCard, EmptyEditor, ImageViewer, PdfFileView } from './Viewers';

/** Hosts the single, long-lived CodeMirror view. */
function CodeHost({ fileId, visible }: { fileId: string | null; visible: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const view = editorController.ensureView();
    const host = ref.current!;
    host.appendChild(view.dom);
    view.requestMeasure();
    return () => {
      if (view.dom.parentElement === host) host.removeChild(view.dom);
    };
  }, []);
  useLayoutEffect(() => {
    if (visible && fileId) {
      editorController.showFile(fileId);
      editorController.view?.requestMeasure();
    } else editorController.hide();
  }, [fileId, visible]);
  // Re-show when the Y.Text of the file is replaced (e.g. renamed text ↔ binary).
  const treeVersion = useWorkspace((s) => s.treeVersion);
  useEffect(() => {
    if (visible && fileId) editorController.showFile(fileId);
  }, [treeVersion, visible, fileId]);
  return <div ref={ref} className={cn('absolute inset-0 [&>.cm-editor]:h-full', !visible && 'invisible')} />;
}

export function EditorArea() {
  const activeId = useWorkspace((s) => s.activeFileId);
  const file = useWorkspace((s) => (s.activeFileId ? s.files.find((f) => f.id === s.activeFileId) : undefined));
  const isText = !!file && file.isText;
  const kind = !file ? 'none' : isText ? 'text' : isImagePath(file.path) && !file.path.endsWith('.eps') ? 'image' : isPdfPath(file.path) ? 'pdf' : 'binary';

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <TabBar />
      {file && <Breadcrumbs file={file} isText={isText} />}
      <div className="relative min-h-0 flex-1">
        <CodeHost fileId={isText ? activeId : null} visible={kind === 'text'} />
        {kind === 'image' && file && (
          <div className="absolute inset-0">
            <ImageViewer key={file.id} file={file} />
          </div>
        )}
        {kind === 'pdf' && file && (
          <div className="absolute inset-0 bg-pdf-bg">
            <PdfFileView key={file.id} file={file} />
          </div>
        )}
        {kind === 'binary' && file && (
          <div className="absolute inset-0">
            <BinaryCard file={file} />
          </div>
        )}
        {kind === 'none' && (
          <div className="absolute inset-0">
            <EmptyEditor />
          </div>
        )}
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels';
import { useLocation } from 'wouter';
import { AlertTriangle } from 'lucide-react';
import { openProjectSession } from '@/services/projects';
import { useLayout, useWorkspace } from '@/state/workspace';
import { host } from '@/lib/platform';
import { Button, EmptyState, Spinner } from '@/ui';
import { EditorArea } from '@/features/editor/EditorArea';
import { PdfPane } from '@/features/pdf/PdfPane';
import { AiPanel } from '@/features/ai/AiPanel';
import { TopBar } from './TopBar';
import { ActivityBar } from './ActivityBar';
import { SidebarHost, BottomHost } from './PanelHost';
import { StatusBar } from './StatusBar';

function ResizeHandle({ vertical }: { vertical?: boolean }) {
  return (
    <Separator
      className={
        vertical
          ? 'group relative h-px shrink-0 bg-border outline-none before:absolute before:inset-x-0 before:-top-1 before:-bottom-1 before:content-[""] data-[separator=active]:bg-accent data-[separator=hover]:bg-accent/60'
          : 'group relative w-px shrink-0 bg-border outline-none before:absolute before:inset-y-0 before:-left-1 before:-right-1 before:content-[""] data-[separator=active]:bg-accent data-[separator=hover]:bg-accent/60'
      }
    />
  );
}

export function Workspace({ projectId }: { projectId: string }) {
  const [error, setError] = useState<string | null>(null);
  const session = useWorkspace((s) => s.session);
  const [, navigate] = useLocation();

  // Open / close the project session.
  useEffect(() => {
    let cancelled = false;
    let closer: (() => Promise<void>) | null = null;
    setError(null);
    openProjectSession(projectId)
      .then((s) => {
        if (cancelled) {
          void s.close();
          return;
        }
        closer = s.close;
        const ws = useWorkspace.getState();
        ws.setSession(s);
        // Open the main file (or the first text file).
        const mainId = s.project.getMainFileId() ?? s.project.listFiles().find((f) => f.isText)?.id;
        if (mainId) ws.openFile(mainId);
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) setError(String(err?.message ?? err));
      });
    return () => {
      cancelled = true;
      useWorkspace.getState().setSession(null);
      void closer?.();
    };
  }, [projectId]);

  // Keep the cached tree in sync with the Y.Doc.
  useEffect(() => {
    if (!session) return;
    let raf = 0;
    const off = session.project.onTreeChange(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => useWorkspace.getState().refreshTree());
    });
    return () => {
      cancelAnimationFrame(raf);
      off();
    };
  }, [session]);

  // Window title.
  const name = useWorkspace((s) => s.meta?.name);
  useEffect(() => {
    if (!name) return;
    document.title = `${name} — TexIt`;
    host?.app.setTitle(`${name} — TexIt`);
    return () => {
      document.title = 'TexIt';
    };
  }, [name]);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState
          icon={<AlertTriangle />}
          title="Could not open this project"
          description={error}
          action={<Button onClick={() => navigate('/')}>Back to projects</Button>}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-bg">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <ActivityBar />
        {session ? (
          <MainArea />
        ) : (
          <div className="flex flex-1 items-center justify-center gap-2 text-fg-subtle">
            <Spinner /> Opening project…
          </div>
        )}
      </div>
      <StatusBar />
    </div>
  );
}

function MainArea() {
  const { sidebarOpen, bottomOpen, pdfOpen, aiOpen, focusMode } = useLayout();
  const showEditor = focusMode !== 'pdf';
  const showPdf = pdfOpen && focusMode !== 'editor';
  const showSidebar = sidebarOpen && focusMode === 'none';

  const panelIds = [showSidebar && 'sidebar', showEditor && 'main', showPdf && 'pdf', aiOpen && 'ai'].filter(Boolean) as string[];
  const outer = useDefaultLayout({ id: 'texit-main', panelIds, storage: localStorage });
  const inner = useDefaultLayout({ id: 'texit-editor', panelIds: bottomOpen ? ['editor', 'bottom'] : ['editor'], storage: localStorage });

  return (
    <Group orientation="horizontal" className="min-w-0 flex-1" defaultLayout={outer.defaultLayout} onLayoutChanged={outer.onLayoutChanged}>
      {showSidebar && (
        <>
          <Panel id="sidebar" defaultSize="250px" minSize="180px" maxSize="520px" groupResizeBehavior="preserve-pixel-size" className="bg-surface">
            <SidebarHost />
          </Panel>
          <ResizeHandle />
        </>
      )}
      {showEditor && (
        <Panel id="main" minSize="280px" className="min-w-0">
          <Group orientation="vertical" defaultLayout={inner.defaultLayout} onLayoutChanged={inner.onLayoutChanged}>
            <Panel id="editor" minSize="120px" className="min-h-0">
              <EditorArea />
            </Panel>
            {bottomOpen && (
              <>
                <ResizeHandle vertical />
                <Panel id="bottom" defaultSize="220px" minSize="90px" groupResizeBehavior="preserve-pixel-size" className="bg-surface">
                  <BottomHost />
                </Panel>
              </>
            )}
          </Group>
        </Panel>
      )}
      {showPdf && (
        <>
          {showEditor && <ResizeHandle />}
          <Panel id="pdf" minSize="260px" defaultSize={showEditor ? '50%' : '100%'} className="min-w-0 bg-pdf-bg">
            <PdfPane />
          </Panel>
        </>
      )}
      {aiOpen && (
        <>
          <ResizeHandle />
          <Panel id="ai" defaultSize="400px" minSize="300px" maxSize="760px" groupResizeBehavior="preserve-pixel-size" className="bg-surface">
            <AiPanel />
          </Panel>
        </>
      )}
    </Group>
  );
}

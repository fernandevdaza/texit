import { memo, useEffect, useMemo, useRef } from 'react';
import { cn } from '@/lib/cn';
import type { PdfView, PdfViewState } from './engine';

const THUMB_W = 112;

/**
 * Sequential, low-priority thumbnail renderer: one page at a time, most
 * recently requested first (the ones the user is looking at).
 */
function createQueue(view: PdfView) {
  const pending = new Map<number, (c: HTMLCanvasElement | null) => void>();
  let running = false;
  const pump = async () => {
    if (running) return;
    running = true;
    while (pending.size) {
      const [index, cb] = [...pending.entries()].pop()!;
      pending.delete(index);
      cb(await view.renderThumbnail(index, THUMB_W));
    }
    running = false;
  };
  return {
    request(index: number, cb: (c: HTMLCanvasElement | null) => void) {
      pending.delete(index);
      pending.set(index, cb);
      void pump();
    },
    cancel(index: number) {
      pending.delete(index);
    },
  };
}

export function PdfThumbnails({ view, state }: { view: PdfView; state: PdfViewState }) {
  const listRef = useRef<HTMLDivElement>(null);
  const queue = useMemo(() => createQueue(view), [view]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const sizes = useMemo(() => view.pageSizes(), [view, state.docVersion]);

  // Keep the current page's thumbnail in view.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-thumb="${state.page}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [state.page]);

  return (
    <div ref={listRef} className="h-full w-[148px] shrink-0 overflow-y-auto border-r border-border bg-surface/70 px-3 py-3 backdrop-blur" aria-label="Page thumbnails">
      <div className="flex flex-col items-center gap-3">
        {sizes.map((s, i) => (
          <Thumb
            key={i}
            index={i}
            ratio={s.h / s.w}
            active={state.page === i + 1}
            docVersion={state.docVersion}
            queue={queue}
            onSelect={() => view.goToPage(i + 1, { history: true })}
          />
        ))}
      </div>
    </div>
  );
}

const Thumb = memo(function Thumb({
  index,
  ratio,
  active,
  docVersion,
  queue,
  onSelect,
}: {
  index: number;
  ratio: number;
  active: boolean;
  docVersion: number;
  queue: ReturnType<typeof createQueue>;
  onSelect: () => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const paperRef = useRef<HTMLDivElement>(null);
  const renderedFor = useRef(-1);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    let visible = false;
    const request = () => {
      if (renderedFor.current === docVersion) return;
      queue.request(index, (canvas) => {
        const paper = paperRef.current;
        if (!canvas || !paper) return;
        // Swap only once the new bitmap exists: no flicker on recompile.
        paper.replaceChildren(canvas);
        renderedFor.current = docVersion;
      });
    };
    const io = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
        if (visible) request();
        else queue.cancel(index);
      },
      { rootMargin: '300px 0px' },
    );
    io.observe(box);
    return () => {
      io.disconnect();
      queue.cancel(index);
    };
  }, [index, docVersion, queue]);

  return (
    <button
      type="button"
      data-thumb={index + 1}
      onClick={onSelect}
      className="group flex w-full flex-col items-center gap-1.5 outline-none"
      aria-label={`Page ${index + 1}`}
      aria-current={active ? 'page' : undefined}
    >
      <div
        ref={boxRef}
        className={cn(
          'tx-pdf-thumb relative w-full overflow-hidden rounded-[3px] bg-white shadow-[0_0_0_1px_rgb(15_15_30/0.08),0_2px_6px_-2px_rgb(15_15_30/0.15)] transition-[box-shadow,transform] duration-150 group-hover:-translate-y-px',
          active && 'shadow-[0_0_0_2px_var(--tx-accent),0_4px_12px_-4px_color-mix(in_srgb,var(--tx-accent)_50%,transparent)]',
        )}
        style={{ aspectRatio: `1 / ${ratio}` }}
      >
        <div ref={paperRef} className="tx-pdf-thumb-paper absolute inset-0 bg-white" />
      </div>
      <span className={cn('text-[10.5px] tabular-nums transition-colors', active ? 'font-semibold text-accent' : 'text-fg-subtle group-hover:text-fg-muted')}>
        {index + 1}
      </span>
    </button>
  );
});

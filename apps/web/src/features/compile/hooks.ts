import { useEffect, useState } from 'react';
import { useWorkspace } from '@/state/workspace';

/** Elapsed ms since `startedAt`, ticking while `active`. */
export function useElapsed(startedAt: number | undefined, active: boolean, intervalMs = 100): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [active, intervalMs]);
  return startedAt ? Math.max(0, now - startedAt) : 0;
}

export function useIsCompiling(): boolean {
  return useWorkspace((s) => s.compile.status === 'preparing' || s.compile.status === 'compiling');
}

export function formatElapsed(ms: number): string {
  return ms < 60_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
}

/** Counts by severity. */
export function useDiagnosticCounts() {
  const diags = useWorkspace((s) => s.compile.diagnostics);
  let errors = 0;
  let warnings = 0;
  let badboxes = 0;
  let infos = 0;
  for (const d of diags) {
    if (d.severity === 'error') errors++;
    else if (d.severity === 'warning') warnings++;
    else if (d.severity === 'badbox') badboxes++;
    else infos++;
  }
  return { errors, warnings, badboxes, infos, total: diags.length };
}

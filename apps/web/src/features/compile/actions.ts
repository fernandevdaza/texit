import type { TexEngine } from '@texit/core';
import { useWorkspace } from '@/state/workspace';
import { t } from '@/lib/i18n';
import { toast } from '@/ui';
import { ENGINE_LABELS, getController } from './controller';

/** Persist the project's engine (project meta) and recompile. */
export function setProjectEngine(engine: TexEngine) {
  const p = useWorkspace.getState().project;
  if (!p) return;
  p.setMeta({ engine });
  useWorkspace.getState().refreshTree();
  toast(t('compile.engineToast', { engine: ENGINE_LABELS[engine] }), { id: 'compile-engine', duration: 1500 });
  void getController()?.compile({ reason: 'manual' });
}

/** Persist the project's backend ('auto' → app default) and recompile. */
export function setProjectBackend(id: string) {
  const p = useWorkspace.getState().project;
  if (!p) return;
  p.setMeta({ compilerBackend: id === 'auto' ? '' : id });
  useWorkspace.getState().refreshTree();
  void getController()?.compile({ reason: 'manual' });
}

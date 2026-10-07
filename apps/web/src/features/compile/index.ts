/**
 * Compile feature: controller (CompileService + backends + auto-compile),
 * top-bar button, Problems / Raw log panels, commands and status-bar items.
 */
import { ArrowDown, ArrowUp, Eraser, Play, Repeat, Square, Zap } from 'lucide-react';
import type { TexEngine } from '@texit/core';
import { registerCommands } from '@/services/commands';
import { registerStatusItem } from '@/services/panels';
import { useSettings } from '@/state/settings';
import { useLayout, useWorkspace } from '@/state/workspace';
import { toast } from '@/ui';
import { ENGINE_LABELS, getController, startCompileController } from './controller';
import { setProjectEngine } from './actions';
import { CompileStatusItem, EngineStatusItem } from './StatusItems';

export { CompileButton } from './CompileButton';
export { ProblemsPanel } from './ProblemsPanel';
export { LogPanel } from './LogPanel';
export { setProjectBackend, setProjectEngine } from './actions';

const inProject = () => !!useWorkspace.getState().project;
const compiling = () => {
  const s = useWorkspace.getState().compile.status;
  return s === 'preparing' || s === 'compiling';
};

export function activate(): () => void {
  const stop = startCompileController();
  const stopCompile = () => getController()?.cancel();
  const disposables = [
    registerCommands([
      {
        id: 'compile.run',
        title: 'Compile',
        category: 'Compile',
        icon: Play,
        keybinding: 'Mod-Enter',
        global: true,
        when: inProject,
        keywords: ['build', 'recompile', 'pdf', 'latex'],
        run: () => getController()?.compile({ reason: 'manual' }),
      },
      {
        id: 'compile.draft',
        title: 'Compile (fast draft pass)',
        category: 'Compile',
        icon: Zap,
        keybinding: 'Mod-Alt-Enter',
        global: true,
        when: inProject,
        run: () => getController()?.compile({ reason: 'manual', draft: true }),
      },
      { id: 'compile.stop', title: 'Stop compilation', category: 'Compile', icon: Square, keybinding: 'Mod-.', global: true, when: compiling, run: stopCompile },
      // Alias used by the PDF pane.
      { id: 'compile.cancel', title: 'Cancel compilation', category: 'Compile', hidden: true, when: compiling, run: stopCompile },
      {
        id: 'compile.toggleAuto',
        title: 'Toggle auto-compile',
        category: 'Compile',
        icon: Repeat,
        run: () => {
          const s = useSettings.getState();
          s.setCompile({ auto: !s.compile.auto });
          toast(`Auto-compile ${!s.compile.auto ? 'on' : 'off'}`, { id: 'compile-auto', duration: 1500 });
        },
      },
      {
        id: 'compile.toggleDraft',
        title: 'Toggle draft passes while typing',
        category: 'Compile',
        icon: Zap,
        run: () => {
          const s = useSettings.getState();
          s.setCompile({ draftWhileTyping: !s.compile.draftWhileTyping });
          toast(`Draft passes while typing ${!s.compile.draftWhileTyping ? 'on' : 'off'}`, { id: 'compile-draft', duration: 1500 });
        },
      },
      {
        id: 'compile.clearCache',
        title: 'Clear TeX Live cache & recompile',
        category: 'Compile',
        icon: Eraser,
        run: () => getController()?.clearCacheAndRecompile(),
      },
      ...(['pdflatex', 'xelatex', 'lualatex'] as TexEngine[]).map((engine) => ({
        id: `compile.setEngine.${engine}`,
        title: `Use ${ENGINE_LABELS[engine]}`,
        category: 'Compile',
        when: inProject,
        keywords: ['engine'],
        run: () => setProjectEngine(engine),
      })),
      {
        id: 'compile.nextError',
        title: 'Go to next problem',
        category: 'Compile',
        icon: ArrowDown,
        keybinding: 'F8',
        global: true,
        when: () => inProject() && useWorkspace.getState().compile.diagnostics.length > 0,
        run: () => getController()?.jumpToDiagnostic(1),
      },
      {
        id: 'compile.prevError',
        title: 'Go to previous problem',
        category: 'Compile',
        icon: ArrowUp,
        keybinding: 'Shift-F8',
        global: true,
        when: () => inProject() && useWorkspace.getState().compile.diagnostics.length > 0,
        run: () => getController()?.jumpToDiagnostic(-1),
      },
      {
        id: 'compile.showLog',
        title: 'Show raw compile log',
        category: 'Compile',
        hidden: true,
        run: () => useLayout.getState().showBottomPanel('log'),
      },
    ]),
    registerStatusItem({ id: 'compile.status', align: 'left', order: 10, component: CompileStatusItem }),
    registerStatusItem({ id: 'compile.engine', align: 'right', order: 20, component: EngineStatusItem }),
  ];
  return () => {
    disposables.forEach((d) => d.dispose());
    stop();
  };
}

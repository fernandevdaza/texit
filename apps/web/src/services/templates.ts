/** Template registry: built-in templates from @texit/core + plugin-contributed ones. */
import { create } from 'zustand';
import { templates as builtin, type Disposable, type ProjectTemplate } from '@texit/core';

export const useTemplates = create<{ templates: ProjectTemplate[] }>(() => ({ templates: [...builtin] }));

export function registerTemplate(t: ProjectTemplate): Disposable {
  useTemplates.setState((s) => ({ templates: [...s.templates.filter((x) => x.id !== t.id), t] }));
  return { dispose: () => useTemplates.setState((s) => ({ templates: s.templates.filter((x) => x !== t) })) };
}

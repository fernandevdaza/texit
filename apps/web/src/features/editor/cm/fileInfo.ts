import { Facet } from '@codemirror/state';

export interface EditorFileInfo {
  id: string;
  /** Project-relative path. */
  path: string;
}

/** Which project file an EditorState belongs to (set per state by the controller). */
export const fileInfo = Facet.define<EditorFileInfo, EditorFileInfo | null>({
  combine: (values) => values[values.length - 1] ?? null,
});

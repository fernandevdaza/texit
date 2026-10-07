/**
 * Collaboration bridge. The collab feature publishes the Yjs Awareness of the
 * current project here; the editor binds remote cursors to it (yCollab) and
 * other features (presence avatars, follow mode, chat) read it.
 */
import type { Awareness } from 'y-protocols/awareness';
import { Emitter } from '@/lib/emitter';

/** Fields every peer publishes in its awareness state under the `user` key. */
export interface PeerUser {
  name: string;
  color: string;
  /** Lighter color used for selections (y-codemirror.next convention). */
  colorLight: string;
  /** Currently active file id (for follow mode / file-tree presence dots). */
  fileId?: string;
}

let current: Awareness | null = null;
export const awarenessChanged = new Emitter<Awareness | null>();

export function setAwareness(a: Awareness | null) {
  if (current === a) return;
  current = a;
  awarenessChanged.emit(a);
}

export function getAwareness(): Awareness | null {
  return current;
}

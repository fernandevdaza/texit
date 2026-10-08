/**
 * Project chat: messages live in the project Y.Doc under the top-level
 * `chat` Y.Array (synced and persisted like everything else, end-to-end
 * encrypted on the wire).
 */
import type { ProjectDoc } from '@texit/core';
import * as Y from 'yjs';
import { useSettings } from '@/state/settings';
import { t } from '@/lib/i18n';
import { useCollabSettings } from './settings';

export interface ChatMessage {
  id: string;
  /** Stable local user id of the author (see settings.localUserId). */
  uid: string;
  name: string;
  color: string;
  text: string;
  ts: number;
}

export const MAX_CHAT_LENGTH = 4000;

export function getChat(project: ProjectDoc): Y.Array<ChatMessage> {
  return project.doc.getArray<ChatMessage>('chat');
}

export function sendChatMessage(project: ProjectDoc, text: string): ChatMessage | null {
  const body = text.trim().slice(0, MAX_CHAT_LENGTH);
  if (!body) return null;
  const { userName, userColor } = useSettings.getState();
  const msg: ChatMessage = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    uid: useCollabSettings.getState().localUserId,
    name: userName || t('collab.anonymous'),
    color: userColor,
    text: body,
    ts: Date.now(),
  };
  getChat(project).push([msg]);
  return msg;
}

export function isValidMessage(m: unknown): m is ChatMessage {
  const x = m as ChatMessage;
  return !!x && typeof x.text === 'string' && typeof x.ts === 'number' && typeof x.name === 'string';
}

// ───────────────────────────── read markers ─────────────────────────────

const readKey = (projectId: string) => `texit:collab:chat-read:${projectId}`;

export function getLastRead(projectId: string): number {
  try {
    return Number(localStorage.getItem(readKey(projectId)) || 0);
  } catch {
    return 0;
  }
}

export function setLastRead(projectId: string, ts: number) {
  try {
    localStorage.setItem(readKey(projectId), String(ts));
  } catch {
    /* ignore */
  }
}

export function countUnread(project: ProjectDoc, projectId: string): number {
  const since = getLastRead(projectId);
  const me = useCollabSettings.getState().localUserId;
  let n = 0;
  for (const m of getChat(project).toArray()) if (isValidMessage(m) && m.ts > since && m.uid !== me) n++;
  return n;
}

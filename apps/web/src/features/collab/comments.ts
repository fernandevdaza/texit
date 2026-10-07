/**
 * Review comments stored in `project.comments` (Y.Map<id, Y.Map>), anchored
 * to text with Yjs relative positions so they follow concurrent edits.
 *
 * Thread map fields:
 *   id, fileId, from, to          (RelativePosition JSON; `from` assoc 0, `to` assoc -1)
 *   quote                         selected text when the comment was created
 *   text, uid, name, color, ts    first message
 *   resolved, resolvedBy, resolvedAt
 *   replies                       Y.Array<CommentReply>
 */
import * as Y from 'yjs';
import type { ProjectDoc } from '@texit/core';
import { useSettings } from '@/state/settings';
import { useCollabSettings } from './settings';

export interface CommentReply {
  id: string;
  uid: string;
  name: string;
  color: string;
  text: string;
  ts: number;
}

export interface CommentThread {
  id: string;
  fileId: string;
  quote: string;
  text: string;
  uid: string;
  name: string;
  color: string;
  ts: number;
  resolved: boolean;
  resolvedBy?: string;
  resolvedAt?: number;
  replies: CommentReply[];
}

export interface ResolvedRange {
  from: number;
  to: number;
  /** The anchored text was deleted. */
  orphaned: boolean;
}

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

function author() {
  const { userName, userColor } = useSettings.getState();
  return { uid: useCollabSettings.getState().localUserId, name: userName || 'Anonymous', color: userColor };
}

export function addComment(project: ProjectDoc, input: { fileId: string; from: number; to: number; text: string; quote?: string }): string | null {
  const ytext = project.getYText(input.fileId);
  const body = input.text.trim();
  if (!ytext || !body) return null;
  const len = ytext.length;
  const from = Math.max(0, Math.min(input.from, len));
  const to = Math.max(from, Math.min(input.to, len));
  const id = newId();
  project.doc.transact(() => {
    const m = new Y.Map<any>();
    const a = author();
    m.set('id', id);
    m.set('fileId', input.fileId);
    m.set('from', Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(ytext, from, 0)));
    m.set('to', Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(ytext, to, -1)));
    m.set('quote', (input.quote ?? ytext.toString().slice(from, to)).slice(0, 500));
    m.set('text', body.slice(0, 8000));
    m.set('uid', a.uid);
    m.set('name', a.name);
    m.set('color', a.color);
    m.set('ts', Date.now());
    m.set('resolved', false);
    m.set('replies', new Y.Array<CommentReply>());
    project.comments.set(id, m);
  });
  return id;
}

export function replyToComment(project: ProjectDoc, id: string, text: string) {
  const m = project.comments.get(id);
  const body = text.trim();
  if (!m || !body) return;
  let replies = m.get('replies') as Y.Array<CommentReply> | undefined;
  project.doc.transact(() => {
    if (!(replies instanceof Y.Array)) {
      replies = new Y.Array<CommentReply>();
      m.set('replies', replies);
    }
    replies.push([{ id: newId(), ...author(), text: body.slice(0, 8000), ts: Date.now() }]);
  });
}

export function setCommentResolved(project: ProjectDoc, id: string, resolved: boolean) {
  const m = project.comments.get(id);
  if (!m) return;
  project.doc.transact(() => {
    m.set('resolved', resolved);
    if (resolved) {
      m.set('resolvedBy', author().name);
      m.set('resolvedAt', Date.now());
    } else {
      m.delete('resolvedBy');
      m.delete('resolvedAt');
    }
  });
}

export function deleteComment(project: ProjectDoc, id: string) {
  project.comments.delete(id);
}

export function readThread(id: string, m: Y.Map<any>): CommentThread | null {
  const fileId = m.get('fileId');
  if (typeof fileId !== 'string') return null;
  const replies = m.get('replies');
  return {
    id,
    fileId,
    quote: String(m.get('quote') ?? ''),
    text: String(m.get('text') ?? ''),
    uid: String(m.get('uid') ?? ''),
    name: String(m.get('name') ?? 'Anonymous'),
    color: String(m.get('color') ?? '#888'),
    ts: Number(m.get('ts') ?? 0),
    resolved: !!m.get('resolved'),
    resolvedBy: m.get('resolvedBy'),
    resolvedAt: m.get('resolvedAt'),
    replies: replies instanceof Y.Array ? (replies.toArray() as CommentReply[]).filter((r) => r && typeof r.text === 'string') : [],
  };
}

export function listThreads(project: ProjectDoc): CommentThread[] {
  const out: CommentThread[] = [];
  project.comments.forEach((m, id) => {
    if (!(m instanceof Y.Map)) return;
    const t = readThread(id, m);
    if (t) out.push(t);
  });
  return out;
}

/** Absolute range of a thread in its file's Y.Text (null if the file is gone). */
export function resolveRange(project: ProjectDoc, id: string): ResolvedRange | null {
  const m = project.comments.get(id);
  if (!m) return null;
  const ytext = project.getYText(m.get('fileId'));
  if (!ytext) return null;
  const abs = (json: unknown) => {
    if (!json) return null;
    try {
      const p = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(json), project.doc);
      return p && p.type === ytext ? p.index : null;
    } catch {
      return null;
    }
  };
  const from = abs(m.get('from'));
  const to = abs(m.get('to'));
  if (from == null || to == null) return null;
  const a = Math.min(from, to);
  const b = Math.max(from, to);
  return { from: a, to: b, orphaned: a === b && String(m.get('quote') ?? '').length > 0 };
}

/** 1-based line/column of an offset. */
export function lineCol(text: string, offset: number): { line: number; column: number } {
  let line = 1;
  let last = -1;
  const end = Math.min(offset, text.length);
  for (let i = 0; i < end; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      last = i;
    }
  }
  return { line, column: end - last };
}

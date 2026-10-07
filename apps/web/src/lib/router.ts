/**
 * Hash-based routing (works on static hosting and inside Electron's custom protocol).
 *   #/            → dashboard
 *   #/p/:id       → project workspace
 *   #/join/:room  → join a collaboration room (key passed as ?k=…)
 */
import { navigate as hashNavigate } from 'wouter/use-hash-location';

export function navigate(to: string, opts?: { replace?: boolean }) {
  hashNavigate(to, opts);
}

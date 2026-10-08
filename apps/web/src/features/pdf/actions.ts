import { useWorkspace } from '@/state/workspace';
import { downloadBlob } from '@/lib/format';
import { host } from '@/lib/platform';
import { t } from '@/lib/i18n';
import { toast } from '@/ui';
import './i18n';
import { useSettings } from '@/state/settings';
import { activeTexPath } from './synctex';

export function pdfFileName(): string {
  const name = useWorkspace.getState().meta?.name?.trim() || 'document';
  return `${name.replace(/[\\/:*?"<>|]+/g, '-')}.pdf`;
}

export async function downloadPdf() {
  const pdf = useWorkspace.getState().compile.pdf;
  if (!pdf) {
    toast(t('pdf.nothingToDownload'), { description: t('pdf.compileFirst') });
    return;
  }
  const name = pdfFileName();
  if (host) {
    try {
      await host.fs.saveFile({ defaultName: name, content: pdf, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
      return;
    } catch (err) {
      console.warn('[pdf] native save failed, falling back to a download', err);
    }
  }
  downloadBlob(pdf, name, 'application/pdf');
}

/** Forward search from the editor's cursor. */
export function syncFromCursor() {
  const path = activeTexPath();
  const ws = useWorkspace.getState();
  if (!path) {
    toast(t('pdf.openTexFile'));
    return;
  }
  ws.syncPdfTo(path, ws.cursor.line);
}

export function toggleFollowCursor() {
  const s = useSettings.getState();
  const on = !s.pdf.followCursor;
  s.setPdf({ followCursor: on });
  toast(on ? t('pdf.followsCursor') : t('pdf.noLongerFollows'));
}

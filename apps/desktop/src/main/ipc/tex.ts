import { z } from 'zod';
import { Invoke, Stream } from '../../shared/ipc';
import { cancelCompile, compileNative } from '../tex/compile';
import { detectTex } from '../tex/detect';
import { paths } from '../paths';
import { handle, safeSend, zBytes, zId, zStringRecord } from './util';

const zCompileRequest = z.object({
  jobId: zId,
  projectId: z.string().min(1).max(200),
  files: z.array(z.object({ path: z.string().min(1).max(1024), content: z.union([z.string(), zBytes]) })).max(50_000),
  mainPath: z.string().min(1).max(1024),
  engine: z.enum(['pdflatex', 'xelatex', 'lualatex']),
  driver: z.enum(['auto', 'latexmk', 'tectonic', 'raw']),
  bibTool: z.enum(['auto', 'bibtex', 'biber', 'none']),
  synctex: z.boolean(),
  shellEscape: z.boolean().optional(),
  env: zStringRecord.optional(),
});

/** Coalesce small log chunks into ~30 messages/s to keep IPC cheap during noisy builds. */
export function createBatcher(flush: (s: string) => void, intervalMs = 33) {
  let buf = '';
  let timer: NodeJS.Timeout | null = null;
  const run = () => {
    timer = null;
    if (buf) {
      const s = buf;
      buf = '';
      flush(s);
    }
  };
  return {
    push(s: string) {
      buf += s;
      if (!timer) timer = setTimeout(run, intervalMs);
    },
    end() {
      if (timer) clearTimeout(timer);
      run();
    },
  };
}

export function registerTexIpc(): void {
  handle(Invoke.texDetect, z.tuple([]), () => detectTex());

  handle(Invoke.texCompile, z.tuple([zCompileRequest, z.boolean().optional()]), async (event, req, wantLog) => {
    const channel = Stream.texLog(req.jobId);
    const batch = createBatcher((s) => safeSend(event.sender, channel, s));
    try {
      return await compileNative(req, { buildRoot: paths.builds(), onLog: wantLog === false ? undefined : (s) => batch.push(s) });
    } finally {
      batch.end();
    }
  });

  handle(Invoke.texCancel, z.tuple([zId]), (_e, jobId) => cancelCompile(jobId));
}

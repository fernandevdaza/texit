/**
 * DEV-ONLY scripted language model (no network, no cost) used to exercise the
 * chat UI, the tool loop, the review flow and inline AI. Only reachable when
 * `import.meta.env.DEV` (see runtime.ts).
 *
 * Agent script: read_file(main) → edit_file(one prose line) → final Markdown answer.
 */
import type { AiModel } from '@texit/ai';

type Part = Record<string, unknown> & { type: string };

const usage = (input: number, output: number) => ({
  inputTokens: { total: input, noCache: input, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: output, text: output, reasoning: undefined },
});

function chunks(text: string): string[] {
  return text.match(/\S+\s*|\s+/g) ?? [text];
}

function stream(parts: Part[], delay = 18): ReadableStream<Part> {
  let i = 0;
  return new ReadableStream<Part>({
    async pull(controller) {
      if (i >= parts.length) {
        controller.close();
        return;
      }
      const p = parts[i++];
      if (p.type === 'text-delta' || p.type === 'reasoning-delta') await new Promise((r) => setTimeout(r, delay));
      controller.enqueue(p);
    },
  });
}

function textParts(text: string, id = 't'): Part[] {
  return [{ type: 'text-start', id }, ...chunks(text).map((delta) => ({ type: 'text-delta', id, delta })), { type: 'text-end', id }];
}

function reasoningParts(text: string): Part[] {
  return [{ type: 'reasoning-start', id: 'r' }, ...chunks(text).map((delta) => ({ type: 'reasoning-delta', id: 'r', delta })), { type: 'reasoning-end', id: 'r' }];
}

function finish(reason: 'stop' | 'tool-calls', out = 40): Part {
  return { type: 'finish', finishReason: { unified: reason, raw: reason }, usage: usage(1200, out) };
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((c: any) => (c?.type === 'text' ? c.text : '')).join('\n');
}

function improveLine(line: string): string {
  let out = line
    .replace(/\bwrold\b/g, 'world')
    .replace(/\bteh\b/g, 'the')
    .replace(/\bvery\s+/gi, '')
    .replace(/ {2,}/g, ' ');
  if (out === line) out = `${line.replace(/\s+$/, '')} This sentence was refined by the mock assistant.`;
  return out;
}

function pickEdit(content: string): { search: string; replace: string } | null {
  const lines = content.split('\n');
  const prose = lines.find((l) => {
    const t = l.trim();
    return t.length > 25 && !t.startsWith('\\') && !t.startsWith('%') && /[a-zA-Z]{4,}/.test(t) && lines.filter((x) => x === l).length === 1;
  });
  if (prose) return { search: prose, replace: improveLine(prose) };
  const section = lines.find((l) => /\\(sub)*section\{[^}]+\}/.test(l) && lines.filter((x) => x === l).length === 1);
  if (section) return { search: section, replace: section.replace(/\{([^}]+)\}/, '{$1 (revised)}') };
  return null;
}

/** Strip read_file's `   12\t` prefixes. */
function stripNumbers(output: string): string {
  return output
    .split('\n')
    .slice(1)
    .filter((l) => /^\s*\d+\t/.test(l))
    .map((l) => l.replace(/^\s*\d+\t/, ''))
    .join('\n');
}

export function createMockModel(modelId = 'mock-agent'): AiModel {
  const model = {
    specificationVersion: 'v4',
    provider: 'dev-mock',
    modelId,
    supportedUrls: {},
    async doGenerate(options: any) {
      const prompt = textOf(options.prompt.find((m: any) => m.role === 'user')?.content);
      const isInline = prompt.includes('<CURSOR/>');
      const text = isInline ? ' and therefore the method converges for every admissible step size.' : 'ok';
      await new Promise((r) => setTimeout(r, 250));
      return { content: [{ type: 'text', text }], finishReason: { unified: 'stop', raw: 'stop' }, usage: usage(300, 12), warnings: [] };
    },
    async doStream(options: any) {
      const prompt: any[] = options.prompt;
      const system = prompt.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
      const toolNames = new Set<string>((options.tools ?? []).map((t: any) => t.name));
      const parts: Part[] = [{ type: 'stream-start', warnings: [] }];

      // ── Inline rewrite (Cmd-K) ──
      if (system.includes('editing engine of TexIt')) {
        const user = textOf(prompt.find((m) => m.role === 'user')?.content);
        const sel = /<selection>\n([\s\S]*?)\n<\/selection>/.exec(user)?.[1];
        const instruction = /Instruction: ([\s\S]*)$/.exec(user)?.[1] ?? '';
        let out: string;
        if (sel == null) out = '\\begin{equation}\n  e^{i\\pi} + 1 = 0\n\\end{equation}';
        else {
          const trail = /\s*$/.exec(sel)![0];
          const body = sel.slice(0, sel.length - trail.length);
          if (/translat/i.test(instruction)) out = `[translated] ${body}`;
          else if (/formal/i.test(instruction)) out = body.replace(/\bdon't\b/g, 'do not').replace(/\bcan't\b/g, 'cannot') + ' Furthermore, this formulation is rigorous.';
          else out = improveLine(body);
          out += trail;
        }
        parts.push(...textParts(out), finish('stop'));
        return { stream: stream(parts, 30) };
      }

      const lastUser = prompt.map((m) => m.role).lastIndexOf('user');
      const results = prompt
        .slice(lastUser + 1)
        .filter((m) => m.role === 'tool')
        .flatMap((m) => m.content as any[])
        .map((r) => ({ name: r.toolName as string, text: String(r.output?.value ?? '') }));
      const userText = textOf(prompt[lastUser]?.content);
      const main = /Main document: (\S+)/.exec(userText)?.[1] ?? 'main.tex';

      if (!toolNames.size) {
        parts.push(...textParts(`This is the **mock model** answering without tools. You asked:\n\n> ${userText.split('\n').pop()}`), finish('stop'));
        return { stream: stream(parts) };
      }

      const read = results.find((r) => r.name === 'read_file');
      const edit = results.find((r) => r.name === 'edit_file');

      if (!read && toolNames.has('read_file')) {
        parts.push(
          ...reasoningParts('The user wants me to work on the document. I should read the main file before changing anything.'),
          ...textParts('Let me look at the document first.'),
          { type: 'tool-call', toolCallId: `call_read_${Date.now()}`, toolName: 'read_file', input: JSON.stringify({ path: main }) },
          finish('tool-calls'),
        );
        return { stream: stream(parts) };
      }

      if (read && !edit && toolNames.has('edit_file')) {
        const change = pickEdit(stripNumbers(read.text));
        if (change) {
          parts.push(
            ...textParts('I found a sentence that can be tightened. Proposing a small edit:'),
            { type: 'tool-call', toolCallId: `call_edit_${Date.now()}`, toolName: 'edit_file', input: JSON.stringify({ path: main, ...change }) },
            finish('tool-calls'),
          );
          return { stream: stream(parts) };
        }
      }

      const rejected = edit?.text.startsWith('REJECTED');
      const summary = edit
        ? rejected
          ? 'Okay — I left the file unchanged. Tell me what you would prefer instead.'
          : `Done. I made one targeted change in \`${main}\`:\n\n- tightened a sentence (removed filler words)\n\nFor reference, the identity I mentioned is $e^{i\\pi}+1=0$, and as a display equation:\n\n$$\\int_0^1 x^2\\,dx = \\frac{1}{3}$$\n\n\`\`\`latex\n\\begin{equation}\n  E = mc^2 \\label{eq:energy}\n\\end{equation}\n\`\`\``
        : `The document **${main}** looks fine. Here is a quick summary:\n\n| Item | Value |\n|---|---|\n| Main file | \`${main}\` |\n| Mode | read-only |\n\nInline math works too: $\\alpha + \\beta = \\gamma$.`;
      parts.push(...textParts(summary), finish('stop', 120));
      return { stream: stream(parts) };
    },
  };
  return model as unknown as AiModel;
}

// Git-style word diff — compare two project files (or a file with the
// clipboard) word by word, like `git diff --word-diff`, in a modal.
// Self-contained: includes a small LCS diff over word tokens.

const { definePlugin } = window.TexIt;

/** Tokenize into words, whitespace and punctuation (so whitespace changes stay readable). */
function tokenize(s) {
  return s.match(/\s+|[\p{L}\p{N}_\\]+|[^\s\p{L}\p{N}_\\]/gu) ?? [];
}

/** Myers-ish LCS diff on token arrays (O(N·M) memory guarded by a size limit). */
export function diffWords(a, b) {
  const A = tokenize(a);
  const B = tokenize(b);
  // Trim common prefix / suffix first (cheap, and keeps the DP small).
  let start = 0;
  while (start < A.length && start < B.length && A[start] === B[start]) start++;
  let endA = A.length;
  let endB = B.length;
  while (endA > start && endB > start && A[endA - 1] === B[endB - 1]) {
    endA--;
    endB--;
  }
  const out = [];
  if (start) out.push({ type: 'same', text: A.slice(0, start).join('') });
  const a2 = A.slice(start, endA);
  const b2 = B.slice(start, endB);
  if (a2.length * b2.length > 4_000_000) {
    // Too big for the DP: report the middle as one replacement.
    if (a2.length) out.push({ type: 'del', text: a2.join('') });
    if (b2.length) out.push({ type: 'add', text: b2.join('') });
  } else {
    const n = a2.length;
    const m = b2.length;
    const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a2[i] === b2[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    let i = 0;
    let j = 0;
    const push = (type, text) => {
      const last = out[out.length - 1];
      if (last && last.type === type) last.text += text;
      else out.push({ type, text });
    };
    while (i < n && j < m) {
      if (a2[i] === b2[j]) {
        push('same', a2[i]);
        i++;
        j++;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) push('del', a2[i++]);
      else push('add', b2[j++]);
    }
    while (i < n) push('del', a2[i++]);
    while (j < m) push('add', b2[j++]);
  }
  if (endA < A.length) out.push({ type: 'same', text: A.slice(endA).join('') });
  return out;
}

function render(container, parts, title) {
  const added = parts.filter((p) => p.type === 'add').reduce((n, p) => n + (p.text.match(/\S+/g)?.length ?? 0), 0);
  const removed = parts.filter((p) => p.type === 'del').reduce((n, p) => n + (p.text.match(/\S+/g)?.length ?? 0), 0);
  const head = document.createElement('div');
  head.style.cssText = 'display:flex;gap:12px;align-items:center;font-size:12px;color:var(--tx-fg-muted);margin-bottom:8px';
  head.innerHTML = `<span style="font-family:var(--font-mono)"></span><span style="color:var(--tx-success)">+${added} words</span><span style="color:var(--tx-danger)">−${removed} words</span>`;
  head.firstChild.textContent = title;
  const pre = document.createElement('pre');
  pre.style.cssText =
    'margin:0 0 4px;max-height:62vh;overflow:auto;white-space:pre-wrap;word-break:break-word;font-family:var(--font-mono);font-size:12px;line-height:1.7;padding:12px;border-radius:8px;background:var(--tx-surface-2);color:var(--tx-fg);box-shadow:inset 0 0 0 1px var(--tx-border)';
  for (const p of parts) {
    if (p.type === 'same') {
      pre.append(document.createTextNode(p.text));
      continue;
    }
    const span = document.createElement(p.type === 'add' ? 'ins' : 'del');
    span.textContent = p.type === 'add' ? `{+${p.text}+}` : `[-${p.text}-]`;
    span.style.cssText =
      p.type === 'add'
        ? 'text-decoration:none;color:var(--tx-success);background:var(--tx-success-soft);border-radius:3px'
        : 'color:var(--tx-danger);background:var(--tx-danger-soft);border-radius:3px';
    pre.append(span);
  }
  if (!added && !removed) pre.textContent = 'The texts are identical.';
  container.append(head, pre);
}

export default definePlugin({
  id: 'org.texit.examples.worddiff',
  name: 'Word diff',
  version: '1.0.0',
  author: 'TexIt examples',
  icon: 'git-compare-arrows',
  description: 'Git-style word diff ({+added+} [-removed-]) between two project files, or between the active file and the clipboard.',
  apiVersion: '1.1.0',
  permissions: ['project:read', 'editor', 'ui'],
  tags: ['diff', 'review', 'example'],

  activate(api) {
    const textFiles = () => api.project.listFiles().filter((f) => f.isText).map((f) => f.path);
    const read = async (p) => {
      const c = await api.project.readFile(p);
      return typeof c === 'string' ? c : '';
    };

    api.commands.register({
      id: 'files',
      title: 'Word diff: compare two files…',
      category: 'Review',
      when: 'project',
      run: async () => {
        const files = textFiles();
        const active = api.editor.getActivePath();
        const a = await api.ui.quickPick(
          files.map((f) => ({ label: f, description: f === active ? 'active file' : undefined, value: f })),
          { placeholder: 'Original file' },
        );
        if (!a) return;
        const b = await api.ui.quickPick(
          files.filter((f) => f !== a).map((f) => ({ label: f, value: f })),
          { placeholder: `Compare ${a} with…` },
        );
        if (!b) return;
        const parts = diffWords(await read(a), await read(b));
        await api.ui.modal({ title: 'Word diff', width: 900, render: (el) => render(el, parts, `${a} → ${b}`) });
      },
    });

    api.commands.register({
      id: 'clipboard',
      title: 'Word diff: compare active file with clipboard',
      category: 'Review',
      when: 'editor',
      run: async () => {
        const path = api.editor.getActivePath();
        if (!path) return;
        let clip = '';
        try {
          clip = await navigator.clipboard.readText();
        } catch {
          return api.ui.toast('Clipboard access was denied', { type: 'error' });
        }
        const sel = api.editor.getSelection();
        const base = sel && sel.text ? sel.text : await read(path);
        const parts = diffWords(base, clip);
        await api.ui.modal({ title: 'Word diff', width: 900, render: (el) => render(el, parts, `${sel && sel.text ? 'selection' : path} → clipboard`) });
      },
    });
  },
});

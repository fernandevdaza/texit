/** Lorem ipsum / blindtext generator and "Insert date". */
import { definePlugin, type PluginAPI } from '@texit/plugin-api';

const LOREM_START = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.';
const WORDS = (
  'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua enim ad minim veniam quis ' +
  'nostrud exercitation ullamco laboris nisi aliquip ex ea commodo consequat duis aute irure in reprehenderit voluptate velit esse cillum fugiat nulla ' +
  'pariatur excepteur sint occaecat cupidatat non proident sunt culpa qui officia deserunt mollit anim id est laborum praesent vitae turpis viverra ' +
  'cursus mauris sagittis pellentesque habitant morbi tristique senectus netus malesuada fames ac egestas integer feugiat scelerisque varius nunc ' +
  'faucibus ornare suspendisse sed nisi lacus vestibulum mattis ullamcorper velit sed mi tempus imperdiet nulla facilisi cras fermentum odio eu'
).split(' ');

/** Deterministic-ish generator (seeded) so repeated paragraphs differ. */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

export function lorem(paragraphs: number, seed = Date.now()): string {
  const r = rng(seed);
  const pick = () => WORDS[Math.floor(r() * WORDS.length)];
  const sentence = () => {
    const n = 8 + Math.floor(r() * 10);
    const words = Array.from({ length: n }, pick);
    if (n > 10) words[Math.floor(n / 2)] += ',';
    const s = words.join(' ');
    return s[0].toUpperCase() + s.slice(1) + '.';
  };
  return Array.from({ length: paragraphs }, (_, i) => {
    const n = 4 + Math.floor(r() * 4);
    const sentences = Array.from({ length: n }, sentence);
    if (i === 0) sentences[0] = LOREM_START;
    return sentences.join(' ');
  }).join('\n\n');
}

function dateFormats(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  const iso = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return [
    { label: iso, description: 'ISO 8601', value: iso },
    { label: d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }), description: 'Long (your locale)', value: d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) },
    { label: d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }), description: 'English (US)', value: d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) },
    { label: d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }), description: 'English (UK)', value: d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) },
    { label: d.toLocaleDateString(undefined, { dateStyle: 'short' } as Intl.DateTimeFormatOptions), description: 'Short (your locale)', value: d.toLocaleDateString(undefined, { dateStyle: 'short' } as Intl.DateTimeFormatOptions) },
    { label: `${iso} ${pad(d.getHours())}:${pad(d.getMinutes())}`, description: 'Date and time', value: `${iso} ${pad(d.getHours())}:${pad(d.getMinutes())}` },
    { label: '\\today', description: 'Date of compilation (LaTeX)', value: '\\today' },
  ];
}

async function insertLorem(api: PluginAPI) {
  const choice = await api.ui.quickPick(
    [
      { label: '1 paragraph', description: 'Plain lorem ipsum text', value: 'p1' },
      { label: '3 paragraphs', description: 'Plain lorem ipsum text', value: 'p3' },
      { label: '5 paragraphs', description: 'Plain lorem ipsum text', value: 'p5' },
      { label: '1 sentence', description: 'Plain lorem ipsum text', value: 's1' },
      { label: '\\lipsum[1-3]', description: 'Command — needs \\usepackage{lipsum}', value: 'lipsum' },
      { label: '\\blindtext', description: 'Command — needs \\usepackage{blindtext}', value: 'blindtext' },
      { label: '\\Blindtext', description: 'Long text — needs \\usepackage{blindtext}', value: 'Blindtext' },
    ],
    { placeholder: 'Insert placeholder text…' },
  );
  if (!choice) return;
  let text: string;
  if (choice === 'lipsum') text = '\\lipsum[1-3]\n';
  else if (choice === 'blindtext') text = '\\blindtext\n';
  else if (choice === 'Blindtext') text = '\\Blindtext\n';
  else if (choice === 's1') text = LOREM_START + ' ';
  else text = lorem(Number(choice.slice(1))) + '\n';
  api.editor.insertText(text);
  api.editor.focus();
}

export default definePlugin({
  id: 'org.texit.textgen',
  name: 'Lorem ipsum & date',
  version: '1.0.0',
  author: 'TexIt',
  icon: 'pilcrow',
  description: 'Insert placeholder text (lorem ipsum, \\lipsum, \\blindtext) and the current date in several formats.',
  permissions: ['editor'],
  tags: ['insert', 'writing'],
  activate(api) {
    api.commands.register({ id: 'lorem', title: 'Insert lorem ipsum…', category: 'Insert', icon: 'pilcrow', when: 'editor', run: () => insertLorem(api) });
    api.commands.register({
      id: 'date',
      title: 'Insert date…',
      category: 'Insert',
      icon: 'calendar-days',
      when: 'editor',
      run: async () => {
        const v = await api.ui.quickPick(dateFormats(new Date()), { placeholder: 'Choose a date format' });
        if (v) {
          api.editor.insertText(v);
          api.editor.focus();
        }
      },
    });
  },
});

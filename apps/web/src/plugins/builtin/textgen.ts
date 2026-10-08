/** Lorem ipsum / blindtext generator and "Insert date". */
import { definePlugin, type PluginAPI } from '@texit/plugin-api';
import { createTr, type Catalog, type Tr } from './i18n';

const MESSAGES: Catalog = {
  en: {
    paragraphs_one: '{count} paragraph',
    paragraphs_other: '{count} paragraphs',
    sentence: '1 sentence',
    plain: 'Plain lorem ipsum text',
    needsPackage: 'Command — needs {pkg}',
    longNeedsPackage: 'Long text — needs {pkg}',
    placeholderText: 'Insert placeholder text…',
    long: 'Long (UI language)',
    short: 'Short (UI language)',
    enUS: 'English (US)',
    enGB: 'English (UK)',
    dateTime: 'Date and time',
    compileDate: 'Date of compilation (LaTeX)',
    chooseFormat: 'Choose a date format',
  },
  es: {
    paragraphs_one: '{count} párrafo',
    paragraphs_other: '{count} párrafos',
    sentence: '1 oración',
    plain: 'Texto lorem ipsum simple',
    needsPackage: 'Comando: requiere {pkg}',
    longNeedsPackage: 'Texto largo: requiere {pkg}',
    placeholderText: 'Insertar texto de relleno…',
    long: 'Largo (idioma de la interfaz)',
    short: 'Corto (idioma de la interfaz)',
    enUS: 'Inglés (EE. UU.)',
    enGB: 'Inglés (Reino Unido)',
    dateTime: 'Fecha y hora',
    compileDate: 'Fecha de compilación (LaTeX)',
    chooseFormat: 'Elige un formato de fecha',
  },
};

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

function dateFormats(d: Date, tr: Tr, locale: string) {
  const long = d.toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' });
  const short = d.toLocaleDateString(locale, { dateStyle: 'short' } as Intl.DateTimeFormatOptions);
  const pad = (n: number) => String(n).padStart(2, '0');
  const iso = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return [
    { label: iso, description: 'ISO 8601', value: iso },
    { label: long, description: tr('long'), value: long },
    { label: d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }), description: tr('enUS'), value: d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) },
    { label: d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }), description: tr('enGB'), value: d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) },
    { label: short, description: tr('short'), value: short },
    { label: `${iso} ${pad(d.getHours())}:${pad(d.getMinutes())}`, description: tr('dateTime'), value: `${iso} ${pad(d.getHours())}:${pad(d.getMinutes())}` },
    { label: '\\today', description: tr('compileDate'), value: '\\today' },
  ];
}

async function insertLorem(api: PluginAPI) {
  const tr = createTr(api, MESSAGES);
  const choice = await api.ui.quickPick(
    [
      { label: tr('paragraphs', { count: 1 }), description: tr('plain'), value: 'p1' },
      { label: tr('paragraphs', { count: 3 }), description: tr('plain'), value: 'p3' },
      { label: tr('paragraphs', { count: 5 }), description: tr('plain'), value: 'p5' },
      { label: tr('sentence'), description: tr('plain'), value: 's1' },
      { label: '\\lipsum[1-3]', description: tr('needsPackage', { pkg: '\\usepackage{lipsum}' }), value: 'lipsum' },
      { label: '\\blindtext', description: tr('needsPackage', { pkg: '\\usepackage{blindtext}' }), value: 'blindtext' },
      { label: '\\Blindtext', description: tr('longNeedsPackage', { pkg: '\\usepackage{blindtext}' }), value: 'Blindtext' },
    ],
    { placeholder: tr('placeholderText') },
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
  locales: {
    es: {
      name: 'Lorem ipsum y fecha',
      description: 'Inserta texto de relleno (lorem ipsum, \\lipsum, \\blindtext) y la fecha actual en varios formatos.',
      commands: { lorem: 'Insertar lorem ipsum…', date: 'Insertar fecha…' },
    },
  },
  activate(api) {
    api.commands.register({ id: 'lorem', title: 'Insert lorem ipsum…', category: 'Insert', icon: 'pilcrow', when: 'editor', run: () => insertLorem(api) });
    api.commands.register({
      id: 'date',
      title: 'Insert date…',
      category: 'Insert',
      icon: 'calendar-days',
      when: 'editor',
      run: async () => {
        const tr = createTr(api, MESSAGES);
        const v = await api.ui.quickPick(dateFormats(new Date(), tr, api.ui.getLocale()), { placeholder: tr('chooseFormat') });
        if (v) {
          api.editor.insertText(v);
          api.editor.focus();
        }
      },
    });
  },
});

#!/usr/bin/env node
// Generates the README images with a local Chrome/Chromium (puppeteer-core):
//   docs/public/banner.png, banner.es.png          README banners (scripts/brand/banner.html)
//   docs/public/screenshots/{en,es}/*.png          app screenshots
//
// Usage:  pnpm screenshots                 (banners + app screenshots)
//         ONLY=banner pnpm screenshots     (banners only — no app needed)
//         ONLY=app pnpm screenshots        (app screenshots only)
// Env:    CHROME_PATH=/path/to/chrome
//         BASE_URL=http://localhost:5173   the app to drive. Defaults to the Vite dev server: the
//                                          automation handle `window.__texit` only exists in dev builds.
//                                          Start it with `pnpm dev` (and `pnpm assets:busytex` once, so
//                                          projects can compile). If nothing answers, the script starts it.
//         LANGS=en,es                      languages to capture (default: both)
//
// Every run uses a throwaway Chrome profile (temporary userDataDir), so the projects it creates never
// touch your own browser data.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = (...p) => {
  const f = path.join(ROOT, ...p);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  return f;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ONLY = process.env.ONLY;
const BASE_URL = (process.env.BASE_URL ?? 'http://localhost:5173').replace(/\/?$/, '/');
const LANGS = (process.env.LANGS ?? 'en,es').split(',').map((s) => s.trim()).filter(Boolean);

function chromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
  ].filter(Boolean);
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) throw new Error('Chrome not found. Set CHROME_PATH.');
  return found;
}

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'texit-shots-'));
const browser = await puppeteer.launch({
  executablePath: chromePath(),
  headless: true,
  userDataDir,
  args: ['--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--allow-file-access-from-files'],
});

// ───────────────────────────────────────────────────────────── banners
async function banners() {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 480, deviceScaleFactor: 2 });
  for (const [lang, file] of [['en', 'banner.png'], ['es', 'banner.es.png']]) {
    await page.goto(pathToFileURL(path.join(ROOT, 'scripts/brand/banner.html')).href + '?lang=' + lang, { waitUntil: 'networkidle0' });
    await page.evaluate(() => document.fonts.ready);
    await sleep(300);
    await page.screenshot({ path: out('docs/public', file) });
    console.log('✓ docs/public/' + file);
  }
  await page.close();
}

// ───────────────────────────────────────────────────────────── app screenshots
async function reachable(url) {
  try {
    const res = await fetch(url);
    return res.ok;
  } catch {
    return false;
  }
}

/** Use the running dev server, or start one (killed at the end). */
async function ensureServer() {
  if (await reachable(BASE_URL)) return null;
  if (process.env.BASE_URL) throw new Error(`${BASE_URL} is not reachable`);
  console.log('… starting the dev server (pnpm dev)');
  const p = spawn('pnpm', ['--filter', '@texit/web', 'dev'], { cwd: ROOT, stdio: 'ignore', detached: process.platform !== 'win32' });
  for (let i = 0; i < 120; i++) {
    if (await reachable(BASE_URL)) return p;
    await sleep(500);
  }
  p.kill();
  throw new Error('The dev server did not start');
}

/** Click the first visible button-like element whose text or aria-label matches. */
async function click(page, text, { within = 'body', exact = false } = {}) {
  const ok = await page.evaluate(
    (text, within, exact) => {
      const roots = [...document.querySelectorAll(within)];
      const root = roots[roots.length - 1] ?? document.body;
      const els = [...root.querySelectorAll('button,[role=tab],[role=menuitem],[role=option],[role=radio],a')].filter((e) => {
        const r = e.getBoundingClientRect();
        if (!r.width || !r.height) return false;
        const t = [e.getAttribute('aria-label'), e.getAttribute('title'), e.textContent].map((s) => (s ?? '').trim().replace(/\s+/g, ' '));
        return t.some((s) => (exact ? s === text : s && s.includes(text)));
      });
      els[0]?.click();
      return !!els[0];
    },
    text,
    within,
    exact,
  );
  if (!ok) throw new Error(`click: "${text}" not found`);
  await sleep(400);
}

const cmd = (page, id, ...args) => page.evaluate((id, args) => window.__texit.commands.executeCommand(id, ...args), id, args);

async function closeOverlays(page) {
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Escape');
    await sleep(150);
  }
}

async function shot(page, lang, name) {
  await sleep(600);
  // Hide transient toasts ("TeX Live is ready", "Link copied"…) so they don't end up in the picture.
  await page.evaluate(() => document.querySelectorAll('[data-sonner-toaster]').forEach((t) => (t.style.visibility = 'hidden')));
  await page.screenshot({ path: out('docs/public/screenshots', lang, name + '.png') });
  await page.evaluate(() => document.querySelectorAll('[data-sonner-toaster]').forEach((t) => (t.style.visibility = '')));
  console.log(`✓ docs/public/screenshots/${lang}/${name}.png`);
}

/** Run one capture step; a failure is reported but does not abort the other screenshots. */
async function step(name, fn) {
  try {
    await fn();
  } catch (err) {
    console.warn(`  ⚠ ${name}: ${err.message.split('\n')[0]}`);
  }
}

/** Scroll the source editor so the shot shows LaTeX rather than the template's header comments. */
async function scrollEditorTo(page, needle) {
  await page.evaluate(async (needle) => {
    const scroller = document.querySelector('.cm-scroller');
    if (!scroller) return;
    // CodeMirror only renders the visible lines: scroll down until the line shows up.
    for (let i = 0; i < 40; i++) {
      const line = [...document.querySelectorAll('.cm-line')].find((l) => l.textContent.includes(needle));
      if (line) {
        scroller.scrollTop += line.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 12;
        return;
      }
      scroller.scrollTop += scroller.clientHeight * 0.8;
      await new Promise((r) => setTimeout(r, 120));
    }
  }, needle);
  await sleep(400);
}

/** Wait until the open project finished compiling (and the PDF had a moment to paint). */
async function waitForCompile(page, timeout = 240_000) {
  await page.waitForFunction(
    () => {
      const s = window.__texit?.workspace.useWorkspace.getState().compile?.status;
      return s === 'success' || s === 'error';
    },
    { timeout, polling: 500 },
  );
  const status = await page.evaluate(() => window.__texit.workspace.useWorkspace.getState().compile.status);
  if (status !== 'success') console.warn('  ⚠ compile finished with status', status);
  await sleep(2500);
}

/** Wait until no compile is running (opening panels can trigger an auto-compile). */
async function waitIdle(page) {
  await page
    .waitForFunction(() => !['compiling', 'preparing'].includes(window.__texit.workspace.useWorkspace.getState().compile?.status), { timeout: 120_000, polling: 300 })
    .catch(() => {});
  await sleep(800);
}

async function setSettings(page, patch) {
  await page.evaluate((patch) => window.__texit.settings.useSettings.getState().set(patch), patch);
  await sleep(300);
}

const PROJECTS = {
  en: [
    { name: 'Linear Algebra II — Lecture notes', templateId: 'math-notes', tags: ['math'] },
    { name: 'Thesis — Distributed Systems', templateId: 'thesis', tags: ['thesis'] },
    { name: 'Group meeting slides', templateId: 'beamer', tags: ['talks'] },
    { name: 'Conference paper (IEEE)', templateId: 'ieee', tags: ['papers'] },
    { name: 'Curriculum vitae', templateId: 'cv' },
    { name: 'Lab report 3 — Pendulum', templateId: 'lab-report', tags: ['physics'] },
  ],
  es: [
    { name: 'Energía solar en comunidades rurales', templateId: 'articulo-es', tags: ['artículos'] },
    { name: 'Tesis — Sistemas distribuidos', templateId: 'thesis', tags: ['tesis'] },
    { name: 'Diapositivas de la reunión', templateId: 'beamer', tags: ['charlas'] },
    { name: 'Álgebra lineal II — Apuntes', templateId: 'math-notes', tags: ['matemáticas'] },
    { name: 'Currículum', templateId: 'cv' },
    { name: 'Informe de laboratorio 3 — Péndulo', templateId: 'lab-report', tags: ['física'] },
  ],
};

async function appShots() {
  const server = await ensureServer();
  try {
    for (const lang of LANGS) {
      const ctx = await browser.createBrowserContext();
      const page = await ctx.newPage();
      await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
      await page.evaluateOnNewDocument((lang) => {
        // First-run state: chosen language, dark theme, onboarding done.
        if (!localStorage.getItem('texit:settings')) {
          localStorage.setItem('texit:settings', JSON.stringify({ state: { locale: lang, theme: 'dark', onboarded: true, userName: 'Ada Lovelace' }, version: 0 }));
        }
      }, lang);
      await page.goto(BASE_URL, { waitUntil: 'networkidle0' });
      await page.waitForFunction(() => !!window.__texit, { timeout: 30_000 });
      await setSettings(page, { locale: lang, theme: 'dark', onboarded: true, accent: 'indigo', userName: 'Ada Lovelace' });

      // Projects from templates (the throwaway profile starts empty).
      const ids = [];
      for (const p of PROJECTS[lang]) {
        ids.push(await page.evaluate((p) => window.__texit.projects.createProject(p), p));
        await sleep(150);
      }
      await page.evaluate(() => window.__texit.projects.useProjects.getState().refresh());
      await page.goto(BASE_URL + '#/', { waitUntil: 'networkidle0' });
      await sleep(1200);

      // 1. dashboard (dark + light)
      await step('dashboard', async () => {
        await shot(page, lang, 'dashboard');
        await setSettings(page, { theme: 'light' });
        await shot(page, lang, 'dashboard-light');
        await setSettings(page, { theme: 'dark' });
      });

      // 2. new-project template gallery
      await step('templates', async () => {
        await cmd(page, 'project.new');
        await sleep(900);
        await shot(page, lang, 'templates');
        await closeOverlays(page);
      });

      // 3. workspace: editor + compiled PDF (the first compile downloads/caches TeX Live in the profile)
      const openWorkspace = async () => {
        await page.goto(BASE_URL + '#/p/' + ids[0], { waitUntil: 'networkidle0' });
        await page.waitForFunction(() => !!window.__texit, { timeout: 30_000 });
        await sleep(1500);
        const status = await page.evaluate(() => window.__texit.workspace.useWorkspace.getState().compile?.status);
        if (!['compiling', 'preparing', 'success'].includes(status)) await cmd(page, 'compile.run').catch(() => {});
        await waitForCompile(page);
        await scrollEditorTo(page, '\\begin{document}');
      };
      await step('workspace', async () => {
        await openWorkspace();
        await shot(page, lang, 'workspace');
      });

      // 4. AI panel
      await step('ai', async () => {
        await cmd(page, 'view.toggleSidebar'); // give the editor room next to the panel
        await cmd(page, 'ai.openChat').catch(() => cmd(page, 'view.toggleAi'));
        await sleep(1200);
        await waitIdle(page);
        await shot(page, lang, 'ai');
        await cmd(page, 'view.toggleAi').catch(() => {});
        await cmd(page, 'view.toggleSidebar');
        await closeOverlays(page);
      });

      // 5. share / collaboration dialog
      await step('share', async () => {
        await cmd(page, 'collab.share');
        await sleep(1500);
        await shot(page, lang, 'share');
        await closeOverlays(page);
      });

      // 6. settings
      await step('settings', async () => {
        await waitIdle(page);
        await cmd(page, 'app.settings', 'appearance');
        await sleep(1200);
        await shot(page, lang, 'settings');
        await closeOverlays(page);
      });

      // 7. light theme workspace — reload with the light theme (switching live re-renders the whole PDF)
      await step('workspace-light', async () => {
        await setSettings(page, { theme: 'light' });
        await openWorkspace();
        await shot(page, lang, 'workspace-light');
        await setSettings(page, { theme: 'dark' });
      });

      // Clean up (the profile is temporary anyway).
      await step('cleanup', async () => {
        await page.goto(BASE_URL + '#/', { waitUntil: 'networkidle0' });
        await page.waitForFunction(() => !!window.__texit, { timeout: 30_000 });
        for (const id of ids) await page.evaluate((id) => window.__texit.projects.deleteProjectForever(id), id);
      });
      await ctx.close();
    }
  } finally {
    if (server) {
      try {
        process.kill(-server.pid);
      } catch {
        server.kill();
      }
    }
  }
}

try {
  if (!ONLY || ONLY === 'banner') await banners();
  if (!ONLY || ONLY === 'app') await appShots();
} finally {
  await browser.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
}

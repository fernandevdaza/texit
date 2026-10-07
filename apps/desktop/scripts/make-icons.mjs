#!/usr/bin/env node
/**
 * Generate app icons from build/icon.svg:
 *   build/icon.png  (1024×1024)     — rsvg-convert, ImageMagick or Electron fallback
 *   build/icon.icns (macOS)         — sips + iconutil (macOS only)
 *   build/icon.ico  (Windows)       — PNG-compressed ICO written by this script
 *   build/icons/<size>x<size>.png   — Linux icon set
 * and copies the SVG to apps/web/public/logo.svg.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const build = path.join(root, 'build');
const svg = path.join(build, 'icon.svg');
const has = (cmd) => {
  try {
    execFileSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

function rasterize(size, out) {
  if (has('rsvg-convert')) execFileSync('rsvg-convert', ['-w', String(size), '-h', String(size), svg, '-o', out]);
  else if (has('magick')) execFileSync('magick', ['-background', 'none', '-density', '384', svg, '-resize', `${size}x${size}`, out]);
  else throw new Error('Install librsvg (rsvg-convert) or ImageMagick to rasterize the icon.');
}

mkdirSync(path.join(build, 'icons'), { recursive: true });
rasterize(1024, path.join(build, 'icon.png'));
const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
for (const s of sizes) rasterize(s, path.join(build, 'icons', `${s}x${s}.png`));
console.log('✓ icon.png + icons/*.png');

// ── ICO (PNG entries; supported since Windows Vista) ──
const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const images = icoSizes.map((s) => readFileSync(path.join(build, 'icons', `${s}x${s}.png`)));
const header = Buffer.alloc(6 + 16 * images.length);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(images.length, 4);
let offset = header.length;
images.forEach((img, i) => {
  const s = icoSizes[i];
  const e = 6 + i * 16;
  header.writeUInt8(s >= 256 ? 0 : s, e);
  header.writeUInt8(s >= 256 ? 0 : s, e + 1);
  header.writeUInt8(0, e + 2);
  header.writeUInt8(0, e + 3);
  header.writeUInt16LE(1, e + 4);
  header.writeUInt16LE(32, e + 6);
  header.writeUInt32LE(img.length, e + 8);
  header.writeUInt32LE(offset, e + 12);
  offset += img.length;
});
writeFileSync(path.join(build, 'icon.ico'), Buffer.concat([header, ...images]));
console.log('✓ icon.ico');

// ── ICNS (macOS) ──
if (process.platform === 'darwin' && has('iconutil') && has('sips')) {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'texit-icns-'));
  const set = path.join(tmp, 'icon.iconset');
  mkdirSync(set);
  for (const s of [16, 32, 128, 256, 512]) {
    execFileSync('sips', ['-z', String(s), String(s), path.join(build, 'icon.png'), '--out', path.join(set, `icon_${s}x${s}.png`)], { stdio: 'ignore' });
    execFileSync('sips', ['-z', String(s * 2), String(s * 2), path.join(build, 'icon.png'), '--out', path.join(set, `icon_${s}x${s}@2x.png`)], { stdio: 'ignore' });
  }
  execFileSync('iconutil', ['-c', 'icns', set, '-o', path.join(build, 'icon.icns')]);
  rmSync(tmp, { recursive: true, force: true });
  console.log('✓ icon.icns');
} else if (!existsSync(path.join(build, 'icon.icns'))) {
  console.warn('! icon.icns not generated (needs macOS sips + iconutil); electron-builder can derive it from icon.png.');
}

const webLogo = path.resolve(root, '..', 'web', 'public', 'logo.svg');
mkdirSync(path.dirname(webLogo), { recursive: true });
copyFileSync(svg, webLogo);
console.log(`✓ ${path.relative(root, webLogo)}`);

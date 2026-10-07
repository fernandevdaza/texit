import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'fflate';
import { parseSyncTex, syncTexForward, syncTexInverse } from '../src/synctex';
import { resolveProjectPath } from '../src/logparser';

const BP = 65781.76; // sp per PDF point

/**
 * Hand-written synctex in the exact pdfTeX format (BusyTeX-style absolute
 * paths with "/./"), two pages, nested boxes, all record kinds, an optional
 * column field, a late Input line and a post scriptum.
 */
const SYNTHETIC = `SyncTeX Version:1
Input:1:/home/web_user/project/./main.tex
Input:2:/home/web_user/project/./chapters/intro.tex
Output:pdf
Magnification:1000
Unit:1
X Offset:0
Y Offset:0
Content:
!213
{1
[1,10:4736286,48452221:28417720,43715935,0
(1,12:4736286,6553600:28417720,655360,196608
g1,12:5000000,6553600
x1,12:6000000,6553600
k1,13:10000000,6553600:65536
$1,13:12000000,6553600
$1,13:13000000,6553600
)
[2,2:4736286,20000000:28417720,9000000,0
(2,3:4736286,13107200:28417720,655360,196608
g2,3:5000000,13107200
g2,4:15000000,13107200
(2,4:16000000,13107200:2000000,600000,100000
g2,4:16500000,13107200
)
)
]
h1,20:4736286,26214400:6553600,3276800,0
r1,21:4736286,30000000:28417720,26214,0
]
!120
}1
{2
[1,30:4736286,48452221:28417720,43715935,0
(3,2,-1:4736286,6553600:28417720,655360,196608
g3,2:5000000,6553600
)
v1,31:4736286,9000000:1000000,1000000,0
]
}2
Input:3:/home/web_user/project/./appendix.tex
!42
Postamble:
Count:21
!18
Post scriptum:
`;

describe('parseSyncTex', () => {
  const d = parseSyncTex(SYNTHETIC);

  it('reads the preamble, inputs and pages', () => {
    expect(d.inputs.get(1)).toBe('/home/web_user/project/./main.tex');
    expect(d.inputs.get(3)).toBe('/home/web_user/project/./appendix.tex');
    expect(d.magnification).toBe(1000);
    expect(d.unit).toBe(1);
    expect([...d.pages.keys()]).toEqual([1, 2]);
    expect(d.pages.get(1)!.map((b) => `${b.kind}:${b.line}`)).toEqual([
      'vbox:10', 'hbox:12', 'vbox:2', 'hbox:3', 'hbox:4', 'void-hbox:20', 'rule:21',
    ]);
    expect(d.records!.get(1)!.map((r) => `${r.kind}:${r.line}`)).toEqual([
      'glue:12', 'current:12', 'kern:13', 'math:13', 'math:13', 'glue:3', 'glue:4', 'glue:4',
    ]);
  });

  it('converts sp to top-left PDF points and tracks parents', () => {
    const [, line] = d.pages.get(1)!;
    expect(line.x).toBeCloseTo(4736286 / BP, 6);
    expect(line.x).toBeCloseTo(72, 1); // the 1in offset
    expect(line.baseline).toBeCloseTo(6553600 / BP, 6);
    expect(line.y).toBeCloseTo((6553600 - 655360) / BP, 6);
    expect(line.height).toBeCloseTo((655360 + 196608) / BP, 6);
    expect(line.width).toBeCloseTo(28417720 / BP, 6);
    expect(line.parent).toBe(0);
    expect(line.file).toBe('/home/web_user/project/./main.tex');
    const nested = d.pages.get(1)![4];
    expect(nested.parent).toBe(3);
    expect(d.records!.get(1)![2]).toMatchObject({ kind: 'kern', parent: 1 });
    expect(d.records!.get(1)![2].width).toBeCloseTo(65536 / BP, 6);
    // Late "Input:" line still resolves page 2's file.
    expect(d.pages.get(2)![1].file).toBe('/home/web_user/project/./appendix.tex');
  });

  it('accepts gzipped bytes and plain bytes', () => {
    const bytes = new TextEncoder().encode(SYNTHETIC);
    expect(parseSyncTex(gzipSync(bytes)).pages.get(1)!.length).toBe(7);
    expect(parseSyncTex(bytes).pages.get(1)!.length).toBe(7);
  });

  it('applies magnification, unit and post-scriptum offsets', () => {
    const scaled = parseSyncTex(SYNTHETIC.replace('Magnification:1000', 'Magnification:2000').replace('Unit:1', 'Unit:2'));
    expect(scaled.pages.get(1)![1].x).toBeCloseTo((4 * 4736286) / BP, 4);
    const shifted = parseSyncTex(SYNTHETIC + 'X Offset:1in\nY Offset:72.27pt\n');
    expect(shifted.xOffset).toBeCloseTo(72, 4);
    expect(shifted.yOffset).toBeCloseTo(72, 4);
    expect(shifted.pages.get(1)![1].x).toBeCloseTo(4736286 / BP + 72, 4);
  });
});

describe('syncTexForward', () => {
  const d = parseSyncTex(SYNTHETIC);
  const lines = (r: ReturnType<typeof syncTexForward>) => r.map((b) => `${b.page}:${b.kind}:${b.line}`);

  it('finds the hbox of a line (from its own record or child records)', () => {
    expect(lines(syncTexForward(d, 'main.tex', 12))).toEqual(['1:hbox:12']);
    expect(lines(syncTexForward(d, 'main.tex', 13))).toEqual(['1:hbox:12']);
    expect(lines(syncTexForward(d, './main.tex', 20))).toEqual(['1:void-hbox:20']);
  });

  it('matches files by path suffix', () => {
    expect(lines(syncTexForward(d, 'chapters/intro.tex', 3))).toEqual(['1:hbox:3']);
    // line 4 appears in the line box (glue) and in a nested \mbox: keep the visual line.
    expect(lines(syncTexForward(d, 'chapters/intro.tex', 4))).toEqual(['1:hbox:3']);
    expect(lines(syncTexForward(d, 'appendix.tex', 2))).toEqual(['2:hbox:2']);
    expect(syncTexForward(d, 'missing.tex', 1)).toEqual([]);
  });

  it('falls back to the nearest line with content', () => {
    expect(lines(syncTexForward(d, 'main.tex', 15))).toEqual(['1:hbox:12']); // 13 is nearest
    expect(lines(syncTexForward(d, 'main.tex', 17))).toEqual(['1:void-hbox:20']);
    expect(lines(syncTexForward(d, 'main.tex', 1))).toEqual(['1:hbox:12']);
  });
});

describe('syncTexInverse', () => {
  const d = parseSyncTex(SYNTHETIC);
  const y = (6553600 - 100000) / BP;

  it('refines to the closest record left of the click inside the smallest hbox', () => {
    expect(syncTexInverse(d, 1, 5500000 / BP, y)).toEqual({ file: '/home/web_user/project/./main.tex', line: 12 });
    expect(syncTexInverse(d, 1, 11000000 / BP, y)).toEqual({ file: '/home/web_user/project/./main.tex', line: 13 });
    // Nested box on line 4 of chapters/intro.tex
    expect(syncTexInverse(d, 1, 17000000 / BP, (13107200 - 100000) / BP)).toEqual({
      file: '/home/web_user/project/./chapters/intro.tex',
      line: 4,
    });
  });

  it('uses the nearest node when no box contains the point', () => {
    const r = syncTexInverse(d, 1, 74, (26214400 - 1000000) / BP);
    expect(r).toEqual({ file: '/home/web_user/project/./main.tex', line: 20 });
    expect(syncTexInverse(d, 1, 500, 790)?.line).toBe(21);
    expect(syncTexInverse(d, 9, 10, 10)).toBeNull();
  });

  it('round-trips with resolveProjectPath', () => {
    const r = syncTexInverse(d, 2, 80, 95)!;
    expect(resolveProjectPath(r.file, ['main.tex', 'appendix.tex', 'chapters/intro.tex'])).toBe('appendix.tex');
  });
});

describe('real Tectonic synctex', () => {
  const d = parseSyncTex(new Uint8Array(readFileSync(join(__dirname, 'fixtures', 'tectonic-errors.synctex.gz'))));
  it('forward and inverse search agree', () => {
    for (const [file, line] of [['main.tex', 5], ['main.tex', 6], ['chapters/one.tex', 2]] as const) {
      const boxes = syncTexForward(d, file, line);
      expect(boxes.length, `${file}:${line}`).toBeGreaterThan(0);
      const b = boxes[0];
      expect(b.x).toBeGreaterThan(72);
      expect(b.x + b.width).toBeLessThan(612);
      const back = syncTexInverse(d, b.page, b.x + 2, b.y + b.height / 2)!;
      expect(resolveProjectPath(back.file, ['main.tex', 'chapters/one.tex'])).toBe(file);
      expect(back.line).toBe(line);
    }
  });
});

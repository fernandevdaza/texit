import { describe, expect, it } from 'vitest';
import { DEFAULT_POLICY, pruneVersions, type PrunableVersion, type VersionKind } from './prune';

const H = 3600_000;
const D = 24 * H;
const NOW = Date.UTC(2026, 9, 7, 12, 0, 0);

let n = 0;
const v = (ageMs: number, kind: VersionKind = 'auto'): PrunableVersion => ({ id: `v${n++}`, createdAt: NOW - ageMs, kind });

describe('pruneVersions', () => {
  it('keeps everything younger than two hours', () => {
    const list = Array.from({ length: 20 }, (_, i) => v(i * 5 * 60_000));
    const { keep, drop } = pruneVersions(list, NOW);
    expect(keep).toHaveLength(20);
    expect(drop).toHaveLength(0);
  });

  it('keeps one automatic version per hour between 2 h and 24 h (the newest of each hour)', () => {
    // Every 10 minutes from 3h to 6h ago.
    const list = Array.from({ length: 19 }, (_, i) => v(3 * H + i * 10 * 60_000));
    const { keep } = pruneVersions(list, NOW);
    const hours = new Set(keep.map((k) => Math.floor(k.createdAt / H)));
    expect(hours.size).toBe(keep.length);
    expect(keep.length).toBeGreaterThanOrEqual(3);
    expect(keep.length).toBeLessThanOrEqual(5);
    // The newest version overall is always kept.
    expect(keep[0].createdAt).toBe(Math.max(...list.map((x) => x.createdAt)));
  });

  it('keeps one per day within two weeks and one per week after', () => {
    const daily = Array.from({ length: 10 }, (_, d) => [v(2 * D + d * D + 1 * H), v(2 * D + d * D + 5 * H)]).flat();
    const old = Array.from({ length: 8 }, (_, d) => v(30 * D + d * D));
    const { keep } = pruneVersions([...daily, ...old], NOW);
    const keptDaily = keep.filter((k) => NOW - k.createdAt < 14 * D);
    const days = new Set(keptDaily.map((k) => Math.floor(k.createdAt / D)));
    expect(days.size).toBe(keptDaily.length);
    const keptOld = keep.filter((k) => NOW - k.createdAt >= 14 * D);
    expect(keptOld.length).toBeLessThanOrEqual(2);
    expect(keptOld.length).toBeGreaterThanOrEqual(1);
  });

  it('never prunes named versions', () => {
    const named = Array.from({ length: 30 }, (_, i) => v(40 * D + i * H, 'named'));
    const { keep } = pruneVersions([v(0), ...named], NOW);
    expect(keep.filter((k) => k.kind === 'named')).toHaveLength(30);
  });

  it('keeps safety copies for a day, then thins them like automatic versions', () => {
    const fresh = [v(3 * H, 'safety'), v(3 * H + 60_000, 'safety')];
    const stale = [v(3 * D, 'safety'), v(3 * D + 60_000, 'safety')];
    const { keep } = pruneVersions([v(0), ...fresh, ...stale], NOW);
    expect(keep.filter((k) => fresh.includes(k))).toHaveLength(2);
    expect(keep.filter((k) => stale.includes(k))).toHaveLength(1);
  });

  it('caps the number of automatic versions', () => {
    const list = Array.from({ length: 50 }, (_, i) => v(i * 60_000));
    const { keep, drop } = pruneVersions(list, NOW, { ...DEFAULT_POLICY, maxAuto: 10 });
    expect(keep).toHaveLength(11); // newest + 10
    expect(drop).toHaveLength(39);
    // Dropped ones are the oldest.
    expect(Math.min(...keep.map((k) => k.createdAt))).toBeGreaterThan(Math.max(...drop.map((d) => d.createdAt)));
  });

  it('is stable: pruning an already pruned list drops nothing', () => {
    const list = Array.from({ length: 200 }, (_, i) => v(i * 37 * 60_000));
    const first = pruneVersions(list, NOW);
    const second = pruneVersions(first.keep, NOW);
    expect(second.drop).toHaveLength(0);
  });
});

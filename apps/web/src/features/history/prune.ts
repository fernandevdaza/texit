/**
 * Retention policy for automatic versions (pure, unit-tested).
 *
 *  - Named versions are never pruned.
 *  - The newest version is always kept.
 *  - Automatic versions are thinned by age, keeping the newest version of each
 *    absolute time bucket (stable between runs):
 *        < 2 h   → keep all
 *        < 24 h  → one per hour
 *        < 14 d  → one per day
 *        older   → one per week
 *  - Safety versions (taken before a restore) are kept for at least 24 h.
 *  - At most `maxAuto` automatic versions overall (oldest dropped first).
 */

export type VersionKind = 'auto' | 'open' | 'named' | 'safety' | 'checkpoint';

export interface PrunableVersion {
  id: string;
  createdAt: number;
  kind: VersionKind;
}

const H = 3600_000;
const D = 24 * H;

export interface PrunePolicy {
  tiers: { maxAge: number; bucket: number }[];
  maxAuto: number;
  safetyKeepMs: number;
}

export const DEFAULT_POLICY: PrunePolicy = {
  tiers: [
    { maxAge: 2 * H, bucket: 0 },
    { maxAge: D, bucket: H },
    { maxAge: 14 * D, bucket: D },
    { maxAge: Infinity, bucket: 7 * D },
  ],
  maxAuto: 200,
  safetyKeepMs: D,
};

export function pruneVersions<T extends PrunableVersion>(versions: T[], now = Date.now(), policy: PrunePolicy = DEFAULT_POLICY): { keep: T[]; drop: T[] } {
  const sorted = [...versions].sort((a, b) => b.createdAt - a.createdAt);
  const keep = new Set<T>();
  const seenBuckets = new Set<string>();
  sorted.forEach((v, i) => {
    if (v.kind === 'named') return void keep.add(v);
    const age = now - v.createdAt;
    const tierIdx = policy.tiers.findIndex((t) => age < t.maxAge);
    const tier = policy.tiers[tierIdx < 0 ? policy.tiers.length - 1 : tierIdx];
    const key = tier.bucket ? `${tierIdx}:${Math.floor(v.createdAt / tier.bucket)}` : null;
    // The newest version is always kept (and occupies its bucket).
    const forced = i === 0 || !key || (v.kind === 'safety' && age < policy.safetyKeepMs);
    // Iterating newest → oldest: the first version seen in a bucket is its newest one.
    if (forced || !seenBuckets.has(key!)) {
      keep.add(v);
      if (key) seenBuckets.add(key);
    }
  });
  // Cap the number of automatic versions.
  let autos = 0;
  for (const v of sorted) {
    if (!keep.has(v) || v.kind === 'named' || v === sorted[0]) continue;
    if (++autos > policy.maxAuto) keep.delete(v);
  }
  return { keep: sorted.filter((v) => keep.has(v)), drop: sorted.filter((v) => !keep.has(v)) };
}

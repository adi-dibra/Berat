import { rootDomain } from './domain';

export interface Group<T> {
  /** Stable key, the domain for domain groups. */
  key: string;
  label: string;
  items: T[];
  /** True for the bucket that collects groups below the minimum size. */
  isOther?: boolean;
}

export type BelowMinMode = 'other' | 'hide';

export interface GroupOptions {
  minSize: number;
  belowMin: BelowMinMode;
}

export interface GroupResult<T> {
  groups: Group<T>[];
  /** Items left out because their group was below the minimum and belowMin is "hide". */
  hiddenCount: number;
  totalCount: number;
}

export const OTHER_KEY = '\u0000other';

/**
 * Groups items by root domain in a single pass over the items, then splits
 * the buckets by size. Groups are ordered largest first, ties by name; the
 * "Other" bucket is always last.
 */
export function groupByDomain<T>(
  items: readonly T[],
  getUrl: (item: T) => string | undefined,
  opts: GroupOptions,
): GroupResult<T> {
  return groupBy(items, (it) => rootDomain(getUrl(it)), opts);
}

export function groupBy<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  opts: GroupOptions,
): GroupResult<T> {
  const buckets = new Map<string, T[]>();
  for (const it of items) {
    const k = keyOf(it);
    const b = buckets.get(k);
    if (b) b.push(it);
    else buckets.set(k, [it]);
  }

  const min = Math.max(1, Math.floor(opts.minSize));
  const groups: Group<T>[] = [];
  const small: T[][] = [];
  let hiddenCount = 0;
  for (const [key, list] of buckets) {
    if (list.length >= min) groups.push({ key, label: key, items: list });
    else if (opts.belowMin === 'other') small.push(list);
    else hiddenCount += list.length;
  }
  groups.sort((a, b) => b.items.length - a.items.length || a.label.localeCompare(b.label));

  if (small.length) {
    // Small buckets are concatenated in order of first appearance.
    groups.push({ key: OTHER_KEY, label: 'Other', items: small.flat(), isOther: true });
  }
  return { groups, hiddenCount, totalCount: items.length };
}

/** Case-insensitive substring filter on title and URL. Empty query keeps everything. */
export function filterItems<T extends { title?: string; url?: string }>(
  items: readonly T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return items as T[];
  const terms = q.split(/\s+/);
  const out: T[] = [];
  for (const it of items) {
    const hay = ((it.title ?? '') + '\n' + (it.url ?? '')).toLowerCase();
    if (terms.every((t) => hay.includes(t))) out.push(it);
  }
  return out;
}

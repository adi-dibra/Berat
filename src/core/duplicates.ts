import { normalizeUrl, type NormalizeRules } from './normalize';

export interface DuplicateSet<T> {
  /** Normalized URL shared by the set. */
  key: string;
  keep: T;
  remove: T[];
}

/**
 * Groups items by normalized URL (one pass) and, for every URL that occurs
 * more than once, picks the item to keep. Sets come out in order of first
 * occurrence.
 */
export function findDuplicates<T>(
  items: readonly T[],
  urlOf: (item: T) => string | undefined,
  rules: NormalizeRules,
  pickKeeper: (candidates: T[]) => T,
): DuplicateSet<T>[] {
  const byKey = new Map<string, T[]>();
  for (const it of items) {
    const url = urlOf(it);
    if (!url) continue;
    const key = normalizeUrl(url, rules);
    const list = byKey.get(key);
    if (list) list.push(it);
    else byKey.set(key, [it]);
  }
  const sets: DuplicateSet<T>[] = [];
  for (const [key, list] of byKey) {
    if (list.length < 2) continue;
    const keep = pickKeeper(list);
    sets.push({ key, keep, remove: list.filter((x) => x !== keep) });
  }
  return sets;
}

interface TabLike { active?: boolean; pinned?: boolean; index: number }

/** Keep the active tab, else a pinned one, else the leftmost. */
export function tabKeeper<T extends TabLike>(tabs: T[]): T {
  let best = tabs[0];
  const score = (t: T) => (t.active ? 2 : 0) + (t.pinned ? 1 : 0);
  for (const t of tabs) {
    const d = score(t) - score(best);
    if (d > 0 || (d === 0 && t.index < best.index)) best = t;
  }
  return best;
}

interface BookmarkLike { id: string; dateAdded?: number }

/** Keep the oldest bookmark (ties: the lower id, which Chrome assigns in creation order). */
export function bookmarkKeeper<T extends BookmarkLike>(bookmarks: T[]): T {
  let best = bookmarks[0];
  for (const b of bookmarks) {
    const d = (b.dateAdded ?? Infinity) - (best.dateAdded ?? Infinity);
    if (d < 0 || (d === 0 && Number(b.id) < Number(best.id))) best = b;
  }
  return best;
}

/** Tabs whose page is already bookmarked, with the matching (oldest) bookmark. */
export function tabsAlreadyBookmarked<T, B extends BookmarkLike & { url: string }>(
  tabs: readonly T[],
  tabUrl: (t: T) => string | undefined,
  bookmarks: readonly B[],
  rules: NormalizeRules,
): { tab: T; bookmark: B }[] {
  const byKey = new Map<string, B>();
  for (const b of bookmarks) {
    const key = normalizeUrl(b.url, rules);
    const prev = byKey.get(key);
    if (!prev || bookmarkKeeper([prev, b]) === b) byKey.set(key, b);
  }
  const out: { tab: T; bookmark: B }[] = [];
  for (const t of tabs) {
    const url = tabUrl(t);
    if (!url) continue;
    const b = byKey.get(normalizeUrl(url, rules));
    if (b) out.push({ tab: t, bookmark: b });
  }
  return out;
}

/**
 * Performance test: 5,000 tabs and 20,000 bookmarks generated into the fake
 * chrome API, timing every step of the data pipeline the side panel runs.
 * Run with `npm run perf`; results are printed and written to perf-results/.
 *
 * The fake API answers instantly, so these numbers are the extension's own
 * cost (grouping, normalizing, syncing), not Chrome's IPC time.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { flattenFolder } from '../../src/actions/bookmarkActions';
import { BookmarkStore } from '../../src/chrome/bookmarkStore';
import { TabStore } from '../../src/chrome/tabStore';
import { bookmarkKeeper, findDuplicates, tabKeeper, tabsAlreadyBookmarked } from '../../src/core/duplicates';
import { planFlatten } from '../../src/core/flatten';
import { filterItems, groupByDomain } from '../../src/core/grouping';
import { DEFAULT_RULES } from '../../src/core/normalize';
import { FakeChrome, seedBookmarks, seedTabs } from '../../src/mock/fakeChrome';

const TABS = 5_000;
const BOOKMARKS = 20_000;
const results: { step: string; ms: number; note?: string }[] = [];

async function time<T>(step: string, fn: () => T | Promise<T>, note?: string): Promise<T> {
  const t0 = performance.now();
  const out = await fn();
  results.push({ step, ms: performance.now() - t0, note });
  return out;
}

/** Median of several runs, for steps that are fast enough to repeat. */
async function median(step: string, runs: number, fn: () => unknown, note?: string) {
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    await fn();
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  results.push({ step, ms: times[Math.floor(runs / 2)], note: note ?? `median of ${runs}` });
}

describe(`perf: ${TABS} tabs, ${BOOKMARKS} bookmarks`, () => {
  const fake = new FakeChrome();
  seedTabs(fake, TABS);
  seedBookmarks(fake, BOOKMARKS);
  const tabStore = new TabStore(fake.api, 0);
  const bmStore = new BookmarkStore(fake.api, 0);

  it('loads and groups', async () => {
    await time('Tab store: initial load (1 tabs.query)', () => tabStore.start());
    await time('Bookmark store: initial load (1 getTree)', () => bmStore.start());
    const tabs = tabStore.list();
    const bms = bmStore.bookmarksUnder();
    expect(tabs).toHaveLength(TABS);
    expect(bms).toHaveLength(BOOKMARKS);

    const opts = { minSize: 2, belowMin: 'other' as const };
    await time('Group 5,000 tabs by domain (cold PSL cache)', () => groupByDomain(tabs, (t) => t.url, opts));
    await median('Group 5,000 tabs by domain (warm)', 9, () => groupByDomain(tabs, (t) => t.url, opts));
    await time('Group 20,000 bookmarks by domain (cold)', () => groupByDomain(bms, (b) => b.url, opts));
    await median('Group 20,000 bookmarks by domain (warm)', 9, () => groupByDomain(bms, (b) => b.url, opts));
    await median('Filter 20,000 bookmarks by "github"', 9, () => filterItems(bms, 'github'));
    await median('List bookmark folders for the picker', 9, () => {
      bmStore.version++; // bypass the cache
      return bmStore.folders();
    });
    await median('Collect 20,000 bookmarks from the tree', 9, () => {
      bmStore.version++;
      return bmStore.bookmarksUnder();
    });
  });

  it('finds duplicates', async () => {
    const tabs = tabStore.list();
    const bms = bmStore.bookmarksUnder();
    let n = 0;
    await median('Duplicate tabs (5,000)', 5, () => (n = findDuplicates(tabs, (t) => t.url, DEFAULT_RULES, tabKeeper).length));
    results[results.length - 1].note += `, ${n} sets`;
    await median('Duplicate bookmarks (20,000)', 5, () => (n = findDuplicates(bms, (b) => b.url, DEFAULT_RULES, bookmarkKeeper).length));
    results[results.length - 1].note += `, ${n} sets`;
    await median('Tabs already bookmarked (5,000 × 20,000)', 5, () => (n = tabsAlreadyBookmarked(tabs, (t) => t.url, bms, DEFAULT_RULES).length));
    results[results.length - 1].note += `, ${n} tabs`;
  });

  it('stays in sync through a burst of 1,000 tab closes', async () => {
    const ids = tabStore.list().slice(100, 1100).map((t) => t.id!);
    let notified = 0;
    const off = tabStore.subscribe(() => notified++);
    await time('Apply 1,000 tabs.onRemoved events + re-list', async () => {
      await fake.api.tabs.remove(ids);
      await new Promise((r) => setTimeout(r, 0));
      return tabStore.list();
    });
    off();
    expect(tabStore.list()).toHaveLength(TABS - 1000);
    expect(tabStore.list().map((t) => t.index)).toEqual(fake.windowTabs().map((t) => t.index));
    results[results.length - 1].note = `${notified} subscriber notification(s)`;
  });

  it('flattens the largest folder', async () => {
    const bar = bmStore.subtree('1')!;
    const plan = await time('Plan flatten of "Bookmarks bar"', () => planFlatten(bar));
    results[results.length - 1].note = `${plan.moved.length} bookmarks, ${plan.folders.length} folders`;
    await time('Run flatten against the fake API', () => flattenFolder(fake.api, '1'), 'includes fake API overhead');
    await new Promise((r) => setTimeout(r, 0));
    await time('Bookmark store catches up with the move events', () => bmStore.bookmarksUnder('1'));
    expect(bmStore.bookmarksUnder('1')).toHaveLength(plan.moved.length + (bar.children ?? []).filter((c) => c.url).length);
  });

  afterAll(() => {
    const table = [
      `| Step | Time (ms) | Notes |`,
      `| --- | ---: | --- |`,
      ...results.map((r) => `| ${r.step} | ${r.ms.toFixed(1)} | ${r.note ?? ''} |`),
    ].join('\n');
    console.log(`\nPerformance with ${TABS} tabs and ${BOOKMARKS} bookmarks (Node ${process.version}):\n\n${table}\n`);
    mkdirSync('perf-results', { recursive: true });
    writeFileSync('perf-results/core.md', table + '\n');
    writeFileSync('perf-results/core.json', JSON.stringify({ node: process.version, tabs: TABS, bookmarks: BOOKMARKS, results }, null, 2));
  });
});

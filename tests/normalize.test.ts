import { describe, expect, it } from 'vitest';
import { bookmarkKeeper, findDuplicates, tabKeeper, tabsAlreadyBookmarked } from '../src/core/duplicates';
import { DEFAULT_RULES, normalizeUrl, type NormalizeRules } from '../src/core/normalize';

const n = (url: string, rules: Partial<NormalizeRules> = {}) => normalizeUrl(url, { ...DEFAULT_RULES, ...rules });

describe('normalizeUrl (defaults)', () => {
  it('lowercases the host but not the path', () => {
    expect(n('https://WWW.Example.COM/Some/Path')).toBe('www.example.com/Some/Path');
  });
  it('treats http and https as the same', () => {
    expect(n('http://example.com/a')).toBe(n('https://example.com/a'));
  });
  it('drops trailing slashes and the fragment', () => {
    expect(n('https://example.com/a/')).toBe('example.com/a');
    expect(n('https://example.com/')).toBe('example.com');
    expect(n('https://example.com')).toBe('example.com');
    expect(n('https://example.com/a#section')).toBe('example.com/a');
  });
  it('strips utm_*, fbclid, gclid and similar, keeping other params in order', () => {
    expect(n('https://example.com/a?utm_source=x&id=5&UTM_Medium=y&fbclid=abc&gclid=1&b=2')).toBe('example.com/a?id=5&b=2');
    expect(n('https://example.com/a?utm_source=x')).toBe('example.com/a');
  });
  it('keeps default and explicit ports apart correctly', () => {
    expect(n('https://example.com:443/a')).toBe('example.com/a');
    expect(n('https://example.com:8443/a')).toBe('example.com:8443/a');
  });
  it('leaves non-web URLs alone except for the fragment', () => {
    expect(n('chrome://settings/#privacy')).toBe('chrome://settings/');
    expect(n('file:///C:/doc.pdf')).toBe('file:///C:/doc.pdf');
    expect(n('not a url')).toBe('not a url');
  });
});

describe('normalizeUrl (configurable)', () => {
  it('can keep the scheme, fragment, trailing slash and tracking params', () => {
    const keepAll = { ignoreScheme: false, stripFragment: false, stripTrailingSlash: false, stripTracking: false };
    expect(n('https://example.com/a/?utm_source=x#top', keepAll)).toBe('https://example.com/a/?utm_source=x#top');
    expect(n('http://example.com/a', keepAll)).not.toBe(n('https://example.com/a', keepAll));
  });
  it('supports custom tracking params, www stripping, query sorting and ignoring the query', () => {
    expect(n('https://example.com/?ref=hn&a=1', { trackingParams: ['ref'] })).toBe('example.com?a=1');
    expect(n('https://www.example.com/a', { stripWww: true })).toBe('example.com/a');
    expect(n('https://example.com/?b=2&a=1', { sortQuery: true })).toBe(n('https://example.com/?a=1&b=2', { sortQuery: true }));
    expect(n('https://example.com/a?x=1', { ignoreQuery: true })).toBe('example.com/a');
  });
});

describe('findDuplicates', () => {
  const tabs = [
    { id: 1, index: 0, url: 'https://a.com/x', active: false, pinned: false },
    { id: 2, index: 1, url: 'http://a.com/x/?utm_source=t', active: true, pinned: false },
    { id: 3, index: 2, url: 'https://a.com/x#y', active: false, pinned: true },
    { id: 4, index: 3, url: 'https://b.com/', active: false, pinned: false },
    { id: 5, index: 4, url: 'https://b.com', active: false, pinned: false },
    { id: 6, index: 5, url: 'https://c.com', active: false, pinned: false },
  ];
  it('finds sets and keeps the active tab', () => {
    const sets = findDuplicates(tabs, (t) => t.url, DEFAULT_RULES, tabKeeper);
    expect(sets.map((s) => [s.key, s.keep.id, s.remove.map((r) => r.id)])).toEqual([
      ['a.com/x', 2, [1, 3]],
      ['b.com', 4, [5]],
    ]);
  });
  it('prefers pinned when nothing is active, then the leftmost', () => {
    expect(tabKeeper([{ index: 3 }, { index: 1, pinned: true }, { index: 0 }]).index).toBe(1);
    expect(tabKeeper([{ index: 3 }, { index: 1 }]).index).toBe(1);
  });
  it('keeps the oldest bookmark', () => {
    const bms = [
      { id: '10', url: 'https://a.com', dateAdded: 300 },
      { id: '11', url: 'https://a.com/', dateAdded: 100 },
      { id: '12', url: 'http://a.com', dateAdded: 100 },
    ];
    const [set] = findDuplicates(bms, (b) => b.url, DEFAULT_RULES, bookmarkKeeper);
    expect(set.keep.id).toBe('11');
    expect(set.remove.map((b) => b.id)).toEqual(['10', '12']);
  });
  it('finds tabs that are already bookmarked', () => {
    const bms = [{ id: '1', url: 'https://a.com/x', dateAdded: 1 }, { id: '2', url: 'https://z.com', dateAdded: 1 }];
    const hits = tabsAlreadyBookmarked(tabs, (t) => t.url, bms, DEFAULT_RULES);
    expect(hits.map((h) => [h.tab.id, h.bookmark.id])).toEqual([[1, '1'], [2, '1'], [3, '1']]);
  });
});

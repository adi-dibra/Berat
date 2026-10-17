import { describe, expect, it } from 'vitest';
import { colorFor, GROUP_COLORS } from '../src/core/color';
import { filterItems, groupByDomain, OTHER_KEY } from '../src/core/grouping';

const items = [
  'https://github.com/a', 'https://gist.github.com/b', 'https://github.com/c',
  'https://news.bbc.co.uk/1', 'https://www.bbc.co.uk/2',
  'https://foo.github.io/', 'https://example.com/',
].map((url, i) => ({ id: i, url, title: `T${i}` }));
const url = (x: { url: string }) => x.url;

describe('groupByDomain', () => {
  it('groups by root domain, largest first', () => {
    const r = groupByDomain(items, url, { minSize: 1, belowMin: 'other' });
    expect(r.groups.map((g) => [g.key, g.items.length])).toEqual([
      ['github.com', 3], ['bbc.co.uk', 2], ['example.com', 1], ['foo.github.io', 1],
    ]);
    expect(r.totalCount).toBe(7);
  });

  it('puts groups below the minimum into Other, last', () => {
    const r = groupByDomain(items, url, { minSize: 2, belowMin: 'other' });
    expect(r.groups.map((g) => g.key)).toEqual(['github.com', 'bbc.co.uk', OTHER_KEY]);
    const other = r.groups[2];
    expect(other.isOther).toBe(true);
    expect(other.items.map((i) => i.id)).toEqual([5, 6]);
    expect(r.hiddenCount).toBe(0);
  });

  it('hides groups below the minimum when asked', () => {
    const r = groupByDomain(items, url, { minSize: 3, belowMin: 'hide' });
    expect(r.groups.map((g) => g.key)).toEqual(['github.com']);
    expect(r.hiddenCount).toBe(4);
  });

  it('keeps item order inside a group', () => {
    const r = groupByDomain(items, url, { minSize: 1, belowMin: 'other' });
    expect(r.groups[0].items.map((i) => i.id)).toEqual([0, 1, 2]);
  });

  it('treats minSize below 1 as 1 and handles empty input', () => {
    expect(groupByDomain([], url, { minSize: 0, belowMin: 'other' }).groups).toEqual([]);
    expect(groupByDomain(items, url, { minSize: 0, belowMin: 'hide' }).groups).toHaveLength(4);
  });
});

describe('filterItems', () => {
  it('matches title and URL, case-insensitively, all terms', () => {
    expect(filterItems(items, 'GITHUB').map((i) => i.id)).toEqual([0, 1, 2, 5]);
    expect(filterItems(items, 'github t1').map((i) => i.id)).toEqual([1]);
    expect(filterItems(items, '  ')).toHaveLength(7);
  });
});

describe('colorFor', () => {
  it('is deterministic and always a Chrome group color', () => {
    expect(colorFor('github.com')).toBe(colorFor('github.com'));
    for (const d of ['a.com', 'b.org', 'bbc.co.uk', '']) expect(GROUP_COLORS).toContain(colorFor(d));
    const spread = new Set(Array.from({ length: 200 }, (_, i) => colorFor(`site${i}.com`)));
    expect(spread.size).toBe(GROUP_COLORS.length);
  });
});

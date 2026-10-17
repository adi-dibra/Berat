import { describe, expect, it } from 'vitest';
import { BookmarkStore } from '../src/chrome/bookmarkStore';
import { FakeChrome } from '../src/mock/fakeChrome';

const settle = () => new Promise((r) => setTimeout(r, 5));

function shapeOf(store: BookmarkStore, id: string): unknown {
  const n = store.nodes.get(id)!;
  return n.url !== undefined ? n.title : [n.title, n.children!.map((c) => shapeOf(store, c))];
}

describe('BookmarkStore', () => {
  it('loads once and stays in sync with create, move, change and remove', async () => {
    const fake = new FakeChrome();
    const f = fake.seedBookmark('1', 'F');
    fake.seedBookmark(f, 'a', 'https://a.com');
    fake.seedBookmark('2', 'b', 'https://b.com');
    const store = new BookmarkStore(fake.api, 0);
    await store.start();
    expect(store.bookmarksUnder().map((b) => b.title)).toEqual(['a', 'b']);

    const c = await fake.api.bookmarks.create({ parentId: f, index: 0, title: 'c', url: 'https://c.com' });
    const g = await fake.api.bookmarks.create({ parentId: '2', title: 'G' });
    await fake.api.bookmarks.move(c.id, { parentId: g.id });
    await fake.api.bookmarks.update(c.id, { title: 'c2' });
    await fake.api.bookmarks.removeTree(f);
    await settle();
    expect(fake.calls['bookmarks.getTree']).toBe(1);

    const truth = (await fake.api.bookmarks.getTree())[0];
    const want = (n: chrome.bookmarks.BookmarkTreeNode): unknown =>
      n.url !== undefined ? n.title : [n.title, (n.children ?? []).map(want)];
    expect(shapeOf(store, '0')).toEqual(want(truth));
    expect(store.bookmarksUnder().map((b) => b.title)).toEqual(['b', 'c2']);
  });

  it('lists folders with paths and scopes bookmarks to a folder', async () => {
    const fake = new FakeChrome();
    const f = fake.seedBookmark('1', 'Work');
    const g = fake.seedBookmark(f, 'Docs');
    fake.seedBookmark(g, 'x', 'https://x.com');
    fake.seedBookmark('2', 'y', 'https://y.com');
    const store = new BookmarkStore(fake.api, 0);
    await store.start();
    expect(store.folders().map((x) => [x.path, x.depth])).toEqual([
      ['Bookmarks bar', 0], ['Bookmarks bar / Work', 1], ['Bookmarks bar / Work / Docs', 2],
      ['Other bookmarks', 0], ['Mobile bookmarks', 0],
    ]);
    expect(store.bookmarksUnder(f).map((b) => b.title)).toEqual(['x']);
  });
});

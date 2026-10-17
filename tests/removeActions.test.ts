import { describe, expect, it } from 'vitest';
import { closeTabs, deleteBookmarks, reopenTabs, restoreBookmarks } from '../src/actions/removeActions';
import { FakeChrome } from '../src/mock/fakeChrome';

describe('close tabs + undo', () => {
  it('closes only tabs in the given window and reopens them in place, regrouped', async () => {
    const fake = new FakeChrome();
    const ids = ['https://a.com', 'https://b.com', 'https://c.com', 'https://d.com'].map((url) => fake.seedTab({ url }));
    fake.seedGroup(fake.currentWindowId, [ids[1], ids[2]], 'G', 'red');
    fake.addWindow(2);
    const foreign = fake.seedTab({ url: 'https://foreign.com', windowId: 2 });
    const r = await closeTabs(fake.api, fake.currentWindowId, [ids[1], ids[3], foreign], 'Close duplicates');
    expect(r.message).toBe('Closed 2 tabs.');
    expect(fake.windowTabs(2)).toHaveLength(1);
    expect(fake.windowTabs().map((t) => t.url)).toEqual(['https://a.com', 'https://c.com']);
    await reopenTabs(fake.api, r.undo as Extract<typeof r.undo, { kind: 'closedTabs' }>);
    const after = fake.windowTabs();
    expect(after.map((t) => t.url)).toEqual(['https://a.com', 'https://b.com', 'https://c.com', 'https://d.com']);
    expect(after[1].groupId).toBe(after[2].groupId);
    expect(after[1].groupId).not.toBe(-1);
  });
});

describe('delete bookmarks + undo', () => {
  it('deletes bookmarks but never folders, and restores them at their positions', async () => {
    const fake = new FakeChrome();
    const f = fake.seedBookmark('1', 'F');
    const ids = ['a', 'b', 'c', 'd'].map((t) => fake.seedBookmark(f, t, `https://${t}.com`));
    const r = await deleteBookmarks(fake.api, [ids[0], ids[2], f], 'Delete duplicates');
    expect(r.message).toBe('Deleted 2 bookmarks.');
    const titles = async () => (await fake.api.bookmarks.getChildren(f)).map((c) => c.title);
    expect(await titles()).toEqual(['b', 'd']);
    await restoreBookmarks(fake.api, r.undo as Extract<typeof r.undo, { kind: 'deletedBookmarks' }>);
    expect(await titles()).toEqual(['a', 'b', 'c', 'd']);
  });
});

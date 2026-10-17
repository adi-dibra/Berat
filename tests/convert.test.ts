import { describe, expect, it } from 'vitest';
import { folderToTabGroup, tabGroupToFolder } from '../src/actions/convertActions';
import { colorFor } from '../src/core/color';
import { FakeChrome } from '../src/mock/fakeChrome';

describe('tab group -> bookmark folder', () => {
  it('creates a folder named after the group with a bookmark per tab, in order', async () => {
    const fake = new FakeChrome();
    const ids = ['https://a.com/1', 'https://b.com/2', 'https://c.com/3'].map((url, i) => fake.seedTab({ url, title: `T${i}` }));
    fake.seedTab({ url: 'https://not-in-group.com' });
    const gid = fake.seedGroup(fake.currentWindowId, [ids[0], ids[2]], 'Reading');
    const r = await tabGroupToFolder(fake.api, fake.currentWindowId, gid);
    expect(r.message).toBe('Saved 2 tabs to the bookmark folder "Reading" in "Other bookmarks".');
    const other = (await fake.api.bookmarks.getSubTree('2'))[0];
    const folder = other.children!.find((c) => c.title === 'Reading')!;
    expect(folder.children!.map((c) => [c.title, c.url])).toEqual([['T0', 'https://a.com/1'], ['T2', 'https://c.com/3']]);
    expect(r.undo).toEqual({ kind: 'createdFolder', label: 'Save group "Reading" as bookmarks', folderId: folder.id });
  });

  it('refuses a group from another window', async () => {
    const fake = new FakeChrome();
    fake.addWindow(2);
    const t = fake.seedTab({ url: 'https://x.com', windowId: 2 });
    const gid = fake.seedGroup(2, [t], 'X');
    await expect(tabGroupToFolder(fake.api, fake.currentWindowId, gid)).rejects.toThrow(/another window/);
  });
});

describe('bookmark folder -> tab group', () => {
  it('opens every bookmark (incl. subfolders) in the current window and groups them', async () => {
    const fake = new FakeChrome();
    fake.seedTab({ url: 'https://existing.com', active: true });
    const f = fake.seedBookmark('1', 'Research');
    fake.seedBookmark(f, 'a', 'https://a.com');
    fake.seedBookmark(fake.seedBookmark(f, 'Sub'), 'b', 'https://b.com');
    fake.seedBookmark(f, 'bad', 'javascript:alert(1)');
    const r = await folderToTabGroup(fake.api, fake.currentWindowId, f);
    expect(r.message).toBe('Opened 2 tabs in the group "Research" (1 could not be opened).');
    const tabs = fake.windowTabs();
    expect(tabs.map((t) => t.url)).toEqual(['https://existing.com', 'https://a.com', 'https://b.com']);
    expect(tabs[0].active).toBe(true);
    const [g] = await fake.api.tabGroups.query({ windowId: fake.currentWindowId });
    expect(g.title).toBe('Research');
    expect(g.color).toBe(colorFor('Research'));
    expect(tabs.slice(1).every((t) => t.groupId === g.id)).toBe(true);
  });
});

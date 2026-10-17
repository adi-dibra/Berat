import { describe, expect, it } from 'vitest';
import { handleRequest } from '../src/background/handler';
import { FakeChrome } from '../src/mock/fakeChrome';
import { sanitize } from '../src/panel/settings';
import { UNDO_KEY, type StoredUndo } from '../src/shared/types';

function setup() {
  const fake = new FakeChrome();
  for (const url of ['https://a.com/1', 'https://a.com/2', 'https://b.com/1', 'https://b.com/2', 'https://a.com/1']) fake.seedTab({ url });
  const f = fake.seedBookmark('1', 'F');
  fake.seedBookmark(fake.seedBookmark(f, 'Sub'), 'x', 'https://x.com');
  return { fake, api: fake.api, w: fake.currentWindowId, f };
}
const stack = async (fake: FakeChrome) => ((await fake.api.storage.session.get(UNDO_KEY))[UNDO_KEY] as StoredUndo[]) ?? [];

describe('undo through the service worker handler', () => {
  it('records bulk actions in storage.session and undoes them newest first', async () => {
    const { fake, api, w, f } = setup();
    const r1 = await handleRequest(api, { type: 'groupAll', windowId: w, minSize: 2 });
    const r2 = await handleRequest(api, { type: 'closeTabs', windowId: w, tabIds: [5], label: 'Close 1 duplicate tab' });
    const r3 = await handleRequest(api, { type: 'flattenFolder', folderId: f });
    expect([r1.undoId, r2.undoId, r3.undoId].every(Boolean)).toBe(true);
    expect((await stack(fake)).map((s) => s.entry.kind)).toEqual(['regroup', 'closedTabs', 'flatten']);

    const u3 = await handleRequest(api, { type: 'undo' });
    expect(u3.message).toMatch(/^Undid "Flatten "F""/);
    expect((await api.bookmarks.getChildren(f)).map((c) => c.title)).toEqual(['Sub']);

    const u2 = await handleRequest(api, { type: 'undo', id: r2.undoId });
    expect(u2.message).toContain('Reopened 1 of 1 tabs');
    expect(fake.windowTabs()).toHaveLength(5);

    await handleRequest(api, { type: 'undo' });
    // The reopened tab has a new id, so it keeps the group it was restored into; the rest are ungrouped again.
    expect(fake.windowTabs().filter((t) => t.groupId !== -1).map((t) => t.url)).toEqual(['https://a.com/1']);
    expect(await stack(fake)).toEqual([]);
    expect((await handleRequest(api, { type: 'undo' })).message).toBe('Nothing to undo.');
  });

  it('keeps at most 20 entries', async () => {
    const { fake, api, w } = setup();
    for (let i = 0; i < 25; i++) {
      await handleRequest(api, { type: 'groupAll', windowId: w, minSize: 1 });
      await handleRequest(api, { type: 'ungroup', windowId: w, groupIds: null });
    }
    expect(await stack(fake)).toHaveLength(20);
  });

  it('undoes opening a folder as a tab group and saving a group as a folder', async () => {
    const { fake, api, w, f } = setup();
    const r = await handleRequest(api, { type: 'folderToGroup', windowId: w, folderId: f });
    expect(fake.windowTabs()).toHaveLength(6);
    const [g] = await api.tabGroups.query({ windowId: w });
    const s = await handleRequest(api, { type: 'groupToFolder', windowId: w, groupId: g.id });
    expect((await api.bookmarks.getChildren('2')).map((c) => c.title)).toEqual(['F']);
    await handleRequest(api, { type: 'undo', id: s.undoId });
    expect(await api.bookmarks.getChildren('2')).toEqual([]);
    await handleRequest(api, { type: 'undo', id: r.undoId });
    expect(fake.windowTabs()).toHaveLength(5);
  });
});

describe('settings', () => {
  it('fills defaults and clamps bad values', () => {
    const s = sanitize({ minSize: 500, mode: 'bogus' as never, rules: { ignoreScheme: false } as never });
    expect(s.minSize).toBe(50);
    expect(s.mode).toBe('tabs');
    expect(s.rules.ignoreScheme).toBe(false);
    expect(s.rules.stripTracking).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import * as A from '../src/actions/tabActions';
import { colorFor } from '../src/core/color';
import { FakeChrome } from '../src/mock/fakeChrome';

function setup() {
  const fake = new FakeChrome();
  const urls = [
    'https://github.com/1', 'https://a.com/1', 'https://github.com/2', 'https://b.com/1',
    'https://news.bbc.co.uk/1', 'https://github.com/3', 'https://www.bbc.co.uk/2', 'https://c.com/1',
  ];
  fake.seedTab({ url: 'https://github.com/pinned', pinned: true });
  for (const url of urls) fake.seedTab({ url });
  fake.addWindow(2);
  fake.seedTab({ url: 'https://github.com/other-window', windowId: 2 });
  return { fake, api: fake.api, w: fake.currentWindowId };
}

const groupsOf = (fake: FakeChrome) => {
  const out = new Map<number, string[]>();
  for (const t of fake.windowTabs()) {
    if (t.groupId === -1) continue;
    out.set(t.groupId, [...(out.get(t.groupId) ?? []), t.url]);
  }
  return out;
};

describe('tab actions', () => {
  it('groups one domain, skipping pinned tabs, with title and deterministic color', async () => {
    const { fake, api, w } = setup();
    const r = await A.groupDomain(api, w, 'github.com');
    expect(r.message).toContain('3 github.com tabs');
    expect(r.message).toContain('1 pinned skipped');
    const [g] = await api.tabGroups.query({ windowId: w });
    expect(g.title).toBe('github.com');
    expect(g.color).toBe(colorFor('github.com'));
    expect([...groupsOf(fake).values()][0]).toEqual(['https://github.com/1', 'https://github.com/2', 'https://github.com/3']);
    // Other window untouched.
    expect(fake.windowTabs(2)[0].groupId).toBe(-1);
  });

  it('reuses an existing group with the same title', async () => {
    const { fake, api, w } = setup();
    await A.groupDomain(api, w, 'github.com');
    await api.tabs.create({ url: 'https://github.com/4' });
    await A.groupDomain(api, w, 'github.com');
    expect(await api.tabGroups.query({ windowId: w })).toHaveLength(1);
    expect([...groupsOf(fake).values()][0]).toHaveLength(4);
  });

  it('group all respects the minimum size', async () => {
    const { fake, api, w } = setup();
    await A.groupAllDomains(api, w, 2);
    const titles = (await api.tabGroups.query({ windowId: w })).map((g) => g.title).sort();
    expect(titles).toEqual(['bbc.co.uk', 'github.com']);
    expect(fake.windowTabs().filter((t) => t.groupId === -1).map((t) => t.url)).toEqual(
      expect.arrayContaining(['https://a.com/1', 'https://b.com/1', 'https://c.com/1']),
    );
  });

  it('collapses and expands all or one group', async () => {
    const { api, w } = setup();
    await A.groupAllDomains(api, w, 2);
    await A.setCollapsed(api, w, null, true);
    expect((await api.tabGroups.query({ windowId: w })).every((g) => g.collapsed)).toBe(true);
    const [first] = await api.tabGroups.query({ windowId: w });
    await A.setCollapsed(api, w, [first.id], false);
    const after = await api.tabGroups.query({ windowId: w });
    expect(after.find((g) => g.id === first.id)!.collapsed).toBe(false);
    expect(after.filter((g) => g.collapsed)).toHaveLength(1);
  });

  it('sorts groups by size in both directions, after pinned tabs', async () => {
    const { fake, api, w } = setup();
    await A.groupAllDomains(api, w, 1);
    await A.sortGroupsBySize(api, w, false);
    const order = () => {
      const seen: string[] = [];
      const groups = new Map<number, string>();
      return api.tabGroups.query({ windowId: w }).then((gs) => {
        for (const g of gs) groups.set(g.id, g.title!);
        for (const t of fake.windowTabs()) if (t.groupId !== -1 && !seen.includes(groups.get(t.groupId)!)) seen.push(groups.get(t.groupId)!);
        return seen;
      });
    };
    const desc = await order();
    expect(desc.slice(0, 2)).toEqual(['github.com', 'bbc.co.uk']);
    expect(fake.windowTabs()[0].pinned).toBe(true);
    await A.sortGroupsBySize(api, w, true);
    const asc = await order();
    expect(asc.slice(-2)).toEqual(['bbc.co.uk', 'github.com']);
    // Groups stay contiguous.
    const ids = fake.windowTabs().map((t) => t.groupId).filter((g) => g !== -1);
    const runs = ids.filter((g, i) => i === 0 || ids[i - 1] !== g);
    expect(new Set(runs).size).toBe(runs.length);
  });

  it('ungroups all and the undo snapshot restores groups', async () => {
    const { fake, api, w } = setup();
    await A.groupAllDomains(api, w, 2);
    await A.setCollapsed(api, w, null, true);
    const r = await A.ungroup(api, w, null);
    expect(await api.tabGroups.query({ windowId: w })).toHaveLength(0);
    expect(r.undo?.kind).toBe('regroup');
    await A.restoreGroups(api, r.undo as Extract<typeof r.undo, { kind: 'regroup' }>);
    const groups = await api.tabGroups.query({ windowId: w });
    expect(groups.map((g) => g.title).sort()).toEqual(['bbc.co.uk', 'github.com']);
    expect(groups.every((g) => g.collapsed)).toBe(true);
    expect(groupsOf(fake).size).toBe(2);
  });

  it('ungroups a single group', async () => {
    const { api, w } = setup();
    await A.groupAllDomains(api, w, 2);
    const [g] = await api.tabGroups.query({ windowId: w });
    await A.ungroup(api, w, [g.id]);
    expect(await api.tabGroups.query({ windowId: w })).toHaveLength(1);
  });
});

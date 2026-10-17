import { describe, expect, it } from 'vitest';
import { TabStore } from '../src/chrome/tabStore';
import { FakeChrome } from '../src/mock/fakeChrome';

const settle = () => new Promise((r) => setTimeout(r, 5));

async function setup() {
  const fake = new FakeChrome();
  for (let i = 0; i < 6; i++) fake.seedTab({ url: `https://s${i % 3}.com/${i}` });
  fake.addWindow(2);
  fake.seedTab({ url: 'https://elsewhere.com', windowId: 2 });
  const store = new TabStore(fake.api, 0);
  await store.start();
  return { fake, store };
}

const strip = (s: TabStore) => s.list().map((t) => [t.id, t.index]);
const truth = (f: FakeChrome) => f.windowTabs().map((t) => [t.id, t.index]);

describe('TabStore', () => {
  it('loads only the current window with one tabs.query', async () => {
    const { fake, store } = await setup();
    expect(store.list()).toHaveLength(6);
    expect(fake.calls['tabs.query']).toBe(1);
    expect(store.list().every((t) => t.windowId === fake.currentWindowId)).toBe(true);
  });

  it('tracks creates, removes and moves without re-querying', async () => {
    const { fake, store } = await setup();
    await fake.api.tabs.create({ url: 'https://new.com', index: 2, active: false });
    await fake.api.tabs.remove(1);
    await fake.api.tabs.move(6, { index: 0 });
    await fake.api.tabs.move(2, { index: -1 });
    await settle();
    expect(strip(store)).toEqual(truth(fake));
    expect(fake.calls['tabs.query']).toBe(1);
  });

  it('tracks grouping, group moves and ungrouping', async () => {
    const { fake, store } = await setup();
    const gid = await fake.api.tabs.group({ tabIds: [1, 4, 6] });
    await fake.api.tabGroups.update(gid, { title: 'x' });
    await fake.api.tabGroups.move(gid, { index: -1 });
    await settle();
    expect(strip(store)).toEqual(truth(fake));
    expect(store.groups.get(gid)?.title).toBe('x');
    expect(store.list().filter((t) => t.groupId === gid).map((t) => t.id)).toEqual([1, 4, 6]);
    await fake.api.tabs.ungroup([1, 4, 6]);
    await settle();
    expect(store.groups.size).toBe(0);
  });

  it('ignores events from other windows', async () => {
    const { fake, store } = await setup();
    await fake.api.tabs.create({ url: 'https://w2.com', windowId: 2 });
    await settle();
    expect(store.list()).toHaveLength(6);
  });

  it('tracks the active tab', async () => {
    const { fake, store } = await setup();
    await fake.api.tabs.update(3, { active: true });
    await settle();
    expect(store.list().filter((t) => t.active).map((t) => t.id)).toEqual([3]);
  });

  it('notifies subscribers once per burst', async () => {
    const fake = new FakeChrome();
    for (let i = 0; i < 50; i++) fake.seedTab({ url: `https://a.com/${i}` });
    const store = new TabStore(fake.api, 20);
    await store.start();
    await new Promise((r) => setTimeout(r, 40));
    let n = 0;
    store.subscribe(() => n++);
    await fake.api.tabs.remove(Array.from({ length: 40 }, (_, i) => i + 1));
    await new Promise((r) => setTimeout(r, 60));
    expect(n).toBe(1);
    expect(store.list()).toHaveLength(10);
  });
});

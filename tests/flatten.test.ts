import { describe, expect, it } from 'vitest';
import { flattenFolder, undoFlatten } from '../src/actions/bookmarkActions';
import { planFlatten, planUnflatten, type TreeNode } from '../src/core/flatten';
import { FakeChrome } from '../src/mock/fakeChrome';

const tree: TreeNode = {
  id: 'R', title: 'Root', children: [
    { id: 'b1', title: 'b1', url: 'https://1' },
    { id: 'F1', title: 'F1', children: [
      { id: 'b2', title: 'b2', url: 'https://2' },
      { id: 'F2', title: 'F2', children: [{ id: 'b3', title: 'b3', url: 'https://3' }] },
      { id: 'b4', title: 'b4', url: 'https://4' },
    ] },
    { id: 'b5', title: 'b5', url: 'https://5' },
    { id: 'F3', title: 'F3', children: [] },
  ],
};

describe('planFlatten', () => {
  it('collects nested bookmarks depth-first and all subfolders pre-order', () => {
    const p = planFlatten(tree);
    expect(p.moved.map((m) => m.id)).toEqual(['b2', 'b3', 'b4']);
    expect(p.moved.map((m) => [m.parentId, m.index])).toEqual([['F1', 0], ['F2', 0], ['F1', 2]]);
    expect(p.folders.map((f) => f.id)).toEqual(['F1', 'F2', 'F3']);
    expect(p.topFolders).toEqual(['F1', 'F3']);
  });

  it('does nothing for a folder without subfolders', () => {
    const p = planFlatten({ id: 'X', title: 'X', children: [{ id: 'a', title: 'a', url: 'u' }] });
    expect(p.moved).toEqual([]);
    expect(p.folders).toEqual([]);
  });
});

describe('planUnflatten', () => {
  it('restores parents before children, children in index order', () => {
    const p = planFlatten(tree);
    const steps = planUnflatten('R', p.folders, p.moved);
    expect(steps.map((s) => (s.op === 'createFolder' ? `+${s.oldId}` : s.id))).toEqual(['+F1', '+F3', 'b2', '+F2', 'b4', 'b3']);
  });
});

/** Tree as nested [title, children] / title strings, for readable comparisons. */
type Shape = string | [string, Shape[]];
function shape(n: chrome.bookmarks.BookmarkTreeNode): Shape {
  return n.url !== undefined ? n.title : [n.title, (n.children ?? []).map(shape)];
}

function seed() {
  const fake = new FakeChrome();
  const top = fake.seedBookmark('1', 'Top');
  fake.seedBookmark(top, 'a', 'https://a');
  const f1 = fake.seedBookmark(top, 'F1');
  fake.seedBookmark(f1, 'b', 'https://b');
  const f2 = fake.seedBookmark(f1, 'F2');
  fake.seedBookmark(f2, 'c', 'https://c');
  fake.seedBookmark(f2, 'd', 'https://d');
  fake.seedBookmark(f1, 'e', 'https://e');
  fake.seedBookmark(top, 'f', 'https://f');
  const f3 = fake.seedBookmark(top, 'F3');
  fake.seedBookmark(fake.seedBookmark(f3, 'F4'), 'g', 'https://g');
  fake.seedBookmark('1', 'outside', 'https://outside');
  return { fake, top };
}

describe('flattenFolder (against the fake bookmarks API)', () => {
  it('moves every nested bookmark into the folder and removes subfolders', async () => {
    const { fake, top } = seed();
    const r = await flattenFolder(fake.api, top);
    expect(r.message).toBe('Moved 5 bookmarks into "Top" and removed 4 subfolders.');
    const [node] = await fake.api.bookmarks.getSubTree(top);
    expect(shape(node)).toEqual(['Top', ['a', 'f', 'b', 'c', 'd', 'e', 'g']]);
    // Siblings outside the folder are untouched.
    const [bar] = await fake.api.bookmarks.getSubTree('1');
    expect(bar.children!.map((c) => c.title)).toEqual(['Top', 'outside']);
  });

  it('undo restores the exact original tree', async () => {
    const { fake, top } = seed();
    const before = shape((await fake.api.bookmarks.getSubTree('1'))[0]);
    const r = await flattenFolder(fake.api, top);
    await undoFlatten(fake.api, r.undo as Extract<typeof r.undo, { kind: 'flatten' }>);
    expect(shape((await fake.api.bookmarks.getSubTree('1'))[0])).toEqual(before);
  });

  it('undo skips bookmarks deleted in the meantime', async () => {
    const { fake, top } = seed();
    const r = await flattenFolder(fake.api, top);
    const [node] = await fake.api.bookmarks.getSubTree(top);
    await fake.api.bookmarks.remove(node.children!.find((c) => c.title === 'c')!.id);
    const msg = await undoFlatten(fake.api, r.undo as Extract<typeof r.undo, { kind: 'flatten' }>);
    expect(msg).toContain('1 no longer exist');
    const [after] = await fake.api.bookmarks.getSubTree(top);
    expect(shape(after)).toEqual(['Top', ['a', ['F1', ['b', ['F2', ['d']], 'e']], 'f', ['F3', [['F4', ['g']]]]]]);
  });
});

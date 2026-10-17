import type { ActionResult, ClosedTab, SavedNode, UndoEntry } from '../shared/types';

type Api = typeof chrome;

/**
 * Closes tabs in one window, recording what undo needs (URL, position,
 * pinned state, group). Tab ids from other windows are ignored.
 */
export async function closeTabs(api: Api, windowId: number, tabIds: number[], label: string): Promise<ActionResult> {
  const wanted = new Set(tabIds);
  const tabs = (await api.tabs.query({ windowId })).filter((t) => t.id !== undefined && wanted.has(t.id));
  if (!tabs.length) return { message: 'Nothing to close.' };
  const groups = new Map((await api.tabGroups.query({ windowId })).map((g) => [g.id, g]));
  const saved: ClosedTab[] = tabs
    .sort((a, b) => a.index - b.index)
    .map((t) => {
      const g = t.groupId !== -1 ? groups.get(t.groupId) : undefined;
      return {
        url: t.url || t.pendingUrl || 'chrome://newtab/',
        index: t.index,
        pinned: !!t.pinned,
        ...(g ? { group: { title: g.title ?? '', color: g.color } } : {}),
      };
    });
  await api.tabs.remove(tabs.map((t) => t.id!));
  return {
    message: `Closed ${tabs.length} tab${tabs.length === 1 ? '' : 's'}.`,
    undo: { kind: 'closedTabs', label, windowId, tabs: saved },
  };
}

/** Re-opens closed tabs at their old positions (left to right) and puts them back into groups by title and color. */
export async function reopenTabs(api: Api, e: Extract<UndoEntry, { kind: 'closedTabs' }>): Promise<string> {
  const groupsByKey = new Map<string, number>();
  for (const g of await api.tabGroups.query({ windowId: e.windowId })) groupsByKey.set(`${g.title}\u0000${g.color}`, g.id);
  let opened = 0;
  for (const t of e.tabs) {
    try {
      const tab = await api.tabs.create({ windowId: e.windowId, url: t.url, index: t.index, pinned: t.pinned, active: false });
      opened++;
      if (t.group && tab.id !== undefined && !t.pinned) {
        const key = `${t.group.title}\u0000${t.group.color}`;
        const existing = groupsByKey.get(key);
        if (existing !== undefined) {
          try {
            await api.tabs.group({ groupId: existing, tabIds: tab.id });
            // Joining a group appends the tab to it; put it back where it was.
            await api.tabs.move(tab.id, { index: t.index });
            continue;
          } catch {
            groupsByKey.delete(key); // that group is gone, create a new one below
          }
        }
        const id = await api.tabs.group({ tabIds: tab.id, createProperties: { windowId: e.windowId } });
        await api.tabGroups.update(id, { title: t.group.title, color: t.group.color as chrome.tabGroups.Color });
        groupsByKey.set(key, id);
      }
    } catch {
      // Some URLs (e.g. chrome://crash) can't be reopened by extensions.
    }
  }
  return `Reopened ${opened} of ${e.tabs.length} tabs.`;
}

function save(n: chrome.bookmarks.BookmarkTreeNode): SavedNode {
  return {
    parentId: n.parentId!, index: n.index ?? 0, title: n.title,
    ...(n.url !== undefined ? { url: n.url } : { children: (n.children ?? []).map(save) }),
  };
}

/** Deletes bookmarks (never folders), recording them for undo. */
export async function deleteBookmarks(api: Api, ids: string[], label: string): Promise<ActionResult> {
  // Record every position before deleting anything, so undo can restore in index order.
  const found: [string, SavedNode][] = [];
  for (const id of ids) {
    try {
      const [node] = await api.bookmarks.get(id);
      if (node.url !== undefined) found.push([id, save(node)]);
    } catch {
      // already gone
    }
  }
  const nodes: SavedNode[] = [];
  for (const [id, saved] of found) {
    try {
      await api.bookmarks.remove(id);
      nodes.push(saved);
    } catch {
      // removed meanwhile
    }
  }
  return {
    message: `Deleted ${nodes.length} bookmark${nodes.length === 1 ? '' : 's'}.`,
    undo: nodes.length ? { kind: 'deletedBookmarks', label, nodes } : undefined,
  };
}

/**
 * Re-creates deleted bookmarks (and folder subtrees). Items are restored per
 * parent in ascending index order so original positions come back.
 */
export async function restoreBookmarks(api: Api, e: Extract<UndoEntry, { kind: 'deletedBookmarks' }>): Promise<string> {
  const sorted = [...e.nodes].sort((a, b) => (a.parentId === b.parentId ? a.index - b.index : a.parentId < b.parentId ? -1 : 1));
  let restored = 0;
  let lost = 0;
  const sizes = new Map<string, number>();
  const create = async (n: SavedNode, parentId: string, index?: number) => {
    const size = sizes.get(parentId) ?? (await api.bookmarks.getChildren(parentId)).length;
    const node = await api.bookmarks.create({ parentId, index: index === undefined ? undefined : Math.min(index, size), title: n.title, url: n.url });
    sizes.set(parentId, size + 1);
    if (n.children) sizes.set(node.id, 0);
    restored++;
    for (const c of n.children ?? []) await create(c, node.id);
  };
  for (const n of sorted) {
    try {
      await create(n, n.parentId, n.index);
    } catch {
      lost++; // parent folder no longer exists
    }
  }
  return `Restored ${restored} bookmark${restored === 1 ? '' : 's'}${lost ? ` (${lost} whose folder is gone were skipped)` : ''}.`;
}

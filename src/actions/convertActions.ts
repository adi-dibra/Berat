import { colorFor } from '../core/color';
import type { TreeNode } from '../core/flatten';
import type { ActionResult } from '../shared/types';

type Api = typeof chrome;

/** Above this many tabs the panel asks before opening a folder. */
export const OPEN_CONFIRM_THRESHOLD = 50;

/** "Other bookmarks", where new folders go by default. */
export async function otherBookmarksId(api: Api): Promise<string> {
  const top = await api.bookmarks.getChildren('0');
  const other = top.find((n) => (n as { folderType?: string }).folderType === 'other') ?? top[1] ?? top[0];
  return other.id;
}

/** Creates a bookmark folder named after a native tab group, with one bookmark per tab, in tab order. */
export async function tabGroupToFolder(api: Api, windowId: number, groupId: number, parentId?: string): Promise<ActionResult> {
  const group = await api.tabGroups.get(groupId);
  if (group.windowId !== windowId) throw new Error('That tab group is in another window.');
  const tabs = (await api.tabs.query({ windowId, groupId })).sort((a, b) => a.index - b.index);
  const title = group.title || 'Untitled group';
  const parent = parentId ?? (await otherBookmarksId(api));
  const folder = await api.bookmarks.create({ parentId: parent, title });
  let n = 0;
  for (const t of tabs) {
    const url = t.url || t.pendingUrl;
    if (!url) continue;
    await api.bookmarks.create({ parentId: folder.id, title: t.title || url, url });
    n++;
  }
  const [parentNode] = await api.bookmarks.get(parent);
  return {
    message: `Saved ${n} tabs to the bookmark folder "${title}" in "${parentNode.title}".`,
    undo: { kind: 'createdFolder', label: `Save group "${title}" as bookmarks`, folderId: folder.id },
  };
}

/** All bookmark URLs under a folder, depth-first. */
export function folderUrls(root: TreeNode): string[] {
  const out: string[] = [];
  const walk = (n: TreeNode) => {
    for (const c of n.children ?? []) {
      if (c.url !== undefined) out.push(c.url);
      else walk(c);
    }
  };
  walk(root);
  return out;
}

/** URLs Chrome refuses to open from an extension. */
const UNOPENABLE = /^(javascript:|chrome:\/\/(kill|hang|crash|quit|restart)|about:(crash|hang))/i;

/**
 * Opens every bookmark in the folder (including subfolders) as background
 * tabs at the end of the current window and puts them in a native tab group
 * named after the folder. The panel asks first when there are many.
 */
export async function folderToTabGroup(api: Api, windowId: number, folderId: string): Promise<ActionResult> {
  const [root] = await api.bookmarks.getSubTree(folderId);
  const urls = folderUrls(root as TreeNode);
  if (!urls.length) return { message: `"${root.title}" has no bookmarks to open.` };
  const tabIds: number[] = [];
  let failed = 0;
  for (const url of urls) {
    if (UNOPENABLE.test(url)) { failed++; continue; }
    try {
      const tab = await api.tabs.create({ windowId, url, active: false });
      if (tab.id !== undefined) tabIds.push(tab.id);
    } catch {
      failed++;
    }
  }
  if (!tabIds.length) return { message: `None of the ${urls.length} bookmarks could be opened.` };
  const title = root.title || 'Bookmarks';
  const groupId = await api.tabs.group({ tabIds: tabIds as [number, ...number[]], createProperties: { windowId } });
  await api.tabGroups.update(groupId, { title, color: colorFor(title) as chrome.tabGroups.Color });
  return {
    message: `Opened ${tabIds.length} tabs in the group "${title}"${failed ? ` (${failed} could not be opened)` : ''}.`,
    undo: { kind: 'openedTabs', label: `Open "${title}" as tab group`, windowId, tabIds },
  };
}

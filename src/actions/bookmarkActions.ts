import { planFlatten, planUnflatten, type TreeNode } from '../core/flatten';
import type { ActionResult, UndoEntry } from '../shared/types';

type Api = typeof chrome;

async function subtree(api: Api, id: string): Promise<TreeNode> {
  const [node] = await api.bookmarks.getSubTree(id);
  return node as TreeNode;
}

function containsBookmarks(n: TreeNode): string[] {
  const out: string[] = [];
  const walk = (x: TreeNode) => {
    for (const c of x.children ?? []) {
      if (c.url !== undefined) out.push(c.id);
      else walk(c);
    }
  };
  walk(n);
  return out;
}

/**
 * Moves every bookmark nested in the folder's subfolders directly into the
 * folder and removes the emptied subfolders. Subfolders are removed only once
 * they hold no bookmarks, re-checked right before removal.
 */
export async function flattenFolder(api: Api, folderId: string): Promise<ActionResult> {
  const root = await subtree(api, folderId);
  if (root.url !== undefined) throw new Error('Not a folder.');
  const plan = planFlatten(root);
  if (!plan.folders.length) return { message: `"${root.title}" has no subfolders.` };

  for (const m of plan.moved) await api.bookmarks.move(m.id, { parentId: folderId });
  let late = 0;
  for (const id of plan.topFolders) {
    // A bookmark added to a subfolder while we were moving must not be deleted.
    const left = containsBookmarks(await subtree(api, id));
    for (const b of left) {
      const [node] = await api.bookmarks.get(b);
      plan.moved.push({ id: b, parentId: node.parentId!, index: node.index ?? 0 });
      await api.bookmarks.move(b, { parentId: folderId });
      late++;
    }
    await api.bookmarks.removeTree(id);
  }
  const n = plan.moved.length;
  return {
    message: `Moved ${n} bookmark${n === 1 ? '' : 's'} into "${root.title}" and removed ${plan.folders.length} subfolder${plan.folders.length === 1 ? '' : 's'}${late ? ` (${late} added during the operation)` : ''}.`,
    undo: { kind: 'flatten', label: `Flatten "${root.title}"`, folderId, folders: plan.folders, moved: plan.moved },
  };
}

/** Re-creates the removed subfolders and moves bookmarks back where they were. */
export async function undoFlatten(api: Api, e: Extract<UndoEntry, { kind: 'flatten' }>): Promise<string> {
  const idMap = new Map<string, string>([[e.folderId, e.folderId]]);
  // Re-created folders start empty, so we know their size without asking Chrome.
  const filled = new Map<string, number>();
  let moved = 0;
  let missing = 0;
  for (const s of planUnflatten(e.folderId, e.folders, e.moved)) {
    const parentId = idMap.get(s.parentOldId);
    if (!parentId) { missing++; continue; }
    const size = filled.get(parentId) ?? (await api.bookmarks.getChildren(parentId)).length;
    const index = Math.min(s.index, size);
    if (s.op === 'createFolder') {
      const node = await api.bookmarks.create({ parentId, index, title: s.title });
      idMap.set(s.oldId, node.id);
      filled.set(node.id, 0);
    } else {
      try {
        await api.bookmarks.move(s.id, { parentId, index });
        moved++;
      } catch {
        missing++; // deleted since
        continue;
      }
    }
    if (filled.has(parentId)) filled.set(parentId, size + 1);
  }
  return `Restored ${e.folders.length} folders and ${moved} bookmarks${missing ? ` (${missing} no longer exist)` : ''}.`;
}

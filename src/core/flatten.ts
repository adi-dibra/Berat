import type { FlattenedFolder, MovedBookmark } from '../shared/types';

/** The parts of a bookmark tree node the flatten logic needs. */
export interface TreeNode {
  id: string;
  parentId?: string;
  index?: number;
  title: string;
  url?: string;
  children?: TreeNode[];
}

export interface FlattenPlan {
  folderId: string;
  /** Bookmarks inside subfolders, in depth-first order. They are appended to the folder in this order. */
  moved: MovedBookmark[];
  /** Every subfolder, pre-order (parents before children). */
  folders: FlattenedFolder[];
  /** Direct subfolders of the target; removing these removes all the others. */
  topFolders: string[];
}

/**
 * Plans "ungroup all" for a bookmark folder: every bookmark nested in its
 * subfolders moves up directly into the folder (after the bookmarks already
 * there, keeping depth-first order) and the emptied subfolders are removed.
 */
export function planFlatten(root: TreeNode): FlattenPlan {
  const plan: FlattenPlan = { folderId: root.id, moved: [], folders: [], topFolders: [] };
  const walk = (folder: TreeNode) => {
    folder.children?.forEach((c, i) => {
      if (c.url !== undefined) {
        plan.moved.push({ id: c.id, parentId: folder.id, index: c.index ?? i });
      } else {
        plan.folders.push({ id: c.id, parentId: folder.id, index: c.index ?? i, title: c.title });
        walk(c);
      }
    });
  };
  root.children?.forEach((c, i) => {
    if (c.url === undefined) {
      plan.topFolders.push(c.id);
      plan.folders.push({ id: c.id, parentId: root.id, index: c.index ?? i, title: c.title });
      walk(c);
    }
  });
  return plan;
}

export type UnflattenStep =
  | { op: 'createFolder'; oldId: string; parentOldId: string; index: number; title: string }
  | { op: 'move'; id: string; parentOldId: string; index: number };

/**
 * Steps that undo a flatten. Folders get new ids when re-created, so steps
 * refer to parents by their old id and the executor maps them. Children of
 * each folder are restored in ascending index order, parents first, so
 * every insert index is valid when it runs.
 */
export function planUnflatten(folderId: string, folders: FlattenedFolder[], moved: MovedBookmark[]): UnflattenStep[] {
  const byParent = new Map<string, UnflattenStep[]>();
  const add = (parent: string, s: UnflattenStep) => {
    const list = byParent.get(parent);
    if (list) list.push(s);
    else byParent.set(parent, [s]);
  };
  for (const f of folders) add(f.parentId, { op: 'createFolder', oldId: f.id, parentOldId: f.parentId, index: f.index, title: f.title });
  for (const m of moved) add(m.parentId, { op: 'move', id: m.id, parentOldId: m.parentId, index: m.index });

  const steps: UnflattenStep[] = [];
  const queue = [folderId];
  while (queue.length) {
    const parent = queue.shift()!;
    const children = (byParent.get(parent) ?? []).sort((a, b) => a.index - b.index);
    for (const s of children) {
      steps.push(s);
      if (s.op === 'createFolder') queue.push(s.oldId);
    }
  }
  return steps;
}

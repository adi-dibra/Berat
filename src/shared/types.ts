/** Types shared by the side panel and the service worker. */

export interface SavedGroup {
  title: string;
  color: string;
  collapsed: boolean;
  tabIds: number[];
}

export interface ClosedTab {
  url: string;
  index: number;
  pinned: boolean;
  group?: { title: string; color: string };
}

/** A bookmark or folder as it was before deletion, with its subtree. */
export interface SavedNode {
  parentId: string;
  index: number;
  title: string;
  url?: string;
  children?: SavedNode[];
}

/** A folder removed by flattening, recorded in pre-order so parents come first. */
export interface FlattenedFolder {
  id: string;
  parentId: string;
  index: number;
  title: string;
}

/** A bookmark moved by flattening and where it lived before. */
export interface MovedBookmark {
  id: string;
  parentId: string;
  index: number;
}

/** What an undo entry needs to put things back. Labels are shown in the panel. */
export type UndoEntry =
  | { kind: 'regroup'; label: string; windowId: number; groups: SavedGroup[]; ungrouped: number[] }
  | { kind: 'closedTabs'; label: string; windowId: number; tabs: ClosedTab[] }
  | { kind: 'deletedBookmarks'; label: string; nodes: SavedNode[] }
  | { kind: 'flatten'; label: string; folderId: string; folders: FlattenedFolder[]; moved: MovedBookmark[] }
  | { kind: 'openedTabs'; label: string; windowId: number; tabIds: number[] }
  | { kind: 'createdFolder'; label: string; folderId: string };

export interface StoredUndo {
  id: string;
  at: number;
  entry: UndoEntry;
}

export interface ActionResult {
  message: string;
  undo?: UndoEntry;
}

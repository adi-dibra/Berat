import { undoFlatten } from '../actions/bookmarkActions';
import { reopenTabs, restoreBookmarks } from '../actions/removeActions';
import { restoreGroups } from '../actions/tabActions';
import { UNDO_KEY, type StoredUndo, type UndoEntry } from '../shared/types';

const MAX_ENTRIES = 20;

/**
 * Undo history for bulk actions. Kept in memory and mirrored to
 * chrome.storage.session, so it survives the service worker being stopped
 * and restarted but is cleared when the browser closes.
 */
export class UndoManager {
  private stack: StoredUndo[] | null = null;

  constructor(private api: typeof chrome) {}

  private async load(): Promise<StoredUndo[]> {
    if (!this.stack) {
      const got = await this.api.storage.session.get(UNDO_KEY);
      this.stack = (got[UNDO_KEY] as StoredUndo[] | undefined) ?? [];
    }
    return this.stack;
  }

  private async save(): Promise<void> {
    const stack = await this.load();
    // storage.session holds 10 MB; if a huge snapshot does not fit, drop the oldest entries.
    for (;;) {
      try {
        await this.api.storage.session.set({ [UNDO_KEY]: stack });
        return;
      } catch (e) {
        if (stack.length <= 1) {
          console.warn('Undo history could not be persisted', e);
          return;
        }
        stack.shift();
      }
    }
  }

  async push(entry: UndoEntry): Promise<string> {
    const stack = await this.load();
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    stack.push({ id, at: Date.now(), entry });
    while (stack.length > MAX_ENTRIES) stack.shift();
    await this.save();
    return id;
  }

  async list(): Promise<StoredUndo[]> {
    return [...(await this.load())];
  }

  /** Undoes the entry with `id`, or the most recent one. */
  async undo(id?: string): Promise<string> {
    const stack = await this.load();
    const i = id ? stack.findIndex((s) => s.id === id) : stack.length - 1;
    if (i < 0) return 'Nothing to undo.';
    const [item] = stack.splice(i, 1);
    await this.save();
    const msg = await runUndo(this.api, item.entry);
    return `Undid "${item.entry.label}". ${msg}`;
  }
}

export async function runUndo(api: typeof chrome, e: UndoEntry): Promise<string> {
  switch (e.kind) {
    case 'regroup':
      return restoreGroups(api, e);
    case 'closedTabs':
      return reopenTabs(api, e);
    case 'deletedBookmarks':
      return restoreBookmarks(api, e);
    case 'flatten':
      return undoFlatten(api, e);
    case 'openedTabs': {
      const open = new Set((await api.tabs.query({ windowId: e.windowId })).map((t) => t.id));
      const ids = e.tabIds.filter((id) => open.has(id));
      if (ids.length) await api.tabs.remove(ids);
      return `Closed ${ids.length} tabs.`;
    }
    case 'createdFolder':
      try {
        await api.bookmarks.removeTree(e.folderId);
        return 'Removed the folder.';
      } catch {
        return 'The folder was already gone.';
      }
  }
}

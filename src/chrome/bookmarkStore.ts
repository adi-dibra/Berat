import type { TreeNode } from '../core/flatten';
import { debounce, ListenerBag } from './events';

export interface BNode {
  id: string;
  parentId?: string;
  title: string;
  url?: string;
  dateAdded?: number;
  /** Child ids in order; present for folders only. */
  children?: string[];
}

export interface BookmarkItem {
  id: string;
  parentId: string;
  title: string;
  url: string;
  dateAdded: number;
}

export interface FolderInfo {
  id: string;
  title: string;
  depth: number;
  path: string;
}

/**
 * Live model of the bookmark tree: one `bookmarks.getTree()` at start, then
 * kept current by bookmark events. Subscribers are notified with a debounce.
 */
export class BookmarkStore {
  readonly nodes = new Map<string, BNode>();
  rootId = '0';
  loaded = false;
  version = 0;

  private bag = new ListenerBag();
  private subs = new Set<() => void>();
  private importing = false;
  private eventsDuringLoad = false;
  private folderCache: { v: number; list: FolderInfo[] } | null = null;
  private itemsCache = new Map<string, { v: number; list: BookmarkItem[] }>();
  private notify: () => void;

  constructor(private api: typeof chrome = chrome, debounceMs = 150) {
    this.notify = debounce(() => {
      this.version++;
      for (const s of this.subs) s();
    }, debounceMs);
  }

  subscribe(fn: () => void): () => void {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }

  async start(): Promise<void> {
    this.listen();
    for (let attempt = 0; attempt < 3; attempt++) {
      this.eventsDuringLoad = false;
      await this.load();
      if (!this.eventsDuringLoad) break;
    }
    this.loaded = true;
    this.changed();
  }

  stop(): void {
    this.bag.clear();
  }

  private async load(): Promise<void> {
    const [root] = await this.api.bookmarks.getTree();
    this.nodes.clear();
    this.rootId = root.id;
    const add = (n: chrome.bookmarks.BookmarkTreeNode) => {
      this.nodes.set(n.id, {
        id: n.id, parentId: n.parentId, title: n.title, url: n.url, dateAdded: n.dateAdded,
        children: n.children ? n.children.map((c) => c.id) : n.url === undefined ? [] : undefined,
      });
      n.children?.forEach(add);
    };
    add(root);
  }

  private changed(): void {
    this.folderCache = null;
    this.itemsCache.clear();
    this.notify();
  }

  private ready(): boolean {
    if (!this.loaded) {
      this.eventsDuringLoad = true;
      return false;
    }
    return !this.importing;
  }

  private listen(): void {
    const b = this.api.bookmarks;
    this.bag.on(b.onCreated, (id: string, n: chrome.bookmarks.BookmarkTreeNode) => {
      if (!this.ready()) return;
      const parent = this.nodes.get(n.parentId!);
      this.nodes.set(id, { id, parentId: n.parentId, title: n.title, url: n.url, dateAdded: n.dateAdded, children: n.url === undefined ? [] : undefined });
      if (parent?.children) parent.children.splice(n.index ?? parent.children.length, 0, id);
      this.changed();
    });
    this.bag.on(b.onRemoved, (id: string, info: { parentId: string; index: number }) => {
      if (!this.ready()) return;
      const parent = this.nodes.get(info.parentId);
      if (parent?.children) {
        const i = parent.children.indexOf(id);
        if (i >= 0) parent.children.splice(i, 1);
      }
      const drop = (nid: string) => {
        const n = this.nodes.get(nid);
        this.nodes.delete(nid);
        n?.children?.forEach(drop);
      };
      drop(id);
      this.changed();
    });
    this.bag.on(b.onChanged, (id: string, info: { title: string; url?: string }) => {
      if (!this.ready()) return;
      const n = this.nodes.get(id);
      if (!n) return;
      n.title = info.title;
      if (info.url !== undefined) n.url = info.url;
      this.changed();
    });
    this.bag.on(b.onMoved, (id: string, info: { parentId: string; index: number; oldParentId: string; oldIndex: number }) => {
      if (!this.ready()) return;
      const n = this.nodes.get(id);
      const from = this.nodes.get(info.oldParentId);
      const to = this.nodes.get(info.parentId);
      if (!n || !from?.children || !to?.children) return;
      const i = from.children.indexOf(id);
      if (i >= 0) from.children.splice(i, 1);
      to.children.splice(info.index, 0, id);
      n.parentId = info.parentId;
      this.changed();
    });
    this.bag.on(b.onChildrenReordered, (id: string, info: { childIds: string[] }) => {
      if (!this.ready()) return;
      const n = this.nodes.get(id);
      if (n) n.children = [...info.childIds];
      this.changed();
    });
    // Imports fire thousands of events; ignore them and reload once at the end.
    this.bag.on(b.onImportBegan, () => {
      this.importing = true;
    });
    this.bag.on(b.onImportEnded, () => {
      this.importing = false;
      this.load().then(() => this.changed());
    });
  }

  /** All folders except the invisible root, pre-order, with depth and a readable path. */
  folders(): FolderInfo[] {
    if (this.folderCache?.v === this.version) return this.folderCache.list;
    const list: FolderInfo[] = [];
    const walk = (id: string, depth: number, path: string) => {
      const n = this.nodes.get(id);
      if (!n?.children) return;
      for (const cid of n.children) {
        const c = this.nodes.get(cid);
        if (!c || c.url !== undefined) continue;
        const p = path ? `${path} / ${c.title}` : c.title;
        list.push({ id: c.id, title: c.title, depth, path: p });
        walk(c.id, depth + 1, p);
      }
    };
    walk(this.rootId, 0, '');
    this.folderCache = { v: this.version, list };
    return list;
  }

  /** Every bookmark (not folder) under `folderId`, recursively, in tree order. */
  bookmarksUnder(folderId: string = this.rootId): BookmarkItem[] {
    const cached = this.itemsCache.get(folderId);
    if (cached?.v === this.version) return cached.list;
    const list: BookmarkItem[] = [];
    const walk = (id: string) => {
      const n = this.nodes.get(id);
      if (!n) return;
      if (n.url !== undefined) {
        list.push({ id: n.id, parentId: n.parentId!, title: n.title, url: n.url, dateAdded: n.dateAdded ?? 0 });
        return;
      }
      n.children?.forEach(walk);
    };
    walk(folderId);
    this.itemsCache.set(folderId, { v: this.version, list });
    return list;
  }

  /** Subtree in the shape `bookmarks.getSubTree` returns, for previews. */
  subtree(id: string): TreeNode | null {
    const build = (nid: string, index?: number): TreeNode | null => {
      const n = this.nodes.get(nid);
      if (!n) return null;
      const out: TreeNode = { id: n.id, parentId: n.parentId, index, title: n.title };
      if (n.url !== undefined) out.url = n.url;
      if (n.children) out.children = n.children.map((c, i) => build(c, i)).filter((x): x is TreeNode => !!x);
      return out;
    };
    return build(id);
  }

  folderTitle(id: string): string {
    return this.nodes.get(id)?.title ?? '';
  }
}

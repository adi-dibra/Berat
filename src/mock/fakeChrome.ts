/**
 * In-memory stand-in for the parts of the `chrome.*` API this extension uses.
 *
 * Used by the unit tests, the performance test and the dev harness
 * (`npm run dev`), so the side panel can be exercised with thousands of tabs
 * and bookmarks without a real browser profile. It mimics Chrome's event
 * semantics where the extension depends on them: tab moves fire one
 * `onMoved` per tab, removing a tab shifts later indexes, events are async.
 */

type Listener = (...args: any[]) => void;

export class FakeEvent {
  private ls = new Set<Listener>();
  addListener(l: Listener) { this.ls.add(l); }
  removeListener(l: Listener) { this.ls.delete(l); }
  hasListener(l: Listener) { return this.ls.has(l); }
  hasListeners() { return this.ls.size > 0; }
  /** Dispatch on a microtask, like Chrome which never calls listeners synchronously. */
  emit(...args: unknown[]) {
    const snapshot = [...this.ls];
    queueMicrotask(() => { for (const l of snapshot) l(...args); });
  }
  /** Synchronous dispatch that collects return values (for runtime.onMessage). */
  call(...args: unknown[]): unknown[] {
    return [...this.ls].map((l) => l(...args));
  }
}

interface FTab {
  id: number; windowId: number; index: number; url: string; title: string;
  pinned: boolean; active: boolean; groupId: number; favIconUrl?: string;
  lastAccessed: number; status: string; discarded: boolean; incognito: boolean;
  highlighted: boolean; selected: boolean; autoDiscardable: boolean; frozen: boolean;
}
interface FGroup { id: number; windowId: number; title: string; color: string; collapsed: boolean; shared: boolean }
interface FNode {
  id: string; parentId?: string; title: string; url?: string; dateAdded: number;
  children?: FNode[]; unmodifiable?: string; folderType?: string; syncing: boolean;
}

const COLORS = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];

export interface FakeChromeOptions {
  /** Window id the side panel lives in. */
  currentWindowId?: number;
  /** Simulated per-call latency in ms (0 = microtask). */
  latency?: number;
}

export class FakeChrome {
  currentWindowId: number;
  private latency: number;
  private nextTabId = 1;
  private nextGroupId = 1;
  private nextNodeId = 100;
  private clock = Date.UTC(2020, 0, 1);
  private windows = new Map<number, FTab[]>();
  private groups = new Map<number, FGroup>();
  private nodes = new Map<string, FNode>();
  private root: FNode;
  private local: Record<string, unknown> = {};
  private session: Record<string, unknown> = {};
  /** Count of API calls by name, for perf reporting and assertions. */
  calls: Record<string, number> = {};

  readonly api: typeof chrome;

  constructor(opts: FakeChromeOptions = {}) {
    this.currentWindowId = opts.currentWindowId ?? 1;
    this.latency = opts.latency ?? 0;
    this.windows.set(this.currentWindowId, []);
    this.root = this.node({ id: '0', title: '', children: [] });
    const bar = this.node({ id: '1', parentId: '0', title: 'Bookmarks bar', children: [], folderType: 'bookmarks-bar' });
    const other = this.node({ id: '2', parentId: '0', title: 'Other bookmarks', children: [], folderType: 'other' });
    const mobile = this.node({ id: '3', parentId: '0', title: 'Mobile bookmarks', children: [], folderType: 'mobile' });
    this.root.children!.push(bar, other, mobile);
    this.api = this.build();
  }

  // ---------------------------------------------------------------- seeding

  addWindow(id: number) {
    if (!this.windows.has(id)) this.windows.set(id, []);
  }

  /** Adds a tab without firing events (for seeding). */
  seedTab(p: { url: string; title?: string; windowId?: number; pinned?: boolean; active?: boolean; groupId?: number }): number {
    const windowId = p.windowId ?? this.currentWindowId;
    this.addWindow(windowId);
    const list = this.windows.get(windowId)!;
    const id = this.nextTabId++;
    list.push(this.makeTab(id, windowId, list.length, p.url, p.title, p.pinned, p.active, p.groupId));
    if (p.pinned) this.sortPinned(list);
    return id;
  }

  seedGroup(windowId: number, tabIds: number[], title: string, color = 'blue', collapsed = false): number {
    const id = this.nextGroupId++;
    this.groups.set(id, { id, windowId, title, color, collapsed, shared: false });
    for (const tid of tabIds) this.findTab(tid)!.groupId = id;
    return id;
  }

  /** Adds a bookmark or folder without firing events. Returns the id. */
  seedBookmark(parentId: string, title: string, url?: string, dateAdded?: number): string {
    const parent = this.nodes.get(parentId)!;
    const n = this.node({
      id: String(this.nextNodeId++), parentId, title, url,
      dateAdded: dateAdded ?? this.tick(), children: url ? undefined : [],
    });
    parent.children!.push(n);
    return n.id;
  }

  /** Current window tabs in strip order (for assertions). */
  windowTabs(windowId = this.currentWindowId) {
    return (this.windows.get(windowId) ?? []).map((t) => ({ ...t }));
  }

  bookmarkTree(): chrome.bookmarks.BookmarkTreeNode { return this.export(this.root); }

  // ----------------------------------------------------------------- internals

  private tick() { return (this.clock += 1000); }

  private node(n: Partial<FNode> & { id: string; title: string }): FNode {
    const full: FNode = { dateAdded: this.tick(), syncing: false, ...n };
    this.nodes.set(full.id, full);
    return full;
  }

  private makeTab(id: number, windowId: number, index: number, url: string, title?: string, pinned = false, active = false, groupId = -1): FTab {
    let host = '';
    try { host = new URL(url).hostname; } catch { /* non-standard url */ }
    return {
      id, windowId, index, url, title: title ?? (host || url), pinned, active, groupId,
      favIconUrl: undefined,
      lastAccessed: this.tick(), status: 'complete', discarded: false, incognito: false,
      highlighted: active, selected: active, autoDiscardable: true, frozen: false,
    };
  }

  private findTab(id: number): FTab | undefined {
    for (const list of this.windows.values()) {
      const t = list.find((x) => x.id === id);
      if (t) return t;
    }
    return undefined;
  }

  private reindex(list: FTab[]) { list.forEach((t, i) => (t.index = i)); }

  private sortPinned(list: FTab[]) {
    const pinned = list.filter((t) => t.pinned);
    const rest = list.filter((t) => !t.pinned);
    list.splice(0, list.length, ...pinned, ...rest);
    this.reindex(list);
  }

  private tabOut(t: FTab): chrome.tabs.Tab { return { ...t } as unknown as chrome.tabs.Tab; }

  private export(n: FNode): chrome.bookmarks.BookmarkTreeNode {
    const parent = n.parentId !== undefined ? this.nodes.get(n.parentId) : undefined;
    const out: any = { id: n.id, title: n.title, dateAdded: n.dateAdded, syncing: false };
    if (n.parentId !== undefined) out.parentId = n.parentId;
    if (parent) out.index = parent.children!.indexOf(n);
    if (n.url !== undefined) out.url = n.url;
    if (n.folderType) out.folderType = n.folderType;
    if (n.children) out.children = n.children.map((c) => this.export(c));
    return out;
  }

  private shallow(n: FNode): chrome.bookmarks.BookmarkTreeNode {
    const e = this.export(n) as any;
    delete e.children;
    return e;
  }

  private async wait<T>(name: string, fn: () => T): Promise<T> {
    this.calls[name] = (this.calls[name] ?? 0) + 1;
    if (this.latency) await new Promise((r) => setTimeout(r, this.latency));
    else await Promise.resolve();
    return fn();
  }

  /** Moves one tab, firing onMoved like Chrome does. */
  private moveOne(t: FTab, toIndex: number) {
    const list = this.windows.get(t.windowId)!;
    const from = list.indexOf(t);
    const to = Math.max(0, Math.min(toIndex, list.length - 1));
    if (from === to) return;
    list.splice(from, 1);
    list.splice(to, 0, t);
    this.reindex(list);
    this.ev.tabs.onMoved.emit(t.id, { windowId: t.windowId, fromIndex: from, toIndex: to });
  }

  private setGroup(t: FTab, groupId: number) {
    if (t.groupId === groupId) return;
    const old = t.groupId;
    t.groupId = groupId;
    this.ev.tabs.onUpdated.emit(t.id, { groupId }, this.tabOut(t));
    if (old !== -1) this.dropGroupIfEmpty(old);
  }

  private dropGroupIfEmpty(groupId: number) {
    const g = this.groups.get(groupId);
    if (!g) return;
    const any = (this.windows.get(g.windowId) ?? []).some((t) => t.groupId === groupId);
    if (!any) {
      this.groups.delete(groupId);
      this.ev.tabGroups.onRemoved.emit({ ...g });
    }
  }

  private removeNode(n: FNode) {
    const parent = this.nodes.get(n.parentId!)!;
    const index = parent.children!.indexOf(n);
    const snapshot = this.export(n);
    parent.children!.splice(index, 1);
    const drop = (x: FNode) => { this.nodes.delete(x.id); x.children?.forEach(drop); };
    drop(n);
    this.ev.bookmarks.onRemoved.emit(n.id, { parentId: parent.id, index, node: snapshot });
  }

  private ev = {
    tabs: {
      onCreated: new FakeEvent(), onRemoved: new FakeEvent(), onUpdated: new FakeEvent(),
      onMoved: new FakeEvent(), onActivated: new FakeEvent(), onAttached: new FakeEvent(),
      onDetached: new FakeEvent(), onReplaced: new FakeEvent(), onHighlighted: new FakeEvent(),
    },
    tabGroups: { onCreated: new FakeEvent(), onUpdated: new FakeEvent(), onMoved: new FakeEvent(), onRemoved: new FakeEvent() },
    bookmarks: {
      onCreated: new FakeEvent(), onRemoved: new FakeEvent(), onChanged: new FakeEvent(), onMoved: new FakeEvent(),
      onChildrenReordered: new FakeEvent(), onImportBegan: new FakeEvent(), onImportEnded: new FakeEvent(),
    },
    runtime: { onMessage: new FakeEvent(), onInstalled: new FakeEvent(), onStartup: new FakeEvent() },
    storage: { onChanged: new FakeEvent() },
    commands: { onCommand: new FakeEvent() },
  };

  // ------------------------------------------------------------------- the API

  private build(): typeof chrome {
    const self = this;
    const cur = () => self.currentWindowId;

    const tabs = {
      ...this.ev.tabs,
      TAB_ID_NONE: -1,
      async query(q: chrome.tabs.QueryInfo = {}) {
        return self.wait('tabs.query', () => {
          const out: chrome.tabs.Tab[] = [];
          for (const [wid, list] of self.windows) {
            if (q.currentWindow && wid !== cur()) continue;
            if (q.windowId !== undefined && q.windowId !== wid && q.windowId !== -2) continue;
            if (q.windowId === -2 && wid !== cur()) continue;
            for (const t of list) {
              if (q.active !== undefined && t.active !== q.active) continue;
              if (q.pinned !== undefined && t.pinned !== q.pinned) continue;
              if (q.groupId !== undefined && t.groupId !== q.groupId) continue;
              out.push(self.tabOut(t));
            }
          }
          return out;
        });
      },
      async get(id: number) {
        return self.wait('tabs.get', () => {
          const t = self.findTab(id);
          if (!t) throw new Error(`No tab with id: ${id}.`);
          return self.tabOut(t);
        });
      },
      async create(p: chrome.tabs.CreateProperties) {
        return self.wait('tabs.create', () => {
          const wid = p.windowId ?? cur();
          self.addWindow(wid);
          const list = self.windows.get(wid)!;
          const id = self.nextTabId++;
          const index = Math.min(p.index ?? list.length, list.length);
          const t = self.makeTab(id, wid, index, p.url ?? 'chrome://newtab/', undefined, !!p.pinned, false);
          list.splice(index, 0, t);
          self.reindex(list);
          if (p.pinned) self.sortPinned(list);
          // A tab inserted inside a group joins that group, like in Chrome.
          const left = list[t.index - 1], right = list[t.index + 1];
          if (left && right && left.groupId !== -1 && left.groupId === right.groupId) t.groupId = left.groupId;
          self.ev.tabs.onCreated.emit(self.tabOut(t));
          if (p.active ?? true) {
            for (const o of list) o.active = o === t;
            self.ev.tabs.onActivated.emit({ tabId: t.id, windowId: wid });
          }
          return self.tabOut(t);
        });
      },
      async update(id: number, p: chrome.tabs.UpdateProperties) {
        return self.wait('tabs.update', () => {
          const t = self.findTab(id);
          if (!t) throw new Error(`No tab with id: ${id}.`);
          if (p.active) {
            for (const o of self.windows.get(t.windowId)!) o.active = o === t;
            t.lastAccessed = self.tick();
            self.ev.tabs.onActivated.emit({ tabId: t.id, windowId: t.windowId });
          }
          if (p.url !== undefined) { t.url = p.url; self.ev.tabs.onUpdated.emit(t.id, { url: p.url }, self.tabOut(t)); }
          if (p.pinned !== undefined && p.pinned !== t.pinned) {
            t.pinned = p.pinned;
            self.sortPinned(self.windows.get(t.windowId)!);
            self.ev.tabs.onUpdated.emit(t.id, { pinned: p.pinned }, self.tabOut(t));
          }
          return self.tabOut(t);
        });
      },
      async remove(ids: number | number[]) {
        return self.wait('tabs.remove', () => {
          for (const id of Array.isArray(ids) ? ids : [ids]) {
            const t = self.findTab(id);
            if (!t) throw new Error(`No tab with id: ${id}.`);
            const list = self.windows.get(t.windowId)!;
            list.splice(list.indexOf(t), 1);
            self.reindex(list);
            self.ev.tabs.onRemoved.emit(t.id, { windowId: t.windowId, isWindowClosing: false });
            if (t.groupId !== -1) self.dropGroupIfEmpty(t.groupId);
          }
        });
      },
      async move(ids: number | number[], p: chrome.tabs.MoveProperties) {
        return self.wait('tabs.move', () => {
          const arr = Array.isArray(ids) ? ids : [ids];
          let index = p.index;
          for (const id of arr) {
            const t = self.findTab(id)!;
            const list = self.windows.get(t.windowId)!;
            const target = index === -1 ? list.length - 1 : index;
            self.moveOne(t, target);
            if (index !== -1) index = t.index + 1;
          }
          return arr.map((id) => self.tabOut(self.findTab(id)!));
        });
      },
      async group(o: chrome.tabs.GroupOptions) {
        return self.wait('tabs.group', () => {
          const ids = (Array.isArray(o.tabIds) ? o.tabIds : [o.tabIds]) as number[];
          const tabsToGroup = ids.map((id) => {
            const t = self.findTab(id);
            if (!t) throw new Error(`No tab with id: ${id}.`);
            if (t.pinned) throw new Error('Cannot group pinned tabs.');
            return t;
          });
          let gid = o.groupId;
          let wid: number;
          if (gid !== undefined) {
            const g = self.groups.get(gid);
            if (!g) throw new Error(`No group with id: ${gid}.`);
            wid = g.windowId;
          } else {
            wid = o.createProperties?.windowId ?? tabsToGroup[0].windowId;
            gid = self.nextGroupId++;
            const g: FGroup = { id: gid, windowId: wid, title: '', color: COLORS[gid % COLORS.length], collapsed: false, shared: false };
            self.groups.set(gid, g);
            self.ev.tabGroups.onCreated.emit({ ...g });
          }
          const list = self.windows.get(wid)!;
          if (tabsToGroup.some((t) => t.windowId !== wid)) throw new Error('Tabs must be in the same window.');
          // Gather tabs right after the group's last tab (or the first tab for a new group).
          const members = list.filter((t) => t.groupId === gid);
          let insertAt = members.length ? members[members.length - 1].index + 1 : Math.min(...tabsToGroup.map((t) => t.index));
          for (const t of tabsToGroup) {
            if (t.groupId === gid) continue;
            const target = t.index < insertAt ? insertAt - 1 : insertAt;
            self.moveOne(t, target);
            self.setGroup(t, gid);
            insertAt = t.index + 1;
          }
          return gid;
        });
      },
      async ungroup(ids: number | number[]) {
        return self.wait('tabs.ungroup', () => {
          for (const id of Array.isArray(ids) ? ids : [ids]) {
            const t = self.findTab(id);
            if (t) self.setGroup(t, -1);
          }
        });
      },
    };

    const tabGroups = {
      ...this.ev.tabGroups,
      TAB_GROUP_ID_NONE: -1,
      async query(q: chrome.tabGroups.QueryInfo = {}) {
        return self.wait('tabGroups.query', () =>
          [...self.groups.values()]
            .filter((g) => (q.windowId === undefined || q.windowId === g.windowId || (q.windowId === -2 && g.windowId === cur())))
            .map((g) => ({ ...g })));
      },
      async get(id: number) {
        return self.wait('tabGroups.get', () => {
          const g = self.groups.get(id);
          if (!g) throw new Error(`No group with id: ${id}.`);
          return { ...g };
        });
      },
      async update(id: number, p: chrome.tabGroups.UpdateProperties) {
        return self.wait('tabGroups.update', () => {
          const g = self.groups.get(id);
          if (!g) throw new Error(`No group with id: ${id}.`);
          Object.assign(g, p);
          self.ev.tabGroups.onUpdated.emit({ ...g });
          return { ...g };
        });
      },
      async move(id: number, p: { index: number; windowId?: number }) {
        return self.wait('tabGroups.move', () => {
          const g = self.groups.get(id);
          if (!g) throw new Error(`No group with id: ${id}.`);
          const list = self.windows.get(g.windowId)!;
          const members = list.filter((t) => t.groupId === id);
          const rest = list.filter((t) => t.groupId !== id);
          let at = p.index === -1 ? rest.length : Math.min(p.index, rest.length);
          // Chrome refuses to split another group; snap to that group's end.
          while (at > 0 && at < rest.length && rest[at - 1].groupId !== -1 && rest[at - 1].groupId === rest[at].groupId) at++;
          const final = [...rest.slice(0, at), ...members, ...rest.slice(at)];
          // Replay as single-tab moves so onMoved events are exactly what Chrome would report.
          for (let i = 0; i < final.length; i++) if (list[i] !== final[i]) self.moveOne(final[i], i);
          self.ev.tabGroups.onMoved.emit({ ...g });
          return { ...g };
        });
      },
    };

    const exportShallowList = (list: FNode[]) => list.map((n) => self.shallow(n));
    const getNode = (id: string) => {
      const n = self.nodes.get(id);
      if (!n) throw new Error("Can't find bookmark for id.");
      return n;
    };
    const bookmarks = {
      ...this.ev.bookmarks,
      async getTree() { return self.wait('bookmarks.getTree', () => [self.export(self.root)]); },
      async getSubTree(id: string) { return self.wait('bookmarks.getSubTree', () => [self.export(getNode(id))]); },
      async getChildren(id: string) { return self.wait('bookmarks.getChildren', () => exportShallowList(getNode(id).children ?? [])); },
      async get(ids: string | string[]) {
        return self.wait('bookmarks.get', () => (Array.isArray(ids) ? ids : [ids]).map((id) => self.shallow(getNode(id))));
      },
      async create(p: chrome.bookmarks.CreateDetails) {
        return self.wait('bookmarks.create', () => {
          const parent = getNode(p.parentId ?? '2');
          if (!parent.children) throw new Error('Parent is not a folder.');
          const index = p.index ?? parent.children.length;
          if (index > parent.children.length) throw new Error('Index out of bounds.');
          const n = self.node({ id: String(self.nextNodeId++), parentId: parent.id, title: p.title ?? '', url: p.url, children: p.url ? undefined : [] });
          parent.children.splice(index, 0, n);
          const out = self.shallow(n);
          self.ev.bookmarks.onCreated.emit(n.id, out);
          return out;
        });
      },
      async move(id: string, dest: { parentId?: string; index?: number }) {
        return self.wait('bookmarks.move', () => {
          const n = getNode(id);
          const oldParent = getNode(n.parentId!);
          const oldIndex = oldParent.children!.indexOf(n);
          const parent = getNode(dest.parentId ?? oldParent.id);
          oldParent.children!.splice(oldIndex, 1);
          let index = dest.index ?? parent.children!.length;
          if (index > parent.children!.length) index = parent.children!.length;
          parent.children!.splice(index, 0, n);
          n.parentId = parent.id;
          self.ev.bookmarks.onMoved.emit(id, { parentId: parent.id, index, oldParentId: oldParent.id, oldIndex });
          return self.shallow(n);
        });
      },
      async update(id: string, changes: { title?: string; url?: string }) {
        return self.wait('bookmarks.update', () => {
          const n = getNode(id);
          if (changes.title !== undefined) n.title = changes.title;
          if (changes.url !== undefined) n.url = changes.url;
          self.ev.bookmarks.onChanged.emit(id, { title: n.title, url: n.url });
          return self.shallow(n);
        });
      },
      async remove(id: string) {
        return self.wait('bookmarks.remove', () => {
          const n = getNode(id);
          if (n.children && n.children.length) throw new Error("Can't remove non-empty folder (use recursive to force).");
          self.removeNode(n);
        });
      },
      async removeTree(id: string) { return self.wait('bookmarks.removeTree', () => self.removeNode(getNode(id))); },
    };

    const area = (data: Record<string, unknown>, name: string) => ({
      async get(keys?: string | string[] | Record<string, unknown> | null) {
        return self.wait(`storage.${name}.get`, () => {
          if (keys == null) return structuredClone(data);
          const out: Record<string, unknown> = {};
          if (typeof keys === 'string') keys = [keys];
          if (Array.isArray(keys)) { for (const k of keys) if (k in data) out[k] = structuredClone(data[k]); }
          else for (const [k, def] of Object.entries(keys)) out[k] = k in data ? structuredClone(data[k]) : def;
          return out;
        });
      },
      async set(items: Record<string, unknown>) {
        return self.wait(`storage.${name}.set`, () => {
          const changes: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(items)) {
            changes[k] = { oldValue: data[k], newValue: v };
            data[k] = structuredClone(v);
          }
          self.ev.storage.onChanged.emit(changes, name);
        });
      },
      async remove(keys: string | string[]) {
        return self.wait(`storage.${name}.remove`, () => { for (const k of Array.isArray(keys) ? keys : [keys]) delete data[k]; });
      },
      async clear() { return self.wait(`storage.${name}.clear`, () => { for (const k of Object.keys(data)) delete data[k]; }); },
      async setAccessLevel() { /* no-op */ },
    });

    const runtime = {
      ...this.ev.runtime,
      id: 'fake-extension-id',
      lastError: undefined,
      getManifest: () => ({ manifest_version: 3, name: 'Fake', version: '0.0.0', permissions: ['tabs', 'tabGroups', 'bookmarks', 'sidePanel', 'storage'] }),
      getURL: (p: string) => p,
      /** Routes to onMessage listeners in the same page, honoring `return true` + sendResponse. */
      sendMessage(msg: unknown): Promise<unknown> {
        return new Promise((resolve, reject) => {
          let answered = false;
          const sendResponse = (r: unknown) => { if (!answered) { answered = true; resolve(r); } };
          queueMicrotask(() => {
            try {
              const results = self.ev.runtime.onMessage.call(msg, { id: 'fake-extension-id' }, sendResponse);
              if (!results.some((r) => r === true) && !answered) resolve(undefined);
            } catch (e) { reject(e); }
          });
        });
      },
    };

    const api = {
      tabs,
      tabGroups,
      bookmarks,
      windows: {
        WINDOW_ID_CURRENT: -2,
        async getCurrent() { return self.wait('windows.getCurrent', () => ({ id: cur(), focused: true, incognito: false, alwaysOnTop: false, state: 'normal', type: 'normal' })); },
      },
      storage: { local: area(this.local, 'local'), session: area(this.session, 'session'), onChanged: this.ev.storage.onChanged },
      runtime,
      sidePanel: { async setPanelBehavior() { /* no-op */ }, async open() { /* no-op */ } },
      commands: { onCommand: this.ev.commands.onCommand },
      action: { onClicked: new FakeEvent() },
    };
    return api as unknown as typeof chrome;
  }
}

// ------------------------------------------------------------------ generators

const SITES = [
  'github.com', 'news.ycombinator.com', 'www.bbc.co.uk', 'en.wikipedia.org', 'stackoverflow.com',
  'docs.google.com', 'mail.google.com', 'www.youtube.com', 'adi.github.io', 'foo.github.io',
  'developer.mozilla.org', 'www.reddit.com', 'medium.com', 'x.com', 'www.nytimes.com',
  'arxiv.org', 'www.amazon.co.uk', 'shop.example.com.au', 'blog.rust-lang.org', 'vitejs.dev',
];

/** Deterministic pseudo-random generator so perf runs are comparable. */
export function rng(seed = 42) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Builds a URL from a skewed distribution of sites, with some duplicates and tracking params. */
export function makeUrl(r: () => number, extraDomains = 400): string {
  const x = r();
  const host = x < 0.7
    ? SITES[Math.floor(r() * r() * SITES.length)]
    : `site${Math.floor(r() * extraDomains)}.${['com', 'org', 'net', 'co.uk', 'io'][Math.floor(r() * 5)]}`;
  const path = `/page/${Math.floor(r() * 300)}`;
  const extra = r();
  const suffix = extra < 0.05 ? '?utm_source=newsletter&utm_medium=email' : extra < 0.08 ? '#section' : extra < 0.1 ? '/' : '';
  const scheme = r() < 0.05 ? 'http' : 'https';
  return `${scheme}://${host}${path}${suffix}`;
}

export function seedTabs(fake: FakeChrome, count: number, seed = 1) {
  const r = rng(seed);
  for (let i = 0; i < count; i++) {
    const url = makeUrl(r);
    fake.seedTab({ url, title: `Tab ${i + 1} · ${new URL(url).hostname}${new URL(url).pathname}`, active: i === 0, pinned: i < 2 });
  }
  // A second window that the extension must never touch.
  fake.addWindow(99);
  for (let i = 0; i < 5; i++) fake.seedTab({ url: `https://other-window.example/${i}`, windowId: 99 });
}

export function seedBookmarks(fake: FakeChrome, count: number, seed = 2) {
  const r = rng(seed);
  const folders: string[] = ['1', '2'];
  let made = 0;
  // Build a folder hierarchy up to 4 levels deep, roughly 1 folder per 25 bookmarks.
  const folderCount = Math.max(3, Math.floor(count / 25));
  for (let i = 0; i < folderCount; i++) {
    const parent = folders[Math.floor(r() * folders.length)];
    folders.push(fake.seedBookmark(parent, `Folder ${i + 1}`));
  }
  while (made < count) {
    const parent = folders[Math.floor(r() * folders.length)];
    const url = makeUrl(r, 2000);
    fake.seedBookmark(parent, `Bookmark ${made + 1} · ${new URL(url).hostname}`, url);
    made++;
  }
}

import { debounce, ListenerBag } from './events';

type Tab = chrome.tabs.Tab;
type TabGroup = chrome.tabGroups.TabGroup;

/**
 * Live model of the current window's tabs and native tab groups.
 *
 * Loads with one `tabs.query({ currentWindow: true })` and then applies tab
 * and tab group events for this window only. Subscribers are notified with a
 * debounce so bursts of events (closing 1,000 tabs) cause one re-render.
 */
export class TabStore {
  windowId = -1;
  readonly tabs = new Map<number, Tab>();
  readonly groups = new Map<number, TabGroup>();
  loaded = false;
  version = 0;

  private bag = new ListenerBag();
  private subs = new Set<() => void>();
  private sorted: Tab[] | null = null;
  private eventsDuringLoad = false;
  private notify: () => void;

  constructor(private api: typeof chrome = chrome, debounceMs = 100) {
    this.notify = debounce(() => {
      this.version++;
      for (const s of this.subs) s();
    }, debounceMs);
  }

  subscribe(fn: () => void): () => void {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }

  /** Tabs ordered by their position in the strip. Cached until the next change. */
  list(): Tab[] {
    if (!this.sorted) this.sorted = [...this.tabs.values()].sort((a, b) => a.index - b.index);
    return this.sorted;
  }

  async start(): Promise<void> {
    this.listen();
    const win = await this.api.windows.getCurrent();
    this.windowId = win.id ?? -1;
    // Events that race the initial query may not be reflected in it: reload until clean.
    for (let attempt = 0; attempt < 3; attempt++) {
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
    this.eventsDuringLoad = false;
    const [tabs, groups] = await Promise.all([
      this.api.tabs.query({ currentWindow: true }),
      this.api.tabGroups.query({ windowId: this.windowId }),
    ]);
    this.tabs.clear();
    for (const t of tabs) if (t.id !== undefined) this.tabs.set(t.id, t);
    this.groups.clear();
    for (const g of groups) this.groups.set(g.id, g);
  }

  private changed(): void {
    this.sorted = null;
    this.notify();
  }

  private mine(windowId: number | undefined): boolean {
    if (!this.loaded) {
      this.eventsDuringLoad = true;
      return false;
    }
    return windowId === this.windowId;
  }

  private shift(from: number, delta: number, skipId?: number): void {
    for (const t of this.tabs.values()) if (t.index >= from && t.id !== skipId) t.index += delta;
  }

  private insert(tab: Tab): void {
    if (tab.id === undefined) return;
    this.shift(tab.index, 1, tab.id);
    this.tabs.set(tab.id, { ...tab });
    this.changed();
  }

  private remove(tabId: number): void {
    const t = this.tabs.get(tabId);
    if (!t) return;
    this.tabs.delete(tabId);
    this.shift(t.index + 1, -1);
    this.changed();
  }

  private listen(): void {
    const { tabs, tabGroups } = this.api;
    this.bag.on(tabs.onCreated, (tab: Tab) => {
      if (this.mine(tab.windowId)) this.insert(tab);
    });
    this.bag.on(tabs.onRemoved, (tabId: number, info: chrome.tabs.OnRemovedInfo) => {
      if (this.mine(info.windowId) && !info.isWindowClosing) this.remove(tabId);
    });
    this.bag.on(tabs.onUpdated, (tabId: number, _c: chrome.tabs.OnUpdatedInfo, tab: Tab) => {
      if (!this.mine(tab.windowId)) return;
      const prev = this.tabs.get(tabId);
      if (!prev) return;
      // Keep our index: it is maintained from move events and may be ahead of the snapshot.
      this.tabs.set(tabId, { ...tab, index: prev.index });
      this.changed();
    });
    this.bag.on(tabs.onMoved, (tabId: number, info: chrome.tabs.OnMovedInfo) => {
      if (!this.mine(info.windowId)) return;
      const t = this.tabs.get(tabId);
      if (!t) return;
      const { fromIndex, toIndex } = info;
      for (const o of this.tabs.values()) {
        if (o === t) continue;
        if (fromIndex < toIndex && o.index > fromIndex && o.index <= toIndex) o.index--;
        else if (fromIndex > toIndex && o.index >= toIndex && o.index < fromIndex) o.index++;
      }
      t.index = toIndex;
      this.changed();
    });
    this.bag.on(tabs.onActivated, (info: chrome.tabs.OnActivatedInfo) => {
      if (!this.mine(info.windowId)) return;
      for (const t of this.tabs.values()) t.active = t.id === info.tabId;
      this.changed();
    });
    this.bag.on(tabs.onAttached, (tabId: number, info: chrome.tabs.OnAttachedInfo) => {
      if (!this.mine(info.newWindowId)) return;
      this.api.tabs.get(tabId).then(
        (tab) => {
          if (tab.windowId === this.windowId && !this.tabs.has(tabId)) this.insert({ ...tab, index: info.newPosition });
        },
        () => undefined,
      );
    });
    this.bag.on(tabs.onDetached, (tabId: number, info: chrome.tabs.OnDetachedInfo) => {
      if (this.mine(info.oldWindowId)) this.remove(tabId);
    });
    this.bag.on(tabs.onReplaced, (added: number, removed: number) => {
      const old = this.tabs.get(removed);
      if (!old) return;
      this.api.tabs.get(added).then(
        (tab) => {
          if (tab.windowId !== this.windowId) return;
          this.tabs.delete(removed);
          this.tabs.set(added, { ...tab, index: old.index });
          this.changed();
        },
        () => undefined,
      );
    });

    const putGroup = (g: TabGroup) => {
      if (!this.mine(g.windowId)) return;
      this.groups.set(g.id, g);
      this.changed();
    };
    this.bag.on(tabGroups.onCreated, putGroup);
    this.bag.on(tabGroups.onUpdated, putGroup);
    this.bag.on(tabGroups.onMoved, putGroup);
    this.bag.on(tabGroups.onRemoved, (g: TabGroup) => {
      if (this.groups.delete(g.id)) this.changed();
    });
  }
}

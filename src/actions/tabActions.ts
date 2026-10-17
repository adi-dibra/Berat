import { colorFor } from '../core/color';
import { rootDomain } from '../core/domain';
import type { ActionResult, SavedGroup, UndoEntry } from '../shared/types';

type Api = typeof chrome;
type Tab = chrome.tabs.Tab;
type Ids = [number, ...number[]];
const ids = (list: number[]) => list as Ids;

/** All tabs of one window, in strip order. Never looks at other windows. */
async function windowTabs(api: Api, windowId: number): Promise<Tab[]> {
  const tabs = await api.tabs.query({ windowId });
  return tabs.sort((a, b) => a.index - b.index);
}

/** Snapshot of the groups the given tabs are in now, so a regroup can be undone. */
async function snapshotGroups(api: Api, windowId: number, tabs: Tab[]): Promise<{ groups: SavedGroup[]; ungrouped: number[] }> {
  const byGroup = new Map<number, number[]>();
  const ungrouped: number[] = [];
  for (const t of tabs) {
    if (t.id === undefined) continue;
    if (t.groupId === -1) ungrouped.push(t.id);
    else {
      const list = byGroup.get(t.groupId);
      if (list) list.push(t.id);
      else byGroup.set(t.groupId, [t.id]);
    }
  }
  const info = new Map((await api.tabGroups.query({ windowId })).map((g) => [g.id, g]));
  const groups: SavedGroup[] = [];
  for (const [id, tabIds] of byGroup) {
    const g = info.get(id);
    groups.push({ title: g?.title ?? '', color: g?.color ?? 'grey', collapsed: g?.collapsed ?? false, tabIds });
  }
  return { groups, ungrouped };
}

/**
 * Puts the tabs into the native group titled `title` (creating it if this
 * window has none), with a color derived from the title. Pinned tabs are
 * skipped because Chrome cannot group them.
 */
async function groupInto(api: Api, windowId: number, title: string, tabIds: number[], existing: chrome.tabGroups.TabGroup[]): Promise<number | null> {
  if (!tabIds.length) return null;
  const match = existing.find((g) => g.title === title);
  if (match) {
    await api.tabs.group({ groupId: match.id, tabIds: ids(tabIds) });
    return match.id;
  }
  const groupId = await api.tabs.group({ tabIds: ids(tabIds), createProperties: { windowId } });
  const g = await api.tabGroups.update(groupId, { title, color: colorFor(title) as chrome.tabGroups.Color });
  if (g) existing.push(g);
  return groupId;
}

export async function groupDomain(api: Api, windowId: number, domain: string): Promise<ActionResult> {
  const tabs = (await windowTabs(api, windowId)).filter((t) => rootDomain(t.url ?? t.pendingUrl) === domain);
  const groupable = tabs.filter((t) => !t.pinned && t.id !== undefined);
  if (!groupable.length) return { message: `No tabs from ${domain} can be grouped (pinned tabs can't be).` };
  const before = await snapshotGroups(api, windowId, groupable);
  const existing = await api.tabGroups.query({ windowId });
  await groupInto(api, windowId, domain, groupable.map((t) => t.id!), existing);
  const skipped = tabs.length - groupable.length;
  return {
    message: `Grouped ${groupable.length} ${domain} tabs${skipped ? ` (${skipped} pinned skipped)` : ''}.`,
    undo: { kind: 'regroup', label: `Group ${domain}`, windowId, ...before },
  };
}

/** One native group per domain with at least `minSize` tabs. Smaller domains are left alone. */
export async function groupAllDomains(api: Api, windowId: number, minSize: number): Promise<ActionResult> {
  const tabs = await windowTabs(api, windowId);
  const byDomain = new Map<string, Tab[]>();
  for (const t of tabs) {
    const d = rootDomain(t.url ?? t.pendingUrl);
    const list = byDomain.get(d);
    if (list) list.push(t);
    else byDomain.set(d, [t]);
  }
  const plan = [...byDomain]
    .filter(([, list]) => list.length >= Math.max(1, minSize))
    .map(([d, list]) => [d, list.filter((t) => !t.pinned && t.id !== undefined)] as const)
    .filter(([, list]) => list.length > 0)
    .sort((a, b) => b[1].length - a[1].length);
  if (!plan.length) return { message: `No domain has ${minSize} or more groupable tabs.` };

  const affected = plan.flatMap(([, list]) => list);
  const before = await snapshotGroups(api, windowId, affected);
  const existing = await api.tabGroups.query({ windowId });
  for (const [domain, list] of plan) await groupInto(api, windowId, domain, list.map((t) => t.id!), existing);
  return {
    message: `Created or updated ${plan.length} groups with ${affected.length} tabs.`,
    undo: { kind: 'regroup', label: `Group all (${plan.length} groups)`, windowId, ...before },
  };
}

export async function setCollapsed(api: Api, windowId: number, groupIds: number[] | null, collapsed: boolean): Promise<ActionResult> {
  const groups = await api.tabGroups.query({ windowId });
  const targets = groups.filter((g) => (groupIds ? groupIds.includes(g.id) : true) && g.collapsed !== collapsed);
  for (const g of targets) await api.tabGroups.update(g.id, { collapsed });
  return { message: `${collapsed ? 'Collapsed' : 'Expanded'} ${targets.length} group${targets.length === 1 ? '' : 's'}.` };
}

/**
 * Orders native groups by tab count (largest first unless ascending) and
 * packs them right after the pinned tabs. Ungrouped tabs end up after them.
 */
export async function sortGroupsBySize(api: Api, windowId: number, ascending: boolean): Promise<ActionResult> {
  const tabs = await windowTabs(api, windowId);
  const sizes = new Map<number, number>();
  const firstIndex = new Map<number, number>();
  let pinned = 0;
  for (const t of tabs) {
    if (t.pinned) pinned++;
    if (t.groupId === -1) continue;
    sizes.set(t.groupId, (sizes.get(t.groupId) ?? 0) + 1);
    if (!firstIndex.has(t.groupId)) firstIndex.set(t.groupId, t.index);
  }
  const order = [...sizes.keys()].sort((a, b) => {
    const d = ascending ? sizes.get(a)! - sizes.get(b)! : sizes.get(b)! - sizes.get(a)!;
    return d || firstIndex.get(a)! - firstIndex.get(b)!;
  });
  let index = pinned;
  for (const id of order) {
    await api.tabGroups.move(id, { index });
    index += sizes.get(id)!;
  }
  return { message: `Sorted ${order.length} groups by size, ${ascending ? 'smallest' : 'largest'} first.` };
}

/** Ungroups the given native groups (all groups in the window when null). */
export async function ungroup(api: Api, windowId: number, groupIds: number[] | null): Promise<ActionResult> {
  const tabs = (await windowTabs(api, windowId)).filter(
    (t) => t.groupId !== -1 && (groupIds ? groupIds.includes(t.groupId) : true),
  );
  if (!tabs.length) return { message: 'No grouped tabs to ungroup.' };
  const before = await snapshotGroups(api, windowId, tabs);
  await api.tabs.ungroup(tabs.map((t) => t.id!) as Ids);
  return {
    message: `Ungrouped ${before.groups.length} group${before.groups.length === 1 ? '' : 's'} (${tabs.length} tabs).`,
    undo: { kind: 'regroup', label: `Ungroup ${before.groups.length} groups`, windowId, ...before },
  };
}

/** Restores tabs to the groups recorded in a snapshot. Tabs that were closed since are skipped. */
export async function restoreGroups(api: Api, entry: Extract<UndoEntry, { kind: 'regroup' }>): Promise<string> {
  const alive = new Set((await api.tabs.query({ windowId: entry.windowId })).map((t) => t.id));
  const ungroupIds = entry.ungrouped.filter((id) => alive.has(id));
  if (ungroupIds.length) await api.tabs.ungroup(ungroupIds as Ids);
  let restored = 0;
  for (const g of entry.groups) {
    const ids = g.tabIds.filter((id) => alive.has(id));
    if (!ids.length) continue;
    const groupId = await api.tabs.group({ tabIds: ids as Ids, createProperties: { windowId: entry.windowId } });
    await api.tabGroups.update(groupId, { title: g.title, color: g.color as chrome.tabGroups.Color, collapsed: g.collapsed });
    restored++;
  }
  return `Restored ${restored} group${restored === 1 ? '' : 's'}${ungroupIds.length ? ` and ungrouped ${ungroupIds.length} tabs` : ''}.`;
}

import { useMemo, useState } from 'preact/hooks';
import type { TabStore } from '../chrome/tabStore';
import { GROUP_COLOR_CSS, type GroupColor } from '../core/color';
import { groupByDomain, OTHER_KEY, type BelowMinMode } from '../core/grouping';
import { send, type Request } from '../shared/messages';
import { faviconSrc } from './favicon';
import { Icon, hostLabel } from './Icon';
import { VirtualList } from './VirtualList';

type Tab = chrome.tabs.Tab;
type TabGroup = chrome.tabGroups.TabGroup;
export type TabsSubView = 'domains' | 'groups';

type Row =
  | { kind: 'domain'; key: string; domain: string; count: number; icon?: string; collapsed: boolean; isOther: boolean }
  | { kind: 'ngroup'; key: string; group: TabGroup | null; count: number; collapsed: boolean }
  | { kind: 'tab'; key: string; tab: Tab };

const ROW_HEIGHT = 28;
const UNGROUPED = -1;

interface Props {
  store: TabStore;
  version: number;
  minSize: number;
  belowMin: BelowMinMode;
  view: TabsSubView;
  onViewChange: (v: TabsSubView) => void;
  sortAscending: boolean;
  onSortAscendingChange: (v: boolean) => void;
  notify: (message: string, ok?: boolean) => void;
}

export function TabsView(p: Props) {
  const { store } = p;
  const [uiCollapsed, setUiCollapsed] = useState<Set<string>>(new Set());
  const [activeIndex, setActiveIndex] = useState(-1);
  const [busy, setBusy] = useState(false);

  const tabs = useMemo(() => store.list(), [store, p.version]);

  const grouped = useMemo(
    () => groupByDomain(tabs, (t) => t.url ?? t.pendingUrl, { minSize: p.minSize, belowMin: p.belowMin }),
    [tabs, p.minSize, p.belowMin],
  );

  const nativeGroups = useMemo(() => {
    const members = new Map<number, Tab[]>();
    for (const t of tabs) {
      const list = members.get(t.groupId);
      if (list) list.push(t);
      else members.set(t.groupId, [t]);
    }
    // Strip order: by the index of each group's first tab.
    const order = [...members.keys()].filter((id) => id !== UNGROUPED);
    order.sort((a, b) => members.get(a)![0].index - members.get(b)![0].index);
    return { members, order };
  }, [tabs]);

  const toggleUi = (key: string) => {
    const next = new Set(uiCollapsed);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setUiCollapsed(next);
  };

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    if (p.view === 'domains') {
      for (const g of grouped.groups) {
        const key = 'd:' + g.key;
        const collapsed = uiCollapsed.has(key);
        const first = g.items[0];
        out.push({
          kind: 'domain', key, domain: g.key, count: g.items.length, collapsed, isOther: !!g.isOther,
          icon: g.key === OTHER_KEY ? undefined : faviconSrc(first.url, first.favIconUrl),
        });
        if (!collapsed) for (const t of g.items) out.push({ kind: 'tab', key: 't:' + t.id, tab: t });
      }
    } else {
      const push = (id: number) => {
        const list = nativeGroups.members.get(id);
        if (!list) return;
        const key = 'n:' + id;
        const collapsed = uiCollapsed.has(key);
        out.push({ kind: 'ngroup', key, group: id === UNGROUPED ? null : store.groups.get(id) ?? null, count: list.length, collapsed });
        if (!collapsed) for (const t of list) out.push({ kind: 'tab', key: 't:' + t.id, tab: t });
      };
      for (const id of nativeGroups.order) push(id);
      push(UNGROUPED);
    }
    return out;
  }, [p.view, grouped, nativeGroups, uiCollapsed, store, p.version]);

  const run = async (req: Request) => {
    setBusy(true);
    const res = await send(req);
    setBusy(false);
    p.notify(res.message, res.ok);
  };
  const windowId = store.windowId;
  const groupCount = nativeGroups.order.length;

  const activate = (row: Row | undefined) => {
    if (!row) return;
    if (row.kind === 'tab') {
      if (row.tab.id !== undefined) chrome.tabs.update(row.tab.id, { active: true });
    } else toggleUi(row.key);
  };

  return (
    <>
      <div class="summary">
        <div class="seg" role="radiogroup" aria-label="Group tabs by">
          <button role="radio" aria-checked={p.view === 'domains'} class={p.view === 'domains' ? 'on' : ''} onClick={() => p.onViewChange('domains')}>Domains</button>
          <button role="radio" aria-checked={p.view === 'groups'} class={p.view === 'groups' ? 'on' : ''} onClick={() => p.onViewChange('groups')}>Tab groups</button>
        </div>
        <span class="spacer" />
        <span aria-live="polite">
          {p.view === 'domains'
            ? `${grouped.totalCount} tabs · ${grouped.groups.filter((g) => !g.isOther).length} domains${grouped.hiddenCount ? ` · ${grouped.hiddenCount} hidden` : ''}`
            : `${tabs.length} tabs · ${groupCount} groups`}
        </span>
      </div>
      <div class="summary actions" role="toolbar" aria-label="Tab group actions">
        {p.view === 'domains' ? (
          <button class="btn" disabled={busy} onClick={() => run({ type: 'groupAll', windowId, minSize: p.minSize })}
            title={`Create a Chrome tab group for every domain with at least ${p.minSize} tabs`}>
            Group all (min {p.minSize})
          </button>
        ) : (
          <>
            <button class="btn" disabled={busy || !groupCount} onClick={() => run({ type: 'setCollapsed', windowId, groupIds: null, collapsed: true })}>Collapse all</button>
            <button class="btn" disabled={busy || !groupCount} onClick={() => run({ type: 'setCollapsed', windowId, groupIds: null, collapsed: false })}>Expand all</button>
            <button class="btn" disabled={busy || !groupCount} onClick={() => run({ type: 'sortGroups', windowId, ascending: p.sortAscending })}
              title="Reorder Chrome tab groups by number of tabs">
              Sort by size
            </button>
            <button class="icon-btn" aria-label={p.sortAscending ? 'Sort order: smallest first' : 'Sort order: largest first'}
              title={p.sortAscending ? 'Smallest first (click to change)' : 'Largest first (click to change)'}
              onClick={() => p.onSortAscendingChange(!p.sortAscending)}>
              {p.sortAscending ? '↑ small first' : '↓ large first'}
            </button>
          </>
        )}
        <button class="btn danger" disabled={busy || !groupCount} onClick={() => run({ type: 'ungroup', windowId, groupIds: null })}>Ungroup all</button>
      </div>
      {rows.length === 0 ? (
        <div class="empty">No tabs.</div>
      ) : (
        <VirtualList
          rows={rows}
          rowHeight={ROW_HEIGHT}
          rowKey={(r) => r.key}
          label={p.view === 'domains' ? 'Tabs grouped by domain' : 'Tabs by Chrome tab group'}
          activeIndex={Math.min(activeIndex, rows.length - 1)}
          onActiveIndexChange={setActiveIndex}
          onKeyDown={(e, row) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(row); }
            else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && row && row.kind !== 'tab') {
              const isCollapsed = uiCollapsed.has(row.key);
              if ((e.key === 'ArrowLeft') !== isCollapsed) { e.preventDefault(); toggleUi(row.key); }
            }
          }}
          renderRow={(row) => {
            if (row.kind === 'domain') {
              return (
                <div class={'group-row' + (row.isOther ? ' other' : '')} onClick={() => activate(row)}>
                  <span class="chev" aria-hidden="true">{row.collapsed ? '▸' : '▾'}</span>
                  <Icon src={row.icon} label={row.isOther ? '…' : row.domain} />
                  <span class="name">{row.isOther ? 'Other' : row.domain}</span>
                  {!row.isOther && (
                    <span class="row-btns">
                      <button class="icon-btn" disabled={busy} aria-label={`Create Chrome tab group for ${row.domain}`} title="Create Chrome tab group"
                        onClick={(e) => { e.stopPropagation(); run({ type: 'groupDomain', windowId, domain: row.domain }); }}>
                        ⊞ Group
                      </button>
                    </span>
                  )}
                  <span class="count">{row.count}</span>
                </div>
              );
            }
            if (row.kind === 'ngroup') {
              const g = row.group;
              const title = g ? g.title || '(untitled group)' : 'Not in a group';
              return (
                <div class="group-row" onClick={() => activate(row)}>
                  <span class="chev" aria-hidden="true">{row.collapsed ? '▸' : '▾'}</span>
                  {g ? <span class="dot" style={{ background: GROUP_COLOR_CSS[g.color as GroupColor] }} aria-hidden="true" /> : <span class="dot" aria-hidden="true" />}
                  <span class="name">{title}</span>
                  {g && (
                    <span class="row-btns">
                      <button class="icon-btn" disabled={busy}
                        aria-label={`${g.collapsed ? 'Expand' : 'Collapse'} Chrome tab group ${title}`}
                        title={g.collapsed ? 'Expand in tab strip' : 'Collapse in tab strip'}
                        onClick={(e) => { e.stopPropagation(); run({ type: 'setCollapsed', windowId, groupIds: [g.id], collapsed: !g.collapsed }); }}>
                        {g.collapsed ? 'Expand' : 'Collapse'}
                      </button>
                      <button class="icon-btn" disabled={busy} aria-label={`Ungroup ${title}`} title="Ungroup"
                        onClick={(e) => { e.stopPropagation(); run({ type: 'ungroup', windowId, groupIds: [g.id] }); }}>
                        Ungroup
                      </button>
                    </span>
                  )}
                  {g?.collapsed && <span class="badge" title="Collapsed in the tab strip">collapsed</span>}
                  <span class="count">{row.count}</span>
                </div>
              );
            }
            const t = row.tab;
            const g = t.groupId !== UNGROUPED && p.view === 'domains' ? store.groups.get(t.groupId) : undefined;
            return (
              <div class={'item-row' + (t.active ? ' active' : '')} title={t.url} onClick={() => activate(row)}>
                <Icon src={faviconSrc(t.url, t.favIconUrl)} label={hostLabel(t.url)} />
                <span class="name">{t.title || t.url}</span>
                {g && <span class="dot" title={`In group ${g.title || '(untitled)'}`} style={{ background: GROUP_COLOR_CSS[g.color as GroupColor] }} />}
                {t.pinned && <span class="badge" title="Pinned">📌</span>}
              </div>
            );
          }}
        />
      )}
    </>
  );
}

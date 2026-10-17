import { useEffect, useMemo, useState } from 'preact/hooks';
import { TabStore } from '../chrome/tabStore';
import { groupByDomain, OTHER_KEY, type BelowMinMode } from '../core/grouping';
import { faviconSrc } from './favicon';
import { useStoreVersion } from './useStore';
import { VirtualList } from './VirtualList';

type Mode = 'tabs' | 'bookmarks';

type Row =
  | { kind: 'group'; key: string; label: string; count: number; icon?: string; collapsed: boolean; isOther: boolean }
  | { kind: 'tab'; key: string; tab: chrome.tabs.Tab };

const ROW_HEIGHT = 28;

export function App() {
  const [mode, setMode] = useState<Mode>('tabs');
  const [minSize, setMinSize] = useState(2);
  const [belowMin, setBelowMin] = useState<BelowMinMode>('other');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [activeIndex, setActiveIndex] = useState(-1);

  const [tabStore, setTabStore] = useState<TabStore | null>(null);
  useEffect(() => {
    const s = new TabStore();
    s.start().then(() => setTabStore(s));
    return () => s.stop();
  }, []);
  const tabsVersion = useStoreVersion(tabStore);

  const grouped = useMemo(() => {
    if (!tabStore) return null;
    return groupByDomain(tabStore.list(), (t) => t.url ?? t.pendingUrl, { minSize, belowMin });
  }, [tabStore, tabsVersion, minSize, belowMin]);

  const rows = useMemo<Row[]>(() => {
    if (!grouped) return [];
    const out: Row[] = [];
    for (const g of grouped.groups) {
      const isCollapsed = collapsed.has(g.key);
      const first = g.items[0];
      out.push({
        kind: 'group', key: 'g:' + g.key, label: g.label, count: g.items.length,
        icon: g.key === OTHER_KEY ? undefined : faviconSrc(first.url, first.favIconUrl),
        collapsed: isCollapsed, isOther: !!g.isOther,
      });
      if (!isCollapsed) for (const t of g.items) out.push({ kind: 'tab', key: 't:' + t.id, tab: t });
    }
    return out;
  }, [grouped, collapsed]);

  const toggleGroup = (key: string) => {
    const next = new Set(collapsed);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setCollapsed(next);
  };

  const activate = (row: Row | undefined) => {
    if (!row) return;
    if (row.kind === 'group') toggleGroup(row.key.slice(2));
    else if (row.tab.id !== undefined) chrome.tabs.update(row.tab.id, { active: true });
  };

  return (
    <div class="app">
      <header class="toolbar">
        <div class="mode-toggle" role="tablist" aria-label="Mode">
          {(['tabs', 'bookmarks'] as const).map((m) => (
            <button
              role="tab"
              aria-selected={mode === m}
              class={mode === m ? 'on' : ''}
              onClick={() => { setMode(m); setActiveIndex(-1); }}
            >
              {m === 'tabs' ? 'Tabs' : 'Bookmarks'}
            </button>
          ))}
        </div>
        <div class="controls">
          <label class="slider">
            <span>Min per group: <b>{minSize}</b></span>
            <input
              type="range" min={1} max={50} value={minSize}
              aria-label="Minimum items per group"
              onInput={(e) => setMinSize(Number((e.target as HTMLInputElement).value))}
            />
          </label>
          <label class="check">
            <input
              type="checkbox" checked={belowMin === 'hide'}
              onChange={(e) => setBelowMin((e.target as HTMLInputElement).checked ? 'hide' : 'other')}
            />
            Hide small groups
          </label>
        </div>
      </header>

      {mode === 'bookmarks' ? (
        <div class="empty">Bookmarks mode is coming in a later phase.</div>
      ) : !grouped ? (
        <div class="empty">Loading tabs…</div>
      ) : (
        <>
          <div class="summary" aria-live="polite">
            {grouped.totalCount} tabs in {grouped.groups.filter((g) => !g.isOther).length} groups
            {grouped.hiddenCount ? ` · ${grouped.hiddenCount} hidden` : ''}
          </div>
          <VirtualList
            rows={rows}
            rowHeight={ROW_HEIGHT}
            rowKey={(r) => r.key}
            label="Tabs grouped by domain"
            activeIndex={activeIndex}
            onActiveIndexChange={setActiveIndex}
            onKeyDown={(e, row) => {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(row); }
            }}
            renderRow={(row) =>
              row.kind === 'group' ? (
                <div class={'group-row' + (row.isOther ? ' other' : '')} onClick={() => activate(row)}>
                  <span class="chev" aria-hidden="true">{row.collapsed ? '▸' : '▾'}</span>
                  <Icon src={row.icon} label={row.label} />
                  <span class="name">{row.label}</span>
                  <span class="count">{row.count}</span>
                </div>
              ) : (
                <div
                  class={'item-row' + (row.tab.active ? ' active' : '')}
                  title={row.tab.url}
                  onClick={() => activate(row)}
                >
                  <Icon src={faviconSrc(row.tab.url, row.tab.favIconUrl)} label={hostLabel(row.tab.url)} />
                  <span class="name">{row.tab.title || row.tab.url}</span>
                  {row.tab.pinned && <span class="badge" title="Pinned">📌</span>}
                </div>
              )
            }
          />
        </>
      )}
    </div>
  );
}

function Icon({ src, label }: { src?: string; label: string }) {
  const [failed, setFailed] = useState(false);
  if (src && !failed) {
    return <img class="icon" src={src} alt="" width={16} height={16} loading="lazy" onError={() => setFailed(true)} />;
  }
  const letter = (label.replace(/^www\./, '').trim()[0] ?? '?').toUpperCase();
  return <span class="icon letter" aria-hidden="true">{letter}</span>;
}

function hostLabel(url: string | undefined): string {
  try {
    return new URL(url ?? '').hostname || '?';
  } catch {
    return '?';
  }
}

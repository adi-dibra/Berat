import { useMemo, useState } from 'preact/hooks';
import type { BookmarkItem, BookmarkStore } from '../chrome/bookmarkStore';
import type { TabStore } from '../chrome/tabStore';
import { bookmarkKeeper, findDuplicates, tabKeeper, tabsAlreadyBookmarked } from '../core/duplicates';
import { DEFAULT_RULES, DEFAULT_TRACKING_PARAMS, type NormalizeRules } from '../core/normalize';
import { send, type Request } from '../shared/messages';
import type { DialogOptions } from './Dialog';
import { faviconSrc } from './favicon';
import { Icon, hostLabel } from './Icon';
import { VirtualList } from './VirtualList';

type Tab = chrome.tabs.Tab;
type Section = 'tabs' | 'bookmarked' | 'bookmarks';

type Row =
  | { kind: 'set'; key: string; label: string; count: number }
  | { kind: 'tab'; key: string; tab: Tab; keep: boolean; note?: string }
  | { kind: 'bm'; key: string; bm: BookmarkItem; keep: boolean; note?: string };

const ROW_HEIGHT = 28;

interface Props {
  mode: 'tabs' | 'bookmarks';
  tabStore: TabStore | null;
  tabsVersion: number;
  bookmarkStore: BookmarkStore | null;
  bookmarksVersion: number;
  folderId: string;
  rules: NormalizeRules;
  onRulesChange: (r: NormalizeRules) => void;
  onClose: () => void;
  notify: (message: string, ok?: boolean) => void;
  confirm: (o: DialogOptions) => Promise<boolean>;
}

export function DuplicatesView(p: Props) {
  const [section, setSection] = useState<Section>(p.mode === 'tabs' ? 'tabs' : 'bookmarks');
  const [activeIndex, setActiveIndex] = useState(-1);
  const [busy, setBusy] = useState(false);

  const tabs = useMemo(() => p.tabStore?.list() ?? [], [p.tabStore, p.tabsVersion]);
  const bookmarks = useMemo(
    () => p.bookmarkStore?.bookmarksUnder(p.folderId || undefined) ?? [],
    [p.bookmarkStore, p.bookmarksVersion, p.folderId],
  );
  const allBookmarks = useMemo(() => p.bookmarkStore?.bookmarksUnder() ?? [], [p.bookmarkStore, p.bookmarksVersion]);

  const tabSets = useMemo(() => findDuplicates(tabs, (t) => t.url ?? t.pendingUrl, p.rules, tabKeeper), [tabs, p.rules]);
  const bmSets = useMemo(() => findDuplicates(bookmarks, (b) => b.url, p.rules, bookmarkKeeper), [bookmarks, p.rules]);
  const bookmarked = useMemo(
    () => tabsAlreadyBookmarked(tabs, (t) => t.url ?? t.pendingUrl, allBookmarks, p.rules),
    [tabs, allBookmarks, p.rules],
  );

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    if (section === 'tabs') {
      for (const s of tabSets) {
        out.push({ kind: 'set', key: 's:' + s.key, label: s.key, count: s.remove.length + 1 });
        out.push({ kind: 'tab', key: 'k:' + s.keep.id, tab: s.keep, keep: true });
        for (const t of s.remove) out.push({ kind: 'tab', key: 'r:' + t.id, tab: t, keep: false });
      }
    } else if (section === 'bookmarks') {
      for (const s of bmSets) {
        out.push({ kind: 'set', key: 's:' + s.key, label: s.key, count: s.remove.length + 1 });
        out.push({ kind: 'bm', key: 'k:' + s.keep.id, bm: s.keep, keep: true, note: folderOf(s.keep) });
        for (const b of s.remove) out.push({ kind: 'bm', key: 'r:' + b.id, bm: b, keep: false, note: folderOf(b) });
      }
    } else {
      for (const { tab, bookmark } of bookmarked) {
        out.push({ kind: 'tab', key: 'r:' + tab.id, tab, keep: false, note: `in ${folderOf(bookmark)}` });
      }
    }
    return out;
    function folderOf(b: BookmarkItem) {
      return p.bookmarkStore?.folderTitle(b.parentId) || '';
    }
  }, [section, tabSets, bmSets, bookmarked, p.bookmarkStore]);

  const toRemove =
    section === 'tabs' ? tabSets.reduce((n, s) => n + s.remove.length, 0)
    : section === 'bookmarks' ? bmSets.reduce((n, s) => n + s.remove.length, 0)
    : bookmarked.length;
  const sets = section === 'tabs' ? tabSets.length : section === 'bookmarks' ? bmSets.length : bookmarked.length;

  const run = async (req: Request) => {
    setBusy(true);
    const res = await send(req);
    setBusy(false);
    p.notify(res.message, res.ok);
  };

  const apply = async () => {
    if (!toRemove) return;
    if (section === 'bookmarks') {
      const ok = await p.confirm({
        title: `Delete ${toRemove} duplicate bookmarks?`,
        body: <p>{sets} URLs have duplicates. The oldest bookmark of each is kept; the other <b>{toRemove}</b> are deleted. You can undo this.</p>,
        confirmLabel: `Delete ${toRemove}`,
        danger: true,
      });
      if (ok) run({ type: 'deleteBookmarks', ids: bmSets.flatMap((s) => s.remove.map((b) => b.id)), label: `Delete ${toRemove} duplicate bookmarks` });
      return;
    }
    const ids = section === 'tabs'
      ? tabSets.flatMap((s) => s.remove.map((t) => t.id!))
      : bookmarked.map((x) => x.tab.id!);
    const what = section === 'tabs'
      ? <p>{sets} pages are open more than once. One tab of each is kept (the active or pinned one if there is one); the other <b>{toRemove}</b> are closed. You can undo this.</p>
      : <p><b>{toRemove}</b> open tabs are already bookmarked and will be closed. The bookmarks stay. You can undo this.</p>;
    const ok = await p.confirm({ title: `Close ${toRemove} tabs?`, body: what, confirmLabel: `Close ${toRemove}`, danger: true });
    if (ok && p.tabStore) {
      run({
        type: 'closeTabs', windowId: p.tabStore.windowId, tabIds: ids,
        label: section === 'tabs' ? `Close ${toRemove} duplicate tabs` : `Close ${toRemove} bookmarked tabs`,
      });
    }
  };

  const setRule = <K extends keyof NormalizeRules>(k: K, v: NormalizeRules[K]) => p.onRulesChange({ ...p.rules, [k]: v });
  const loading = (section !== 'tabs' && !p.bookmarkStore) || (section !== 'bookmarks' && !p.tabStore);

  return (
    <>
      <div class="summary">
        <button class="btn" onClick={p.onClose} aria-label="Back to the list">← Back</button>
        <b>Duplicates</b>
        <span class="spacer" />
        <div class="seg" role="radiogroup" aria-label="What to check">
          {(p.mode === 'tabs' ? (['tabs', 'bookmarked'] as const) : (['bookmarks'] as const)).map((s) => (
            <button role="radio" aria-checked={section === s} class={section === s ? 'on' : ''} onClick={() => { setSection(s); setActiveIndex(-1); }}>
              {s === 'tabs' ? 'Duplicate tabs' : s === 'bookmarked' ? 'Already bookmarked' : 'Duplicate bookmarks'}
            </button>
          ))}
        </div>
      </div>
      <details class="summary" style={{ display: 'block' }}>
        <summary>URL matching rules</summary>
        <div class="settings-grid" style={{ padding: '6px 0' }}>
          <input id="r-scheme" type="checkbox" checked={p.rules.ignoreScheme} onChange={(e) => setRule('ignoreScheme', (e.target as HTMLInputElement).checked)} />
          <label for="r-scheme">Treat http and https as the same</label>
          <input id="r-frag" type="checkbox" checked={p.rules.stripFragment} onChange={(e) => setRule('stripFragment', (e.target as HTMLInputElement).checked)} />
          <label for="r-frag">Ignore #fragment</label>
          <input id="r-slash" type="checkbox" checked={p.rules.stripTrailingSlash} onChange={(e) => setRule('stripTrailingSlash', (e.target as HTMLInputElement).checked)} />
          <label for="r-slash">Ignore trailing slash</label>
          <input id="r-track" type="checkbox" checked={p.rules.stripTracking} onChange={(e) => setRule('stripTracking', (e.target as HTMLInputElement).checked)} />
          <label for="r-track">Ignore tracking parameters</label>
          <span />
          <input
            class="search" aria-label="Tracking parameters, comma separated; * matches a prefix" disabled={!p.rules.stripTracking}
            value={p.rules.trackingParams.join(', ')}
            onChange={(e) => setRule('trackingParams', (e.target as HTMLInputElement).value.split(',').map((x) => x.trim()).filter(Boolean))}
          />
          <input id="r-www" type="checkbox" checked={p.rules.stripWww} onChange={(e) => setRule('stripWww', (e.target as HTMLInputElement).checked)} />
          <label for="r-www">Treat www.example.com as example.com</label>
          <input id="r-sort" type="checkbox" checked={p.rules.sortQuery} onChange={(e) => setRule('sortQuery', (e.target as HTMLInputElement).checked)} />
          <label for="r-sort">Ignore query parameter order</label>
          <input id="r-query" type="checkbox" checked={p.rules.ignoreQuery} onChange={(e) => setRule('ignoreQuery', (e.target as HTMLInputElement).checked)} />
          <label for="r-query">Ignore the whole query string</label>
          <span />
          <button class="btn" onClick={() => p.onRulesChange({ ...DEFAULT_RULES, trackingParams: [...DEFAULT_TRACKING_PARAMS] })}>Reset to defaults</button>
        </div>
      </details>
      <div class="summary actions">
        <span aria-live="polite">
          {loading ? 'Loading…'
            : section === 'bookmarked' ? `${toRemove} open tabs are already bookmarked`
            : `${sets} duplicated URLs · ${toRemove} to ${section === 'tabs' ? 'close' : 'delete'}`}
        </span>
        <span class="spacer" />
        <button class="btn primary danger" disabled={busy || loading || !toRemove} onClick={apply}>
          {section === 'bookmarks' ? `Delete ${toRemove} bookmarks` : `Close ${toRemove} tabs`}
        </button>
      </div>
      {loading ? (
        <div class="empty">Loading…</div>
      ) : rows.length === 0 ? (
        <div class="empty">No duplicates found.</div>
      ) : (
        <VirtualList
          rows={rows}
          rowHeight={ROW_HEIGHT}
          rowKey={(r) => r.key}
          label="Duplicate preview"
          activeIndex={Math.min(activeIndex, rows.length - 1)}
          onActiveIndexChange={setActiveIndex}
          renderRow={(row) => {
            if (row.kind === 'set') {
              return (
                <div class="group-row" title={row.label}>
                  <span class="name">{row.label}</span>
                  <span class="count">{row.count}×</span>
                </div>
              );
            }
            const url = row.kind === 'tab' ? row.tab.url : row.bm.url;
            const title = row.kind === 'tab' ? row.tab.title : row.bm.title;
            const extra = row.kind === 'tab'
              ? [row.tab.active && 'active', row.tab.pinned && 'pinned', row.note].filter(Boolean).join(' · ')
              : row.note;
            return (
              <div class={'item-row ' + (row.keep ? 'keep' : 'drop')} title={url}>
                <span class="badge" aria-label={row.keep ? 'Keep' : 'Remove'}>{row.keep ? '✓' : '✕'}</span>
                <Icon src={faviconSrc(url, row.kind === 'tab' ? row.tab.favIconUrl : undefined)} label={hostLabel(url)} />
                <span class={'name ' + (row.keep ? 'keep' : 'drop')}>{title || url}</span>
                {extra && <span class="sub">{extra}</span>}
              </div>
            );
          }}
        />
      )}
    </>
  );
}

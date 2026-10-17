import { useMemo, useState } from 'preact/hooks';
import type { BookmarkItem, BookmarkStore } from '../chrome/bookmarkStore';
import { planFlatten } from '../core/flatten';
import { groupByDomain, OTHER_KEY, type BelowMinMode } from '../core/grouping';
import { send, type Request } from '../shared/messages';
import type { DialogOptions } from './Dialog';
import { faviconSrc } from './favicon';
import { Icon, hostLabel } from './Icon';
import { VirtualList } from './VirtualList';

type Row =
  | { kind: 'domain'; key: string; domain: string; count: number; collapsed: boolean; isOther: boolean }
  | { kind: 'bm'; key: string; bm: BookmarkItem };

const ROW_HEIGHT = 28;
export const ALL_FOLDERS = '';

interface Props {
  store: BookmarkStore;
  version: number;
  windowId: number;
  minSize: number;
  belowMin: BelowMinMode;
  folderId: string;
  onFolderChange: (id: string) => void;
  notify: (message: string, ok?: boolean) => void;
  confirm: (o: DialogOptions) => Promise<boolean>;
}

export function BookmarksView(p: Props) {
  const { store } = p;
  const [uiCollapsed, setUiCollapsed] = useState<Set<string>>(new Set());
  const [activeIndex, setActiveIndex] = useState(-1);
  const [busy, setBusy] = useState(false);

  const folders = useMemo(() => store.folders(), [store, p.version]);
  const folderId = p.folderId && store.nodes.has(p.folderId) ? p.folderId : ALL_FOLDERS;
  const items = useMemo(() => store.bookmarksUnder(folderId || undefined), [store, p.version, folderId]);
  const grouped = useMemo(
    () => groupByDomain(items, (b) => b.url, { minSize: p.minSize, belowMin: p.belowMin }),
    [items, p.minSize, p.belowMin],
  );

  const toggleUi = (key: string) => {
    const next = new Set(uiCollapsed);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setUiCollapsed(next);
  };

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const g of grouped.groups) {
      const key = 'd:' + g.key;
      const collapsed = uiCollapsed.has(key);
      out.push({ kind: 'domain', key, domain: g.key, count: g.items.length, collapsed, isOther: !!g.isOther });
      if (!collapsed) for (const b of g.items) out.push({ kind: 'bm', key: 'b:' + b.id, bm: b });
    }
    return out;
  }, [grouped, uiCollapsed]);

  const run = async (req: Request) => {
    setBusy(true);
    const res = await send(req);
    setBusy(false);
    p.notify(res.message, res.ok);
  };

  const flatten = async () => {
    const tree = store.subtree(folderId);
    if (!tree) return;
    const plan = planFlatten(tree);
    if (!plan.folders.length) {
      p.notify(`"${tree.title}" has no subfolders to flatten.`);
      return;
    }
    const ok = await p.confirm({
      title: `Flatten "${tree.title}"?`,
      body: (
        <>
          <p>
            <b>{plan.moved.length}</b> bookmark{plan.moved.length === 1 ? '' : 's'} from <b>{plan.folders.length}</b> subfolder
            {plan.folders.length === 1 ? '' : 's'} will move directly into "{tree.title}".
          </p>
          <p>The {plan.folders.length} emptied subfolder{plan.folders.length === 1 ? '' : 's'} will be removed. You can undo this.</p>
        </>
      ),
      confirmLabel: 'Flatten',
      danger: true,
    });
    if (ok) run({ type: 'flattenFolder', folderId });
  };

  const open = (b: BookmarkItem) => {
    chrome.tabs.create({ url: b.url, ...(p.windowId >= 0 ? { windowId: p.windowId } : {}) });
  };

  const activate = (row: Row | undefined) => {
    if (!row) return;
    if (row.kind === 'bm') open(row.bm);
    else toggleUi(row.key);
  };

  return (
    <>
      <div class="summary">
        <label class="sr-only" for="folder-picker">Bookmark folder</label>
        <select id="folder-picker" class="folder-select" value={folderId} onChange={(e) => p.onFolderChange((e.target as HTMLSelectElement).value)}>
          <option value={ALL_FOLDERS}>All bookmarks</option>
          {folders.map((f) => (
            <option value={f.id} title={f.path}>{'  '.repeat(f.depth) + (f.title || '(untitled)')}</option>
          ))}
        </select>
      </div>
      <div class="summary actions" role="toolbar" aria-label="Bookmark folder actions">
        <span aria-live="polite">
          {grouped.totalCount} bookmarks · {grouped.groups.filter((g) => !g.isOther).length} domains
          {grouped.hiddenCount ? ` · ${grouped.hiddenCount} hidden` : ''}
        </span>
        <span class="spacer" />
        <button class="btn danger" disabled={busy || !folderId} onClick={flatten}
          title={folderId ? 'Move every bookmark in subfolders up into this folder and remove the subfolders' : 'Pick a folder first'}>
          Ungroup all (flatten)
        </button>
      </div>
      {rows.length === 0 ? (
        <div class="empty">No bookmarks here.</div>
      ) : (
        <VirtualList
          rows={rows}
          rowHeight={ROW_HEIGHT}
          rowKey={(r) => r.key}
          label="Bookmarks grouped by domain"
          activeIndex={Math.min(activeIndex, rows.length - 1)}
          onActiveIndexChange={setActiveIndex}
          onKeyDown={(e, row) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(row); }
            else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && row?.kind === 'domain') {
              if ((e.key === 'ArrowLeft') !== row.collapsed) { e.preventDefault(); toggleUi(row.key); }
            }
          }}
          renderRow={(row) =>
            row.kind === 'domain' ? (
              <div class={'group-row' + (row.isOther ? ' other' : '')} onClick={() => activate(row)}>
                <span class="chev" aria-hidden="true">{row.collapsed ? '▸' : '▾'}</span>
                <Icon label={row.isOther ? '…' : row.domain} />
                <span class="name">{row.domain === OTHER_KEY ? 'Other' : row.domain}</span>
                <span class="count">{row.count}</span>
              </div>
            ) : (
              <div class="item-row" title={row.bm.url} onClick={() => activate(row)}>
                <Icon src={faviconSrc(row.bm.url)} label={hostLabel(row.bm.url)} />
                <span class="name">{row.bm.title || row.bm.url}</span>
                <span class="sub">{store.folderTitle(row.bm.parentId)}</span>
              </div>
            )
          }
        />
      )}
    </>
  );
}

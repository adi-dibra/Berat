import { useEffect, useRef, useState } from 'preact/hooks';
import { BookmarkStore } from '../chrome/bookmarkStore';
import { TabStore } from '../chrome/tabStore';
import { send } from '../shared/messages';
import { UNDO_KEY, type StoredUndo } from '../shared/types';
import { BookmarksView } from './BookmarksView';
import { Dialog, type DialogOptions } from './Dialog';
import { DuplicatesView } from './DuplicatesView';
import { saveSettings, type Settings } from './settings';
import { TabsView } from './TabsView';
import { useStoreVersion } from './useStore';

interface Toast {
  message: string;
  ok: boolean;
  undoId?: string;
}

export function App({ initial }: { initial: Settings }) {
  const [settings, setSettings] = useState<Settings>(initial);
  const update = (patch: Partial<Settings>) => {
    setSettings((s) => {
      const next = { ...s, ...patch };
      saveSettings(next);
      return next;
    });
  };
  const { mode, minSize, belowMin } = settings;

  const [showDuplicates, setShowDuplicates] = useState(false);
  const [queryInput, setQueryInput] = useState('');
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const t = setTimeout(() => setQuery(queryInput), 120);
    return () => clearTimeout(t);
  }, [queryInput]);

  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const notify = (message: string, ok = true, undoId?: string) => {
    setToast({ message, ok, undoId });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), undoId ? 10000 : 6000);
  };

  // Undo history lives in the service worker and is mirrored to storage.session.
  const [undoStack, setUndoStack] = useState<StoredUndo[]>([]);
  useEffect(() => {
    chrome.storage.session.get(UNDO_KEY).then((got) => setUndoStack((got[UNDO_KEY] as StoredUndo[]) ?? []), () => undefined);
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'session' && changes[UNDO_KEY]) setUndoStack((changes[UNDO_KEY].newValue as StoredUndo[]) ?? []);
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);
  const lastUndo = undoStack[undoStack.length - 1];
  const undo = async (id?: string) => {
    setToast(null);
    const res = await send({ type: 'undo', id });
    notify(res.message, res.ok);
  };

  const [tabStore, setTabStore] = useState<TabStore | null>(null);
  useEffect(() => {
    const s = new TabStore();
    s.start().then(() => setTabStore(s));
    return () => s.stop();
  }, []);
  const tabsVersion = useStoreVersion(tabStore);

  // The bookmark tree is loaded the first time something needs it.
  const [bookmarkStore, setBookmarkStore] = useState<BookmarkStore | null>(null);
  const bookmarksWanted = mode === 'bookmarks' || showDuplicates;
  const bmStarted = useRef<BookmarkStore | null>(null);
  useEffect(() => {
    if (!bookmarksWanted || bmStarted.current) return;
    const s = new BookmarkStore();
    bmStarted.current = s;
    s.start().then(() => setBookmarkStore(s));
  }, [bookmarksWanted]);
  useEffect(() => () => bmStarted.current?.stop(), []);
  const bookmarksVersion = useStoreVersion(bookmarkStore);

  const [dialog, setDialog] = useState<(DialogOptions & { resolve: (ok: boolean) => void }) | null>(null);
  const confirm = (o: DialogOptions) => new Promise<boolean>((resolve) => setDialog({ ...o, resolve }));

  // Global shortcuts: "/" or Ctrl+F focuses search, Ctrl+Z undoes the last bulk action.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement;
      if (dialog) return;
      if ((e.key === '/' && !typing) || (e.key === 'f' && (e.ctrlKey || e.metaKey))) {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      } else if (e.key === 'z' && (e.ctrlKey || e.metaKey) && !typing && lastUndo) {
        e.preventDefault();
        undo();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [dialog, lastUndo]);

  const switchMode = (m: Settings['mode']) => {
    update({ mode: m });
    setShowDuplicates(false);
  };

  return (
    <div class="app">
      <header class="toolbar">
        <div class="mode-toggle" role="tablist" aria-label="Mode">
          {(['tabs', 'bookmarks'] as const).map((m) => (
            <button role="tab" aria-selected={mode === m} class={mode === m ? 'on' : ''} onClick={() => switchMode(m)}>
              {m === 'tabs' ? 'Tabs' : 'Bookmarks'}
            </button>
          ))}
        </div>
        <input
          ref={searchRef}
          class="search"
          type="search"
          placeholder={`Filter ${mode} by title or URL  ( / )`}
          aria-label={`Filter ${mode} by title or URL`}
          value={queryInput}
          onInput={(e) => setQueryInput((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { setQueryInput(''); setQuery(''); }
            else if (e.key === 'ArrowDown' || e.key === 'Enter') {
              e.preventDefault();
              document.querySelector<HTMLElement>('.vlist')?.focus();
            }
          }}
        />
        <div class="controls">
          <label class="slider">
            <span>Min per group: <b>{minSize}</b></span>
            <input
              type="range" min={1} max={50} value={minSize}
              aria-label="Minimum items per group"
              onInput={(e) => update({ minSize: Number((e.target as HTMLInputElement).value) })}
            />
          </label>
          <label class="check">
            <input
              type="checkbox" checked={belowMin === 'hide'}
              onChange={(e) => update({ belowMin: (e.target as HTMLInputElement).checked ? 'hide' : 'other' })}
            />
            Hide small groups
          </label>
          <button class={'btn' + (showDuplicates ? ' primary' : '')} aria-pressed={showDuplicates} onClick={() => setShowDuplicates(!showDuplicates)}>
            Duplicates
          </button>
          <button
            class="btn" disabled={!lastUndo} onClick={() => undo()}
            title={lastUndo ? `Undo: ${lastUndo.entry.label} (Ctrl+Z)` : 'Nothing to undo'}
            aria-label={lastUndo ? `Undo ${lastUndo.entry.label}` : 'Nothing to undo'}
          >
            ↶ Undo{undoStack.length > 1 ? ` (${undoStack.length})` : ''}
          </button>
        </div>
      </header>

      {showDuplicates ? (
        <DuplicatesView
          mode={mode}
          tabStore={tabStore}
          tabsVersion={tabsVersion}
          bookmarkStore={bookmarkStore}
          bookmarksVersion={bookmarksVersion}
          folderId={settings.folderId}
          rules={settings.rules}
          onRulesChange={(rules) => update({ rules })}
          onClose={() => setShowDuplicates(false)}
          notify={notify}
          confirm={confirm}
        />
      ) : mode === 'bookmarks' ? (
        !bookmarkStore ? (
          <div class="empty">Loading bookmarks…</div>
        ) : (
          <BookmarksView
            store={bookmarkStore}
            version={bookmarksVersion}
            windowId={tabStore?.windowId ?? -1}
            query={query}
            minSize={minSize}
            belowMin={belowMin}
            folderId={settings.folderId}
            onFolderChange={(folderId) => update({ folderId })}
            notify={notify}
            confirm={confirm}
          />
        )
      ) : !tabStore ? (
        <div class="empty">Loading tabs…</div>
      ) : (
        <TabsView
          store={tabStore}
          version={tabsVersion}
          query={query}
          minSize={minSize}
          belowMin={belowMin}
          view={settings.tabsView}
          onViewChange={(tabsView) => update({ tabsView })}
          sortAscending={settings.sortAscending}
          onSortAscendingChange={(sortAscending) => update({ sortAscending })}
          notify={notify}
        />
      )}

      {dialog && (
        <Dialog
          {...dialog}
          onClose={(ok) => {
            dialog.resolve(ok);
            setDialog(null);
          }}
        />
      )}

      {toast && (
        <div class="toast" role="status" aria-live="polite">
          <span class="msg">{toast.ok ? '' : '⚠ '}{toast.message}</span>
          {toast.undoId && <button onClick={() => undo(toast.undoId)}>Undo</button>}
          <button aria-label="Dismiss" onClick={() => setToast(null)}>✕</button>
        </div>
      )}
    </div>
  );
}

import { useEffect, useRef, useState } from 'preact/hooks';
import { TabStore } from '../chrome/tabStore';
import type { BelowMinMode } from '../core/grouping';
import { TabsView, type TabsSubView } from './TabsView';
import { useStoreVersion } from './useStore';

type Mode = 'tabs' | 'bookmarks';

interface Toast {
  message: string;
  ok: boolean;
}

export function App() {
  const [mode, setMode] = useState<Mode>('tabs');
  const [minSize, setMinSize] = useState(2);
  const [belowMin, setBelowMin] = useState<BelowMinMode>('other');
  const [tabsView, setTabsView] = useState<TabsSubView>('domains');
  const [sortAscending, setSortAscending] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const [tabStore, setTabStore] = useState<TabStore | null>(null);
  useEffect(() => {
    const s = new TabStore();
    s.start().then(() => setTabStore(s));
    return () => s.stop();
  }, []);
  const tabsVersion = useStoreVersion(tabStore);

  const notify = (message: string, ok = true) => {
    setToast({ message, ok });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 6000);
  };

  return (
    <div class="app">
      <header class="toolbar">
        <div class="mode-toggle" role="tablist" aria-label="Mode">
          {(['tabs', 'bookmarks'] as const).map((m) => (
            <button role="tab" aria-selected={mode === m} class={mode === m ? 'on' : ''} onClick={() => setMode(m)}>
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
      ) : !tabStore ? (
        <div class="empty">Loading tabs…</div>
      ) : (
        <TabsView
          store={tabStore}
          version={tabsVersion}
          minSize={minSize}
          belowMin={belowMin}
          view={tabsView}
          onViewChange={setTabsView}
          sortAscending={sortAscending}
          onSortAscendingChange={setSortAscending}
          notify={notify}
        />
      )}

      {toast && (
        <div class="toast" role="status">
          <span class="msg">{toast.ok ? '' : '⚠ '}{toast.message}</span>
          <button aria-label="Dismiss" onClick={() => setToast(null)}>✕</button>
        </div>
      )}
    </div>
  );
}

import type { BelowMinMode } from '../core/grouping';
import { DEFAULT_RULES, type NormalizeRules } from '../core/normalize';

export interface Settings {
  mode: 'tabs' | 'bookmarks';
  minSize: number;
  belowMin: BelowMinMode;
  tabsView: 'domains' | 'groups';
  /** Native tab group sort order. */
  sortAscending: boolean;
  /** Bookmark folder scope; '' means all bookmarks. */
  folderId: string;
  rules: NormalizeRules;
}

export const DEFAULT_SETTINGS: Settings = {
  mode: 'tabs',
  minSize: 2,
  belowMin: 'other',
  tabsView: 'domains',
  sortAscending: false,
  folderId: '',
  rules: DEFAULT_RULES,
};

const KEY = 'settings';

/** Reads settings from chrome.storage.local, falling back to defaults for anything missing or invalid. */
export async function loadSettings(): Promise<Settings> {
  try {
    const got = (await chrome.storage.local.get(KEY))[KEY] as Partial<Settings> | undefined;
    return sanitize(got ?? {});
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function sanitize(s: Partial<Settings>): Settings {
  const d = DEFAULT_SETTINGS;
  const rules = { ...DEFAULT_RULES, ...(s.rules ?? {}) };
  if (!Array.isArray(rules.trackingParams)) rules.trackingParams = DEFAULT_RULES.trackingParams;
  return {
    mode: s.mode === 'bookmarks' ? 'bookmarks' : d.mode,
    minSize: Number.isFinite(s.minSize) ? Math.min(50, Math.max(1, Math.round(s.minSize!))) : d.minSize,
    belowMin: s.belowMin === 'hide' ? 'hide' : d.belowMin,
    tabsView: s.tabsView === 'groups' ? 'groups' : d.tabsView,
    sortAscending: typeof s.sortAscending === 'boolean' ? s.sortAscending : d.sortAscending,
    folderId: typeof s.folderId === 'string' ? s.folderId : d.folderId,
    rules,
  };
}

let timer: ReturnType<typeof setTimeout> | undefined;
/** Saves settings, debounced so dragging the slider writes once. */
export function saveSettings(s: Settings): void {
  clearTimeout(timer);
  timer = setTimeout(() => {
    chrome.storage.local.set({ [KEY]: s }).catch(console.error);
  }, 300);
}

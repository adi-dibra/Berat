# Berat Tab Manager

A Chrome (Manifest V3) side panel extension for managing hundreds to thousands
of open tabs and bookmarks by grouping them by root domain.

Everything runs locally: the only permissions are `tabs`, `tabGroups`,
`bookmarks`, `sidePanel` and `storage`. No host permissions, no network calls,
no analytics. See [PRIVACY.md](PRIVACY.md).

## Install from source (load unpacked)

1. Install Node.js 20 or newer.
2. In this folder run:
   ```
   npm install
   npm run build
   ```
3. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**
   and pick the `dist` folder.
4. Click the extension's toolbar button (or press Alt+Shift+T) to open the side panel.

After pulling changes, run `npm run build` again and click the reload icon on the
extension's card in `chrome://extensions`.

## What it does

**Tabs mode** (current window only)
- Tabs grouped by root domain (public suffix list, so `bbc.co.uk` and
  `foo.github.io` are handled correctly), with count and favicon. Click a tab to focus it.
- Minimum group size slider; smaller domains go to "Other" or are hidden.
- **Domains** view: "Group" per domain creates a native Chrome tab group titled with the
  domain and a color derived from it; "Group all" does every domain at or above the minimum.
- **Tab groups** view: collapse/expand all or one group, sort groups by size
  (largest or smallest first), ungroup all or one group, save a group as a bookmark folder.

**Bookmarks mode**
- Same domain grouping and slider over all bookmarks or a folder picked in the folder picker.
- "Ungroup all (flatten)": moves every bookmark from the folder's subfolders directly
  into the folder and removes the emptied subfolders, after a confirmation with counts.
- "Open as tab group": opens the folder's bookmarks in the current window as a tab group
  named after the folder (asks first above 50 tabs).

**Duplicates** (both modes)
- Duplicate tabs, tabs that are already bookmarked, and duplicate bookmarks.
- URL matching is configurable: lowercase host, http = https, ignore `#fragment`,
  trailing slash and tracking parameters (`utm_*`, `fbclid`, `gclid`, ... editable),
  optionally `www.`, query order or the whole query.
- Keeps the active (else pinned, else leftmost) tab, or the oldest bookmark. Preview with
  counts before anything is closed or deleted.

**Everywhere**
- Filter box over the current mode (title and URL).
- Undo for every bulk action (close, delete, group, ungroup, flatten, conversions), kept in
  memory and in `chrome.storage.session` (last 20 actions, cleared when Chrome closes).
- Settings (mode, slider, small-group toggle, view, sort order, folder, URL rules) are saved
  in `chrome.storage.local`.

### Keyboard

| Key | Action |
| --- | --- |
| `/` or Ctrl+F | Focus the filter box (Esc clears it, ↓ or Enter moves into the list) |
| ↑ ↓ PgUp PgDn Home End | Move in the list |
| Enter / Space | Focus the tab, open the bookmark, or collapse/expand a group row |
| ← → | Collapse / expand the group row in the list |
| `g` | On a domain row: create a Chrome tab group |
| `c` / `u` / `s` | On a tab group row: collapse/expand, ungroup, save as bookmarks |
| Ctrl+Z | Undo the last bulk action |

## Chrome API limitations and how they are handled

- **Pinned tabs can't be in tab groups.** Grouping skips them and says how many were skipped.
- **Sorting groups** packs the groups right after the pinned tabs, so ungrouped tabs end up
  after all groups.
- **Undoing closed tabs** reopens their URLs at their old positions and puts them back in a
  group with the same title and color. Without the `sessions` permission Chrome can't restore
  a tab's back/forward history or form state.
- **Favicons:** tabs show the icon Chrome reports for them (`favIconUrl`). Showing a page's
  icon from Chrome's local favicon cache needs the extra `favicon` permission, which isn't in
  the allowed list, so bookmarks show a letter badge. `src/panel/favicon.ts` already switches
  to the local cache if that permission is added to the manifest.

## Architecture

```
src/
  core/        Pure logic, no chrome.* calls (unit tested)
    domain.ts      root domain via tldts with private suffixes, cached per host
    grouping.ts    one-pass group-by-domain, min size / Other / hide, filter
    normalize.ts   configurable URL normalization
    duplicates.ts  duplicate sets, keeper rules, tabs already bookmarked
    flatten.ts     plan a folder flatten and its undo
    color.ts       deterministic tab group color from a name
  chrome/      Live stores for the side panel
    tabStore.ts      one tabs.query, then tab/tabGroup events for this window only
    bookmarkStore.ts one bookmarks.getTree, then bookmark events
  actions/     Bulk operations against the chrome API (take the API as a parameter)
  background/  Service worker: opens the panel, runs actions, keeps the undo history
  panel/       Preact side panel UI (virtualized list, views, dialogs, settings)
  shared/      Message and undo types shared by panel and service worker
  mock/        In-memory fake chrome.* API, dev harness and UI timing script
```

- **Data flow.** The panel loads the window's tabs with a single
  `chrome.tabs.query({ currentWindow: true })` and the bookmark tree with one `getTree()`
  (only when bookmarks are first needed). Both stores then apply events incrementally,
  filtering to the panel's window, and notify the UI with a debounce, so a burst of 1,000
  events causes one re-render. Tabs are never activated or cycled to read them.
- **Rendering.** Grouping is a single pass with a `Map`, memoized on the store version and
  the controls. The list is virtualized with fixed-height rows: about 30 rows are in the DOM
  whether there are 30 items or 20,000.
- **Actions.** Bulk actions are sent to the service worker, which re-reads the current state,
  performs the change, and records an undo snapshot. Running them there means they finish
  even if the side panel is closed mid-way.

## Development

- `npm run dev` serves a harness at http://localhost:5199/dev.html that runs the real side
  panel and service worker code against an in-memory fake of the `chrome.*` API, with a crude
  tab strip on the left. Seed sizes with `?tabs=5000&bookmarks=20000`.
- `npm test` runs the unit tests (Vitest): domain extraction, grouping, URL normalization,
  duplicates, flatten logic, the live stores and every action with its undo.
- `npm run e2e` builds the extension, loads it into a throwaway headless Chrome profile
  (offline) and checks grouping, native tab groups, undo, duplicates and bookmarks mode
  against the real Chrome APIs.
- `npm run perf` runs the 5,000 tab / 20,000 bookmark data pipeline benchmark;
  `npm run harness` + `npm run perf:ui` time the real UI in headless Chrome.
  Results: [docs/PERFORMANCE.md](docs/PERFORMANCE.md).
- `npm run icons` regenerates the icons; `npm run harness` + `npm run store-assets`
  regenerate the Chrome Web Store screenshots and promo tile in `store/`.

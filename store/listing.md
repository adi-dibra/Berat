# Chrome Web Store listing

## Assets in this folder

| File | Store field | Size |
| --- | --- | --- |
| `icon-128.png` | Store icon | 128×128 |
| `screenshot-1-tabs-by-domain.png` | Screenshot | 1280×800 |
| `screenshot-2-tab-groups.png` | Screenshot | 1280×800 |
| `screenshot-3-bookmarks.png` | Screenshot | 1280×800 |
| `screenshot-4-duplicates.png` | Screenshot | 1280×800 |
| `promo-small-440x280.png` | Small promo tile | 440×280 |

Regenerate with `npm run harness` and then `npm run store-assets`.

## Name

Berat Tab Manager

## Summary (132 characters max)

Group thousands of tabs and bookmarks by site in the side panel. Tab groups, duplicates, undo. Nothing leaves your browser.

## Category

Workflow & Planning (or Tools)

## Description

Too many tabs? Berat Tab Manager groups every tab in your window by website, right in
Chrome's side panel, and stays fast with thousands of tabs and tens of thousands of bookmarks.

• Tabs grouped by site, with a minimum group size slider
• Turn any site into a native Chrome tab group in one click, or group them all
• Collapse, expand, sort by size and ungroup tab groups
• Save a tab group as a bookmark folder, or open a bookmark folder as a tab group
• Bookmarks grouped by site, scoped to any folder; flatten nested subfolders in one step
• Find duplicate tabs and bookmarks with smart URL matching that ignores tracking parameters
• Close tabs that are already bookmarked
• Preview before every bulk change, and undo it afterwards
• Filter by title or URL, full keyboard navigation

Private by design: no network access, no analytics, no account. Your tabs and bookmarks
never leave your browser.

## Privacy practices answers

- Single purpose: organize the user's open tabs and bookmarks by grouping them.
- Permission justifications:
  - tabs: read titles/URLs of tabs in the current window, focus, group, close and reopen tabs.
  - tabGroups: create, collapse, reorder and ungroup native tab groups.
  - bookmarks: read, group, flatten, create and delete bookmarks at the user's request.
  - sidePanel: the extension's user interface.
  - storage: save settings locally and keep a session-only undo history.
- Remote code: No.
- Data collection: none. Certify that data is not sold, not used for unrelated purposes and
  not used for creditworthiness.
- Privacy policy: link to PRIVACY.md in the repository.

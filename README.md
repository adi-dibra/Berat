# Berat Tab Cluster (Lightweight Chrome Extension)

## What It Does
- Removes duplicate tabs
- Removes duplicate tabs by root domain (keeps one tab per root domain)
- Removes duplicate bookmarks
- Removes duplicate bookmarks by root domain (keeps one bookmark per root domain)
- Groups tabs by root domain with a user-set minimum threshold
- Groups bookmarks by root domain with a user-set minimum threshold
- Sorts groups by size (largest first)
- Collapses/expands groups (individually or all at once)
- Bookmarks all open tabs
- Opens all bookmarks as tabs
- Opens bookmarks and groups opened tabs by bookmark subfolder path
- Ungroups tabs
- Ungroups bookmarks grouped into domain folders
- Lets you choose a bookmark folder scope for bookmark actions
- Shows a Bookmark Folders section for the selected bookmark scope

## Performance Approach
This extension reads URL metadata directly from `chrome.tabs.query` and `chrome.bookmarks.getTree`, then computes root-domain clusters from those lists. It does not load tab contents to perform grouping or dedupe.

## Load in Chrome
1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder: `C:\Users\adidi\github\Berat`.

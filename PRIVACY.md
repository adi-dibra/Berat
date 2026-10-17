# Privacy statement

Berat Tab Manager does not collect, transmit, sell or share any data.

- **No data leaves your browser.** The extension makes no network requests of its own, has
  no host permissions, and contains no analytics, tracking or remote code.
- **What it reads.** The titles, URLs and favicons of tabs in the window where you open the
  side panel, your native tab groups, and your bookmarks. It reads them only to show, group
  and change them when you ask it to.
- **What it stores, and where.** Your settings (mode, slider value, sort order, folder,
  URL matching rules) in `chrome.storage.local` on your device. A short undo history of your
  last bulk actions (which can include the URLs of tabs you closed or bookmarks you deleted)
  in `chrome.storage.session`, which Chrome keeps in memory and clears when the browser closes.
- **Permissions.** `tabs` and `tabGroups` to list, focus, group, close and reopen tabs in the
  current window; `bookmarks` to list, group, flatten, create and delete bookmarks;
  `sidePanel` for the user interface; `storage` for settings and undo history.
- Tab favicons are displayed from the address Chrome reports for each tab; the browser
  usually serves these from its cache.

Questions: open an issue at https://github.com/adi-dibra/Berat.

# Performance

Measured on 2026-10-17 on Windows with Node v26.11.1 and headless Chrome, using generated data: 5,000 tabs (about 380 domains, roughly 800 duplicated URLs) in the current window plus 5 in another window, and 20,000 bookmarks in about 800 nested folders.

## Data pipeline (`npm run perf`)

The fake chrome API answers instantly, so these are the extension's own costs, not Chrome's IPC time.

| Step | Time (ms) | Notes |
| --- | ---: | --- |
| Tab store: initial load (1 tabs.query) | 3.7 |  |
| Bookmark store: initial load (1 getTree) | 27.4 |  |
| Group 5,000 tabs by domain (cold PSL cache) | 30.5 |  |
| Group 5,000 tabs by domain (warm) | 5.2 | median of 9 |
| Group 20,000 bookmarks by domain (cold) | 28.9 |  |
| Group 20,000 bookmarks by domain (warm) | 21.6 | median of 9 |
| Filter 20,000 bookmarks by "github" | 10.8 | median of 9 |
| List bookmark folders for the picker | 1.1 | median of 9 |
| Collect 20,000 bookmarks from the tree | 1.4 | median of 9 |
| Duplicate tabs (5,000) | 8.7 | median of 5, 834 sets |
| Duplicate bookmarks (20,000) | 29.7 | median of 5, 2944 sets |
| Tabs already bookmarked (5,000 × 20,000) | 31.4 | median of 5, 3186 tabs |
| Apply 1,000 tabs.onRemoved events + re-list | 80.2 | 1 subscriber notification(s) |
| Plan flatten of "Bookmarks bar" | 0.9 | 10217 bookmarks, 410 folders |
| Run flatten against the fake API | 52.6 | includes fake API overhead |
| Bookmark store catches up with the move events | 2.0 |  |

## Side panel UI (`npm run harness`, then `npm run perf:ui`)

Production build of the real panel in headless Chrome at 1280×900, timed until the DOM shows the result and two frames have rendered. Filter steps include the 120 ms typing debounce.

| Step (median of 3 runs) | ms |
| --- | ---: |
| Panel boot to first rows (tabs mode) | 378 |
| Switch to Bookmarks (load tree, group, render) | 222 |
| Filter 20,000 bookmarks by "github" (incl. 120 ms debounce) | 173 |
| Clear filter | 198 |
| Move slider to 10 (regroup 20,000 bookmarks) | 52 |
| Scroll bookmark list to the bottom | 28 |
| Switch back to Tabs | 28 |
| Filter 5,000 tabs by "wikipedia" (incl. debounce) | 153 |
| Open duplicate finder (tabs + already bookmarked) | 167 |
| Rows in the DOM at once (virtualized) | 33 |

## Notes

- Every list is virtualized; about 33 rows are in the DOM whatever the item count.
- A burst of 1,000 tab events results in a single re-render (debounced notifications).
- With real Chrome, add the API round trip: one `tabs.query` and one `bookmarks.getTree` at startup. Bulk actions (grouping, closing, flattening) make one API call per tab or bookmark, so applying them to thousands of items is bounded by Chrome rather than by this code.

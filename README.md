# Berat Tab Manager

A Chrome (Manifest V3) side panel extension for managing hundreds to thousands of
open tabs and bookmarks by grouping them by root domain. Everything runs locally:
no host permissions, no network calls, no analytics.

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

## Development

- `npm run dev` serves a harness at http://localhost:5199/dev.html that runs the
  real side panel against an in-memory fake of the `chrome.*` API. Seed sizes with
  `?tabs=5000&bookmarks=20000`.
- `npm test` runs the unit tests (Vitest).

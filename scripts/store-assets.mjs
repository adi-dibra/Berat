// Renders Chrome Web Store assets into store/: four 1280x800 screenshots of
// the real side panel (running in the dev harness) and the 440x280 promo
// tile. Usage: npm run harness (in another terminal), then
// node scripts/store-assets.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { launch } from './cdp.mjs';
import { renderIcon } from './make-icons.mjs';

const base = process.argv[2] ?? 'http://localhost:5198';
mkdirSync('store', { recursive: true });

const helpers = `
  window.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  window.btn = (t) => [...document.querySelectorAll('#app button')].find((b) => b.textContent.trim().startsWith(t));
  window.ready = async () => { for (let i = 0; i < 100 && !document.querySelector('#app .vrow'); i++) await sleep(50); await sleep(300); };
`;

const shots = [
  {
    file: 'screenshot-1-tabs-by-domain.png',
    caption: 'Thousands of tabs, grouped by site|Every tab in this window, grouped by root domain in one pass. Set a minimum group size and focus any tab with a click.',
    script: '',
  },
  {
    file: 'screenshot-2-tab-groups.png',
    caption: 'Native Chrome tab groups in one click|Group every domain, sort groups by size, collapse, expand or ungroup them, and save any group as a bookmark folder.',
    script: `btn('Group all').click(); await sleep(1500); btn('Tab groups').click(); await sleep(300); btn('Sort by size').click(); await sleep(1200); btn('Collapse all').click(); await sleep(1200);`,
  },
  {
    file: 'screenshot-3-bookmarks.png',
    caption: 'Bookmarks, organized the same way|Scope to any folder, flatten nested subfolders, or open a folder as a tab group.',
    script: `btn('Bookmarks').click(); await sleep(800);`,
  },
  {
    file: 'screenshot-4-duplicates.png',
    caption: 'Find duplicates and close them safely|Smart URL matching ignores tracking parameters. Preview what is kept, apply, and undo if you change your mind.',
    script: `btn('Duplicates').click(); await sleep(1000);`,
  },
];

for (const [i, s] of shots.entries()) {
  const chrome = await launch({ width: 1280, height: 800, port: 9400 + i });
  try {
    await chrome.goto(`${base}/dev.html?tabs=1200&bookmarks=3000&shot=${encodeURIComponent(s.caption)}`);
    await chrome.eval(`(async () => { ${helpers} await ready(); ${s.script} document.activeElement?.blur(); await sleep(200); })()`);
    // Hide the toast so screenshots show the steady state.
    await chrome.eval(`document.querySelector('.toast button[aria-label=Dismiss]')?.click()`);
    await new Promise((r) => setTimeout(r, 300));
    writeFileSync(`store/${s.file}`, await chrome.screenshot());
    console.log('wrote store/' + s.file);
  } finally {
    await chrome.close();
  }
}

// Small promo tile, 440x280.
const icon = renderIcon(128).toString('base64');
const tile = `<html><body style="margin:0;width:440px;height:280px;display:flex;align-items:center;gap:22px;padding:0 30px;box-sizing:border-box;
  background:linear-gradient(135deg,#1a73e8,#0b3d91);font-family:system-ui,sans-serif;color:#fff">
  <div style="background:#fff;border-radius:28px;padding:12px;display:flex;flex:none;box-shadow:0 8px 24px rgba(0,0,0,.25)"><img src="data:image/png;base64,${icon}" width="88" height="88"></div>
  <div><div style="font:700 34px/1.1 system-ui">Berat Tab Manager</div>
  <div style="font:400 17px/1.35 system-ui;margin-top:10px;opacity:.92">Group thousands of tabs and bookmarks by site. Private: nothing leaves your browser.</div></div>
  </body></html>`;
const chrome = await launch({ width: 440, height: 280, port: 9450 });
try {
  await chrome.goto('data:text/html;base64,' + Buffer.from(tile).toString('base64'));
  writeFileSync('store/promo-small-440x280.png', await chrome.screenshot());
  console.log('wrote store/promo-small-440x280.png');
} finally {
  await chrome.close();
}

// Smoke test against real Chrome: loads dist/ as an unpacked extension in a
// throwaway headless profile (CDP Extensions.loadUnpacked over a debugging
// pipe), opens a few tabs, opens panel.html as a tab in the same window and
// checks grouping, a native tab group action and undo end to end.
// Usage: npm run build && node scripts/e2e-real.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { findChrome } from './cdp.mjs';

const profile = mkdtempSync(join(tmpdir(), 'berat-e2e-'));
const proc = spawn(findChrome(), [
  '--headless=new', '--remote-debugging-pipe', '--enable-unsafe-extension-debugging',
  // Resolve nothing: the test tabs never touch the network.
  '--host-resolver-rules=MAP * ~NOTFOUND',
  `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', 'about:blank',
], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });

const out = proc.stdio[3];
const inp = proc.stdio[4];
let buf = '';
let id = 0;
const pending = new Map();
inp.on('data', (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf('\0')) >= 0) {
    const msg = JSON.parse(buf.slice(0, i));
    buf = buf.slice(i + 1);
    const p = pending.get(msg.id);
    if (p) {
      pending.delete(msg.id);
      msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
    }
  }
});
const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
  const n = ++id;
  pending.set(n, { resolve: res, reject: rej });
  out.write(JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = false;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failed = true;
};

try {
  const { id: extId } = await send('Extensions.loadUnpacked', { path: resolve('dist') });
  check('extension loads', !!extId, extId);

  const urls = [
    'https://github.com/a', 'https://gist.github.com/b', 'https://news.bbc.co.uk/x',
    'https://www.bbc.co.uk/y', 'https://example.com/?utm_source=z', 'https://example.com/',
  ];
  // Tabs that never load (no network needed): the URL is set immediately.
  for (const url of urls) await send('Target.createTarget', { url, background: true });
  const { targetId } = await send('Target.createTarget', { url: `chrome-extension://${extId}/panel.html` });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  for (let i = 0; i < 50 && !(await evaluate(`!!document.querySelector('.vrow')`)); i++) await sleep(100);

  const text = await evaluate(`document.querySelector('#app').innerText`);
  check('panel renders tabs grouped by domain', /github\.com/.test(text) && /bbc\.co\.uk/.test(text), text.split('\n').find((l) => /tabs ·/.test(l)));
  check('bbc.co.uk subdomains share a group', /bbc\.co\.uk\n2/.test(text));

  await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.startsWith('Group all')).click()`);
  await sleep(1500);
  const groups = await evaluate(`chrome.tabGroups.query({}).then(gs => gs.map(g => g.title).sort())`);
  check('Group all creates native tab groups', JSON.stringify(groups) === JSON.stringify(['bbc.co.uk', 'example.com', 'github.com']), JSON.stringify(groups));

  await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.startsWith('↶ Undo')).click()`);
  await sleep(1500);
  const after = await evaluate(`chrome.tabGroups.query({}).then(gs => gs.length)`);
  check('Undo removes them again', after === 0, `${after} groups left`);

  await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent === 'Duplicates').click()`);
  await sleep(500);
  const dup = await evaluate(`document.querySelector('.summary.actions').innerText`);
  check('Duplicate finder matches example.com with tracking params', /1 duplicated URLs · 1 to close/.test(dup), dup.split('\n')[0]);

  await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent === 'Bookmarks').click()`);
  await sleep(800);
  const bm = await evaluate(`document.querySelector('#app').innerText`);
  check('Bookmarks mode loads', /bookmarks ·/.test(bm), bm.split('\n').find((l) => /bookmarks ·/.test(l)));
} catch (e) {
  console.error(e);
  failed = true;
} finally {
  proc.kill();
  await sleep(500);
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* still locked */ }
}
process.exit(failed ? 1 : 0);

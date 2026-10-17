/**
 * Dev harness entry: installs a fake chrome.* API seeded from the URL
 * (?tabs=5000&bookmarks=20000), then boots the real service worker code and
 * the real side panel in the same page. A crude tab strip on the left shows
 * what actions did to the fake window.
 */
import { FakeChrome, seedBookmarks, seedTabs } from './fakeChrome';

const params = new URLSearchParams(location.search);
const fake = new FakeChrome({ latency: Number(params.get('latency') ?? 0) });
seedTabs(fake, Number(params.get('tabs') ?? 300));
seedBookmarks(fake, Number(params.get('bookmarks') ?? 1000));
(globalThis as any).chrome = fake.api;
(globalThis as any).__fake = fake;
(globalThis as any).__bootStart = performance.now();

await import('../background/index');
await import('../panel/main');

const strip = document.getElementById('strip')!;
const shot = params.get('shot');
const colors: Record<string, string> = {
  grey: '#5f6368', blue: '#1a73e8', red: '#d93025', yellow: '#f9ab00', green: '#1e8e3e',
  pink: '#d01884', purple: '#9334e6', cyan: '#007b83', orange: '#fa903e',
};
const escapeHtml = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

let pending = false;
let frozen = false;
const drawStrip = () => {
  if (shot !== null) {
    // Store screenshot mode: a caption instead of the debug tab strip.
    document.body.classList.add('shot');
    const [title, sub] = shot.split('|');
    strip.innerHTML = `${escapeHtml(title)}${sub ? `<p>${escapeHtml(sub)}</p>` : ''}`;
    return;
  }
  if (pending || frozen) return;
  pending = true;
  setTimeout(async () => {
    pending = false;
    if (frozen) return;
    const [tabs, groups] = await Promise.all([
      fake.api.tabs.query({ currentWindow: true }),
      fake.api.tabGroups.query({ windowId: fake.currentWindowId }),
    ]);
    const byId = new Map(groups.map((x) => [x.id, x]));
    const shown = tabs.slice(0, 400);
    strip.innerHTML =
      `<h3>Fake window: ${tabs.length} tabs, ${groups.length} groups${tabs.length > shown.length ? ' (first 400 shown)' : ''}</h3>` +
      shown
        .map((t) => {
          const g = byId.get(t.groupId);
          const c = g ? colors[g.color] : 'transparent';
          const label = g ? `[${escapeHtml(g.title || 'untitled')}${g.collapsed ? ', collapsed' : ''}] ` : '';
          return `<div class="t${t.active ? ' active' : ''}" style="border-left-color:${c}">${t.index}. ${t.pinned ? '📌 ' : ''}${label}${escapeHtml(t.title ?? '')}</div>`;
        })
        .join('');
  }, 150);
};
for (const ev of ['onCreated', 'onRemoved', 'onUpdated', 'onMoved', 'onActivated'] as const)
  (fake.api.tabs[ev] as chrome.events.Event<() => void>).addListener(drawStrip);
for (const ev of ['onCreated', 'onUpdated', 'onRemoved', 'onMoved'] as const)
  (fake.api.tabGroups[ev] as chrome.events.Event<() => void>).addListener(drawStrip);
drawStrip();

if (params.get('perf') === '1') {
  const { runUiPerf } = await import('./uiPerf');
  const results = await runUiPerf((globalThis as any).__bootStart);
  (globalThis as any).__perfResults = results;
  frozen = true;
  const rows = results.map((r) => `<tr><td>${r.step}</td><td style="text-align:right">${r.step.startsWith('Rows') ? r.ms : r.ms.toFixed(0) + ' ms'}</td></tr>`).join('');
  strip.innerHTML = `<h3>UI timings: ${params.get('tabs')} tabs, ${params.get('bookmarks')} bookmarks</h3><table>${rows}</table>`;
  console.table(results);
}

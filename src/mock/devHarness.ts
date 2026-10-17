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
const colors: Record<string, string> = {
  grey: '#5f6368', blue: '#1a73e8', red: '#d93025', yellow: '#f9ab00', green: '#1e8e3e',
  pink: '#d01884', purple: '#9334e6', cyan: '#007b83', orange: '#fa903e',
};
const escapeHtml = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

let pending = false;
const drawStrip = () => {
  if (pending) return;
  pending = true;
  setTimeout(async () => {
    pending = false;
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

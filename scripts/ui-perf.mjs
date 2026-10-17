// UI performance run: loads the production-built dev harness in headless
// Chrome with 5,000 tabs and 20,000 bookmarks and records how long the side
// panel takes for each step (see src/mock/uiPerf.ts).
// Usage: npm run harness (in another terminal), then node scripts/ui-perf.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { launch } from './cdp.mjs';

const base = process.argv[2] ?? 'http://localhost:5198';
const runs = Number(process.argv[3] ?? 3);
const all = [];
for (let i = 0; i < runs; i++) {
  const chrome = await launch({ width: 1280, height: 900, port: 9333 + i });
  try {
    await chrome.goto(`${base}/dev.html?tabs=5000&bookmarks=20000&perf=1`);
    const results = await chrome.eval(`(async () => {
      for (let i = 0; i < 600 && !window.__perfResults; i++) await new Promise(r => setTimeout(r, 100));
      return window.__perfResults;
    })()`);
    if (!results) throw new Error('perf run did not finish');
    all.push(results);
  } finally {
    await chrome.close();
  }
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const rows = all[0].map((r, i) => {
  const ms = median(all.map((run) => run[i].ms));
  const value = r.step.startsWith('Rows') ? String(ms) : ms.toFixed(0);
  return `| ${r.step} | ${value} |`;
});
const table = [`| Step (median of ${runs} runs) | ms |`, '| --- | ---: |', ...rows].join('\n');
console.log(table);
mkdirSync('perf-results', { recursive: true });
writeFileSync('perf-results/ui.md', table + '\n');

/**
 * Scripted UI timing run for the dev harness: open
 * http://localhost:5199/dev.html?tabs=5000&bookmarks=20000&perf=1
 * and the results table replaces the fake tab strip. Each step is timed
 * until the panel has re-rendered (two animation frames after the DOM
 * reflects the change).
 */
const frames = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

async function until(cond: () => boolean, timeout = 20_000): Promise<void> {
  const start = performance.now();
  while (!cond()) {
    if (performance.now() - start > timeout) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 1));
  }
  await frames();
}

const summaryText = () => [...document.querySelectorAll('#app .summary')].map((e) => (e as HTMLElement).innerText).join(' | ');
const button = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('#app button')].find((b) => b.textContent?.trim().startsWith(label))!;
const setInput = (el: HTMLInputElement, value: string, type = 'input') => {
  el.value = value;
  el.dispatchEvent(new Event(type, { bubbles: true }));
};

export async function runUiPerf(bootStart: number): Promise<{ step: string; ms: number }[]> {
  const out: { step: string; ms: number }[] = [];
  const step = async (name: string, act: () => void, done: () => boolean) => {
    const t0 = performance.now();
    act();
    await until(done);
    out.push({ step: name, ms: performance.now() - t0 });
  };

  await until(() => !!document.querySelector('#app .vrow'));
  out.push({ step: 'Panel boot to first rows (tabs mode)', ms: performance.now() - bootStart });
  const rowsInDom = document.querySelectorAll('#app .vrow').length;

  await step('Switch to Bookmarks (load tree, group, render)', () => button('Bookmarks').click(),
    () => /bookmarks ·/.test(summaryText()));
  const search = document.querySelector<HTMLInputElement>('#app input.search')!;
  await step('Filter 20,000 bookmarks by "github" (incl. 120 ms debounce)', () => setInput(search, 'github'),
    () => / of \d+ bookmarks/.test(summaryText()));
  await step('Clear filter', () => setInput(search, ''), () => !/ of \d+ bookmarks/.test(summaryText()));
  const slider = document.querySelector<HTMLInputElement>('#app input[type=range]')!;
  await step('Move slider to 10 (regroup 20,000 bookmarks)', () => setInput(slider, '10'),
    () => /Min per group: 10/.test(document.querySelector('#app .slider')!.textContent ?? ''));
  const list = document.querySelector<HTMLElement>('#app .vlist')!;
  await step('Scroll bookmark list to the bottom', () => { list.scrollTop = list.scrollHeight; list.dispatchEvent(new Event('scroll')); },
    () => [...list.querySelectorAll('.vrow')].some((r) => parseFloat((r as HTMLElement).style.top) + 40 >= list.scrollHeight - list.clientHeight));
  await step('Switch back to Tabs', () => button('Tabs').click(), () => /tabs ·/.test(summaryText()));
  await step('Filter 5,000 tabs by "wikipedia" (incl. debounce)', () => setInput(search, 'wikipedia'),
    () => / of \d+ tabs/.test(summaryText()));
  setInput(search, '');
  await until(() => !/ of \d+ tabs/.test(summaryText()));
  await step('Open duplicate finder (tabs + already bookmarked)', () => button('Duplicates').click(),
    () => /duplicated URLs/.test(summaryText()));
  button('Duplicates').click();
  await frames();
  setInput(slider, '2');
  out.push({ step: `Rows in the DOM at once (virtualized)`, ms: rowsInDom });
  return out;
}

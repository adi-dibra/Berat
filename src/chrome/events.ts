/** Small helper to register many chrome event listeners and remove them all at once. */
export class ListenerBag {
  private offs: (() => void)[] = [];

  on<A extends unknown[]>(
    event: { addListener(cb: (...args: A) => void): void; removeListener(cb: (...args: A) => void): void },
    cb: (...args: A) => void,
  ): void {
    event.addListener(cb);
    this.offs.push(() => event.removeListener(cb));
  }

  clear(): void {
    for (const off of this.offs) off();
    this.offs = [];
  }
}

/** Trailing debounce that also caps the wait so a constant event stream still renders. */
export function debounce(fn: () => void, wait: number, maxWait = wait * 4): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let first = 0;
  return () => {
    const now = Date.now();
    if (timer === undefined) first = now;
    else clearTimeout(timer);
    const delay = Math.max(0, Math.min(wait, first + maxWait - now));
    timer = setTimeout(() => {
      timer = undefined;
      fn();
    }, delay);
  };
}

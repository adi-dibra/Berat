import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';

interface Props<R> {
  rows: readonly R[];
  rowHeight: number;
  renderRow: (row: R, index: number, active: boolean) => ComponentChildren;
  rowKey: (row: R) => string;
  /** Keyboard-active row index, or -1. */
  activeIndex: number;
  onActiveIndexChange: (i: number) => void;
  onKeyDown?: (e: KeyboardEvent, row: R | undefined) => void;
  label: string;
  overscan?: number;
}

/**
 * Fixed-row-height virtualized list. Only rows in (and near) the viewport are
 * in the DOM, so 20,000 rows cost the same to render as 30.
 */
export function VirtualList<R>(p: Props<R>) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(600);
  const overscan = p.overscan ?? 8;

  useLayoutEffect(() => {
    const el = ref.current!;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    setHeight(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  // Keep the keyboard-active row visible.
  useEffect(() => {
    const el = ref.current;
    if (!el || p.activeIndex < 0) return;
    const top = p.activeIndex * p.rowHeight;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + p.rowHeight > el.scrollTop + el.clientHeight) el.scrollTop = top + p.rowHeight - el.clientHeight;
  }, [p.activeIndex, p.rowHeight]);

  const total = p.rows.length;
  const first = Math.max(0, Math.floor(scrollTop / p.rowHeight) - overscan);
  const last = Math.min(total, Math.ceil((scrollTop + height) / p.rowHeight) + overscan);
  const pageRows = Math.max(1, Math.floor(height / p.rowHeight) - 1);

  const onKeyDown = (e: KeyboardEvent) => {
    const i = p.activeIndex;
    let next = i;
    switch (e.key) {
      case 'ArrowDown': next = Math.min(total - 1, i + 1); break;
      case 'ArrowUp': next = Math.max(0, i - 1); break;
      case 'PageDown': next = Math.min(total - 1, i + pageRows); break;
      case 'PageUp': next = Math.max(0, i - pageRows); break;
      case 'Home': next = 0; break;
      case 'End': next = total - 1; break;
      default:
        p.onKeyDown?.(e, p.rows[i]);
        return;
    }
    e.preventDefault();
    p.onActiveIndexChange(next);
  };

  const items = [];
  for (let i = first; i < last; i++) {
    const row = p.rows[i];
    const active = i === p.activeIndex;
    items.push(
      <div
        key={p.rowKey(row)}
        id={`row-${i}`}
        class={'vrow' + (active ? ' kb-active' : '')}
        style={{ top: `${i * p.rowHeight}px`, height: `${p.rowHeight}px` }}
        role="option"
        aria-selected={active}
        aria-setsize={total}
        aria-posinset={i + 1}
        onMouseDown={() => p.onActiveIndexChange(i)}
      >
        {p.renderRow(row, i, active)}
      </div>,
    );
  }

  return (
    <div
      ref={ref}
      class="vlist"
      tabIndex={0}
      role="listbox"
      aria-label={p.label}
      aria-activedescendant={p.activeIndex >= 0 && p.activeIndex < total ? `row-${p.activeIndex}` : undefined}
      onScroll={(e) => setScrollTop((e.currentTarget as HTMLDivElement).scrollTop)}
      onKeyDown={onKeyDown}
      onFocus={() => { if (p.activeIndex < 0 && total) p.onActiveIndexChange(0); }}
    >
      <div class="vspacer" style={{ height: `${total * p.rowHeight}px` }}>{items}</div>
    </div>
  );
}

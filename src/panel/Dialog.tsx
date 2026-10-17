import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';

export interface DialogOptions {
  title: string;
  body: ComponentChildren;
  confirmLabel: string;
  danger?: boolean;
  /** Hide the cancel button (information only). */
  noCancel?: boolean;
}

export function Dialog(p: DialogOptions & { onClose: (ok: boolean) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    confirmRef.current?.focus();
    return () => prev?.focus();
  }, []);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      p.onClose(false);
    } else if (e.key === 'Tab') {
      // Keep focus inside the dialog.
      const focusables = ref.current!.querySelectorAll<HTMLElement>('button, input, select, [tabindex="0"]');
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };

  return (
    <div class="backdrop" onClick={(e) => { if (e.target === e.currentTarget) p.onClose(false); }}>
      <div ref={ref} class="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title" onKeyDown={onKeyDown}>
        <h2 id="dialog-title">{p.title}</h2>
        <div class="body">{p.body}</div>
        <div class="foot">
          {!p.noCancel && <button class="btn" onClick={() => p.onClose(false)}>Cancel</button>}
          <button ref={confirmRef} class={'btn primary' + (p.danger ? ' danger' : '')} onClick={() => p.onClose(true)}>
            {p.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

import { useState } from 'preact/hooks';

/** A 16px favicon, or a letter badge when there is no icon or it fails to load. */
export function Icon({ src, label }: { src?: string; label: string }) {
  const [failed, setFailed] = useState(false);
  if (src && !failed) {
    return <img class="icon" src={src} alt="" width={16} height={16} loading="lazy" onError={() => setFailed(true)} />;
  }
  const letter = (label.replace(/^www\./, '').trim()[0] ?? '?').toUpperCase();
  return <span class="icon letter" aria-hidden="true">{letter}</span>;
}

export function hostLabel(url: string | undefined): string {
  try {
    return new URL(url ?? '').hostname || '?';
  } catch {
    return '?';
  }
}

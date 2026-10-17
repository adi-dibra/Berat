import { useEffect, useState } from 'preact/hooks';

interface Subscribable {
  version: number;
  subscribe(fn: () => void): () => void;
}

/** Re-renders when the store publishes a new version. Returns that version. */
export function useStoreVersion(store: Subscribable | null): number {
  const [v, setV] = useState(store?.version ?? 0);
  useEffect(() => {
    if (!store) return;
    setV(store.version);
    return store.subscribe(() => setV(store.version));
  }, [store]);
  return v;
}

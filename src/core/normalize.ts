/** Rules for deciding when two URLs count as the same page. All are configurable in the panel. */
export interface NormalizeRules {
  /** Treat http and https as the same. */
  ignoreScheme: boolean;
  /** Drop the #fragment. */
  stripFragment: boolean;
  /** Drop trailing slashes from the path. */
  stripTrailingSlash: boolean;
  /** Drop query parameters listed in `trackingParams`. */
  stripTracking: boolean;
  /** Parameter names to drop; a trailing `*` matches a prefix (`utm_*`). Case-insensitive. */
  trackingParams: string[];
  /** Treat www.example.com and example.com as the same. */
  stripWww: boolean;
  /** Ignore the order of query parameters. */
  sortQuery: boolean;
  /** Ignore the whole query string. */
  ignoreQuery: boolean;
}

export const DEFAULT_TRACKING_PARAMS = [
  'utm_*', 'fbclid', 'gclid', 'dclid', 'gbraid', 'wbraid', 'msclkid', 'yclid', 'twclid', 'ttclid',
  'igshid', 'mc_cid', 'mc_eid', '_hsenc', '_hsmi', 'mkt_tok', 'li_fat_id', 'oly_anon_id', 'oly_enc_id', 'vero_id',
];

export const DEFAULT_RULES: NormalizeRules = {
  ignoreScheme: true,
  stripFragment: true,
  stripTrailingSlash: true,
  stripTracking: true,
  trackingParams: DEFAULT_TRACKING_PARAMS,
  stripWww: false,
  sortQuery: false,
  ignoreQuery: false,
};

type Matcher = (name: string) => boolean;
const matcherCache = new WeakMap<string[], Matcher>();

function trackingMatcher(params: string[]): Matcher {
  let m = matcherCache.get(params);
  if (m) return m;
  const exact = new Set<string>();
  const prefixes: string[] = [];
  for (const raw of params) {
    const p = raw.trim().toLowerCase();
    if (!p) continue;
    if (p.endsWith('*')) prefixes.push(p.slice(0, -1));
    else exact.add(p);
  }
  m = (name) => {
    const n = name.toLowerCase();
    return exact.has(n) || prefixes.some((p) => n.startsWith(p));
  };
  matcherCache.set(params, m);
  return m;
}

function paramName(part: string): string {
  const raw = part.split('=', 1)[0];
  try {
    return decodeURIComponent(raw.replace(/\+/g, ' '));
  } catch {
    return raw;
  }
}

/**
 * Canonical comparison key for a URL. The host is always lowercased and
 * default ports dropped (by the URL parser); everything else follows `rules`.
 * Strings that are not URLs are returned unchanged.
 */
export function normalizeUrl(url: string, rules: NormalizeRules = DEFAULT_RULES): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  const web = u.protocol === 'http:' || u.protocol === 'https:';
  if (!web) {
    // chrome://, file://, about: etc.: only the fragment rule applies.
    return rules.stripFragment ? url.replace(/#.*$/, '') : url;
  }

  let host = u.hostname.toLowerCase();
  if (rules.stripWww && host.startsWith('www.')) host = host.slice(4);
  const port = u.port ? `:${u.port}` : '';

  let path = u.pathname;
  if (rules.stripTrailingSlash) path = path.replace(/\/+$/, '');

  let query = '';
  if (!rules.ignoreQuery && u.search.length > 1) {
    let parts = u.search.slice(1).split('&').filter(Boolean);
    if (rules.stripTracking) {
      const isTracking = trackingMatcher(rules.trackingParams);
      parts = parts.filter((p) => !isTracking(paramName(p)));
    }
    if (rules.sortQuery) parts.sort();
    if (parts.length) query = '?' + parts.join('&');
  }

  const hash = rules.stripFragment || !u.hash ? '' : u.hash;
  const scheme = rules.ignoreScheme ? '' : u.protocol + '//';
  return scheme + host + port + path + query + hash;
}

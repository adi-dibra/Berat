import { parse } from 'tldts';

/**
 * Grouping key for a URL: the registrable ("root") domain according to the
 * public suffix list, including private suffixes, so `news.bbc.co.uk` gives
 * `bbc.co.uk` and `foo.github.io` stays `foo.github.io`.
 *
 * Non-web URLs get a readable bucket instead: `chrome://`, `file://`, etc.
 */
const cache = new Map<string, string>();
const CACHE_LIMIT = 50_000;

const WEB_SCHEMES = new Set(['http:', 'https:', 'ws:', 'wss:', 'ftp:']);

export function rootDomain(url: string | undefined | null): string {
  if (!url) return '(no url)';
  const scheme = schemeOf(url);
  if (!scheme) return '(invalid url)';
  if (!WEB_SCHEMES.has(scheme)) {
    return scheme === 'about:' || scheme === 'data:' || scheme === 'javascript:'
      ? scheme
      : scheme + '//';
  }
  const host = hostOf(url);
  if (!host) return '(invalid url)';
  let domain = cache.get(host);
  if (domain === undefined) {
    domain = domainForHost(host);
    if (cache.size >= CACHE_LIMIT) cache.clear();
    cache.set(host, domain);
  }
  return domain;
}

/** Root domain for a bare hostname (already lowercased, no port). */
export function domainForHost(host: string): string {
  const h = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  const r = parse(h, { allowPrivateDomains: true, extractHostname: false });
  if (r.isIp) return h;
  // Hosts without a known suffix (localhost, intranet names) group by themselves.
  return r.domain ?? h.replace(/\.$/, '');
}

function schemeOf(url: string): string | null {
  const i = url.indexOf(':');
  if (i <= 0) return null;
  const s = url.slice(0, i + 1).toLowerCase();
  return /^[a-z][a-z0-9+.-]*:$/.test(s) ? s : null;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

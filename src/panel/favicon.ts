/**
 * Favicon source for a row. Tabs carry `favIconUrl` (the icon Chrome already
 * shows in the tab strip). Without the optional `favicon` permission there is
 * no local icon for bookmarks, so they get a letter badge instead.
 */
const hasFaviconPermission = (() => {
  try {
    return (chrome.runtime.getManifest().permissions ?? []).includes('favicon' as chrome.runtime.ManifestPermission);
  } catch {
    return false;
  }
})();

export function faviconSrc(pageUrl: string | undefined, favIconUrl?: string): string | undefined {
  if (hasFaviconPermission && pageUrl) {
    return `/_favicon/?pageUrl=${encodeURIComponent(pageUrl)}&size=16`;
  }
  if (favIconUrl && /^(https?:|data:)/.test(favIconUrl)) return favIconUrl;
  return undefined;
}

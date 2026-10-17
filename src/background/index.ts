/**
 * Service worker. Opens the side panel from the toolbar button.
 * Bulk actions are added here in later phases so they finish even if the
 * panel is closed mid-way.
 */
const openOnClick = () =>
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);

chrome.runtime.onInstalled.addListener(openOnClick);
chrome.runtime.onStartup.addListener(openOnClick);
export {};

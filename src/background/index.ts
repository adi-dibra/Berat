/**
 * Service worker: opens the side panel from the toolbar button and runs bulk
 * actions requested by the panel, so they complete even if the panel closes.
 */
import { handleRequest } from './handler';
import type { Request } from '../shared/messages';

const openOnClick = () =>
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);

chrome.runtime.onInstalled.addListener(openOnClick);
chrome.runtime.onStartup.addListener(openOnClick);

chrome.runtime.onMessage.addListener((msg: Request, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  handleRequest(chrome, msg).then(sendResponse, (e: unknown) =>
    sendResponse({ ok: false, message: e instanceof Error ? e.message : String(e) }),
  );
  return true;
});

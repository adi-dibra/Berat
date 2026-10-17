import * as bookmarks from '../actions/bookmarkActions';
import * as convert from '../actions/convertActions';
import * as remove from '../actions/removeActions';
import * as tabs from '../actions/tabActions';
import type { Request, Response } from '../shared/messages';
import type { ActionResult } from '../shared/types';

/** Runs one panel request. Kept free of globals so tests can pass a fake API. */
export async function handleRequest(api: typeof chrome, req: Request): Promise<Response> {
  let result: ActionResult;
  switch (req.type) {
    case 'groupDomain':
      result = await tabs.groupDomain(api, req.windowId, req.domain);
      break;
    case 'groupAll':
      result = await tabs.groupAllDomains(api, req.windowId, req.minSize);
      break;
    case 'setCollapsed':
      result = await tabs.setCollapsed(api, req.windowId, req.groupIds, req.collapsed);
      break;
    case 'sortGroups':
      result = await tabs.sortGroupsBySize(api, req.windowId, req.ascending);
      break;
    case 'ungroup':
      result = await tabs.ungroup(api, req.windowId, req.groupIds);
      break;
    case 'flattenFolder':
      result = await bookmarks.flattenFolder(api, req.folderId);
      break;
    case 'groupToFolder':
      result = await convert.tabGroupToFolder(api, req.windowId, req.groupId);
      break;
    case 'folderToGroup':
      result = await convert.folderToTabGroup(api, req.windowId, req.folderId);
      break;
    case 'closeTabs':
      result = await remove.closeTabs(api, req.windowId, req.tabIds, req.label);
      break;
    case 'deleteBookmarks':
      result = await remove.deleteBookmarks(api, req.ids, req.label);
      break;
    default:
      return { ok: false, message: `Unknown request ${(req as { type: string }).type}` };
  }
  return { ok: true, message: result.message };
}

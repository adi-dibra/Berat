/**
 * Requests the side panel sends to the service worker. Bulk actions run in
 * the service worker so they complete even if the panel is closed mid-way.
 */
export type Request =
  | { type: 'groupDomain'; windowId: number; domain: string }
  | { type: 'groupAll'; windowId: number; minSize: number }
  | { type: 'setCollapsed'; windowId: number; groupIds: number[] | null; collapsed: boolean }
  | { type: 'sortGroups'; windowId: number; ascending: boolean }
  | { type: 'ungroup'; windowId: number; groupIds: number[] | null }
  | { type: 'flattenFolder'; folderId: string }
  | { type: 'groupToFolder'; windowId: number; groupId: number }
  | { type: 'folderToGroup'; windowId: number; folderId: string };

export interface Response {
  ok: boolean;
  message: string;
  /** Present when the action can be undone. */
  undoId?: string;
}

export async function send(req: Request): Promise<Response> {
  try {
    const res = (await chrome.runtime.sendMessage(req)) as Response | undefined;
    return res ?? { ok: false, message: 'No response from the extension service worker.' };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

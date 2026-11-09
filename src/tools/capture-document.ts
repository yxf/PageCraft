export async function checkCaptureDocument(tabId: number, expected?: string) {
  const tab = await chrome.tabs.get(tabId);
  if (!tab.active) throw new Error('目标标签页已切换，截图已停止');
  const [frame] = await chrome.scripting.executeScript({
    target: { tabId, frameIds: [0] },
    func: () => true,
  });
  if (!frame?.documentId || (expected && frame.documentId !== expected))
    throw new Error('页面文档已刷新或跳转，截图已停止');
  if (!(await chrome.tabs.get(tabId)).active) throw new Error('目标标签页已切换，截图已停止');
  return frame.documentId;
}

type SurfaceMode = 'popup' | 'sidepanel';
let queue: Promise<unknown> = Promise.resolve();
async function applyMode(mode: SurfaceMode) {
  await chrome.action.setPopup({ popup: mode === 'popup' ? 'index.html?surface=popup' : '' });
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: mode === 'sidepanel' });
}
export async function restoreSurfaceMode() {
  const { surfaceMode } = await chrome.storage.local.get('surfaceMode');
  await applyMode(surfaceMode === 'sidepanel' ? 'sidepanel' : 'popup');
}
export function setSurfaceMode(mode: unknown) {
  if (mode !== 'popup' && mode !== 'sidepanel') throw new Error('无效的打开方式');
  const job = queue.then(async () => {
    try {
      await applyMode(mode);
      await chrome.storage.local.set({ surfaceMode: mode });
    } catch (error) {
      await restoreSurfaceMode().catch(() => {});
      throw error;
    }
  });
  queue = job.catch(() => {});
  return job;
}

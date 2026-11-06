import { capturePage, extractPageText } from './page';
import { captureError } from './capture-error';
import {
  capturePositions,
  checkCanvasSize,
  toolDefinitions,
  type ToolId,
  type ToolResult,
  type ToolStatus,
} from './registry';

let status: ToolStatus | undefined;
let controller: AbortController | undefined;
let lastCapture = 0;
export const getToolStatus = () => status;
export function cancelTool(id: string) {
  if (status?.id === id) controller?.abort();
}
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
function dataBlob(url: string) {
  const bytes = Uint8Array.from(atob(url.split(',')[1]), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: 'image/png' });
}
async function pngData(canvas: OffscreenCanvas) {
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  if (blob.size > 20000000) throw new Error('图片文件过大，请改用可视区域截图');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return 'data:image/png;base64,' + btoa(binary);
}
export async function runTool(id: string, tool: ToolId, tabId: number): Promise<ToolResult> {
  if (!toolDefinitions.some((t) => t.id === tool)) throw new Error('未知工具');
  if (status?.running) throw new Error('已有工具正在运行，请等待或取消');
  const tab = await chrome.tabs.get(tabId);
  if (!tab.url || !/^https?:\/\//.test(tab.url))
    throw new Error('此工具仅支持普通 HTTP/HTTPS 网页');
  // Recheck after the asynchronous lookup to prevent two simultaneous captures.
  if (status?.running) throw new Error('已有工具正在运行，请等待或取消');
  const abort = new AbortController();
  controller = abort;
  status = { id, tool, tabId, stage: '准备中', current: 0, total: 1, running: true };
  const timer = setTimeout(() => abort.abort(), 120000);
  const keep = setInterval(() => void chrome.runtime.getPlatformInfo(), 20000);
  let documentId: string | undefined;
  const check = () => {
    if (abort.signal.aborted) throw new Error('工具已取消或超过 2 分钟');
  };
  const currentTab = async () => {
    check();
    const current = await chrome.tabs.get(tabId);
    if (current.url !== tab.url || !current.active)
      throw new Error('页面或活动标签已变化，截图已停止');
  };
  const exec = async (command: 'prepare' | 'move' | 'restore', full: boolean, x = 0, y = 0) => {
    const results = await chrome.scripting.executeScript({
      target: documentId ? { tabId, documentIds: [documentId] } : { tabId },
      func: capturePage,
      args: [command, id, full, x, y],
    });
    if (command === 'prepare') documentId = results[0]?.documentId;
    return results[0]?.result;
  };
  const name = `pagecraft-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  try {
    if (tool === 'extract-text') {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId },
        func: extractPageText,
      });
      check();
      if (!result?.result?.text) throw new Error('未找到可提取的页面文本');
      status.stage = '已提取';
      status.current = 1;
      return {
        kind: 'text',
        filename: name + '.txt',
        data: result.result.text,
        warning: result.result.truncated ? '内容过长，仅提取前一部分文本' : undefined,
      };
    }
    await currentTab();
    // Check activeTab permission before modifying the page.
    await delay(Math.max(0, 650 - (Date.now() - lastCapture)));
    lastCapture = Date.now();
    try {
      await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    } catch (error) {
      throw captureError(error);
    }
    const full = tool === 'screenshot-full';
    const initial = await exec('prepare', full);
    if (!initial) throw new Error('无法读取页面尺寸');
    const xs = full ? capturePositions(initial.width, initial.viewportWidth) : [initial.x];
    const ys = full ? capturePositions(initial.height, initial.viewportHeight) : [initial.y];
    if (xs.length * ys.length > 60)
      throw new Error('页面过长，请改用可视区域截图；不支持无限滚动截图');
    status.total = xs.length * ys.length;
    let canvas: OffscreenCanvas | undefined,
      context: OffscreenCanvasRenderingContext2D | null = null;
    let scaleX = 1,
      scaleY = 1;
    for (const y of ys)
      for (const x of xs) {
        await currentTab();
        if (full) await exec('move', true, x, y);
        await delay(Math.max(350, 650 - (Date.now() - lastCapture)));
        await currentTab();
        const actual = await exec('move', full, x, y);
        if (
          !actual ||
          actual.viewportWidth !== initial.viewportWidth ||
          actual.viewportHeight !== initial.viewportHeight ||
          (full && (actual.height !== initial.height || actual.width !== initial.width))
        )
          throw new Error('页面尺寸变化，请等待加载完成后重试；无限滚动页面请用可视区域截图');
        if (Math.abs(actual.x - x) > 1 || Math.abs(actual.y - y) > 1)
          throw new Error('页面无法滚动到目标位置，请改用可视区域截图');
        lastCapture = Date.now();
        const url = await chrome.tabs
          .captureVisibleTab(tab.windowId, { format: 'png' })
          .catch((error) => {
            throw captureError(error);
          });
        await currentTab();
        const bitmap = await createImageBitmap(dataBlob(url));
        try {
          if (!canvas) {
            scaleX = bitmap.width / initial.viewportWidth;
            scaleY = bitmap.height / initial.viewportHeight;
            const width = full ? Math.round(initial.width * scaleX) : bitmap.width;
            const height = full ? Math.round(initial.height * scaleY) : bitmap.height;
            checkCanvasSize(width, height);
            canvas = new OffscreenCanvas(width, height);
            context = canvas.getContext('2d');
            if (!context) throw new Error('无法创建截图画布');
          } else if (
            bitmap.width !== Math.round(initial.viewportWidth * scaleX) ||
            bitmap.height !== Math.round(initial.viewportHeight * scaleY)
          )
            throw new Error('截图缩放发生变化，请重试');
          context!.drawImage(
            bitmap,
            full ? Math.round(actual.x * scaleX) : 0,
            full ? Math.round(actual.y * scaleY) : 0,
          );
        } finally {
          bitmap.close();
        }
        status.current++;
        status.stage = `正在截图 ${status.current}/${status.total}`;
      }
    check();
    status.stage = '正在合并';
    const data = await pngData(canvas!);
    check();
    status.stage = '已完成';
    return {
      kind: 'image',
      filename: name + '.png',
      data,
      width: canvas!.width,
      height: canvas!.height,
      warning: full
        ? '按当前已加载页面拼接；嵌套滚动区域、视频及动态内容可能与原页面不同'
        : undefined,
    };
  } catch (e) {
    status.stage = '未完成';
    status.error = (e as Error).message;
    throw e;
  } finally {
    if (documentId) await exec('restore', false).catch(() => {});
    clearTimeout(timer);
    clearInterval(keep);
    status.running = false;
    controller = undefined;
  }
}

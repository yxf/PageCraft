import { readState, transact } from '../store';
import { requestAI } from '../ai';
import { collectContext } from '../context';
import { REQUEST_TIMEOUT_MS, abortMessage } from '../stream';
import { currentTool, normalizeResult, saveCustom, validateCustom } from './custom-model';
import { customCode } from './custom-runtime';
import { runTool, cancelTool, getToolStatus } from './runner';

export interface CustomStatus {
  id: string;
  phase: 'generate' | 'run';
  running: boolean;
  stage: string;
  receivedChars?: number;
  error?: string;
}
let status: CustomStatus | undefined;
let job:
  | {
      id: string;
      controller: AbortController;
      tabId?: number;
      documentId?: string;
      helpers: Set<string>;
    }
  | undefined;
export const customStatus = () => status;
export function cancelCustom(id?: string, timeout = false) {
  if (!job || (id && job.id !== id)) return;
  job.controller.abort(
    new DOMException(timeout ? '任务超时' : '任务已取消', timeout ? 'TimeoutError' : 'AbortError'),
  );
  for (const child of job.helpers) cancelTool(child);
  if (job.tabId && job.documentId)
    void chrome.userScripts
      .execute({
        target: { tabId: job.tabId, documentIds: [job.documentId] },
        world: 'USER_SCRIPT',
        worldId: 'pagecraft-tools',
        js: [{ code: `globalThis[${JSON.stringify('__pagecraftCustom_' + job.id)}]?.()` }],
      })
      .catch(() => {});
}
export async function customCall(message: any, sender: chrome.runtime.MessageSender) {
  const active = job;
  if (
    !active ||
    active.controller.signal.aborted ||
    status?.phase !== 'run' ||
    message.id !== active.id ||
    sender.tab?.id !== active.tabId ||
    sender.documentId !== active.documentId ||
    sender.frameId !== 0
  )
    throw new Error('工具调用已过期或来源不匹配');
  if (!['screenshot', 'extract-text'].includes(message.action)) throw new Error('未知内置工具');
  const id = crypto.randomUUID();
  active.helpers.add(id);
  try {
    const tool =
      message.action === 'extract-text'
        ? 'extract-text'
        : message.options?.fullPage
          ? 'screenshot-full'
          : 'screenshot-visible';
    const result = await runTool(id, tool, active.tabId!);
    active.controller.signal.throwIfAborted();
    return result;
  } finally {
    active.helpers.delete(id);
  }
}
export async function handleCustom(message: any) {
  const state = await readState();
  switch (message.type) {
    case 'CUSTOM_LIST':
      return state.customTools;
    case 'CUSTOM_STATUS':
      return status;
    case 'CUSTOM_CANCEL':
      cancelCustom(message.id);
      return;
    case 'CUSTOM_SAVE':
      return transact((s) =>
        saveCustom(s.customTools, message.data, message.id, message.expectedVersion),
      );
    case 'CUSTOM_DELETE':
      return transact((s) => {
        s.customTools = s.customTools.filter((t) => t.id !== message.id);
      });
    case 'CUSTOM_ROLLBACK':
      return transact((s) => {
        const tool = s.customTools.find((t) => t.id === message.id);
        if (!tool || !tool.versions.some((v) => v.id === message.versionId))
          throw new Error('版本不存在');
        if (tool.activeVersionId !== message.expectedVersion)
          throw new Error('工具已更新，请重新打开');
        tool.activeVersionId = message.versionId;
        return tool;
      });
  }
  if (!['CUSTOM_GENERATE', 'CUSTOM_RUN'].includes(message.type)) throw new Error('未知工具操作');
  if (job || getToolStatus()?.running) throw new Error('已有工具任务，请等待或取消');
  const phase = message.type === 'CUSTOM_GENERATE' ? 'generate' : 'run';
  const controller = new AbortController(),
    id = crypto.randomUUID();
  const active = {
    id,
    controller,
    helpers: new Set<string>(),
    tabId: undefined as number | undefined,
    documentId: undefined as string | undefined,
  };
  job = active;
  status = {
    id,
    phase,
    running: true,
    stage: phase === 'generate' ? 'AI 正在生成工具' : '工具正在运行',
  };
  const timer = setTimeout(
    () => cancelCustom(id, true),
    phase === 'generate' ? REQUEST_TIMEOUT_MS : 120000,
  );
  const keep = setInterval(() => void chrome.runtime.getPlatformInfo(), 20000);
  try {
    if (phase === 'generate') {
      if (!state.settings.consent) throw new Error('请在设置页确认 AI 内容发送授权');
      if (typeof message.prompt !== 'string' || !message.prompt.trim())
        throw new Error('请描述工具功能');
      let context = { url: '', title: '', summary: '', truncated: false };
      if (message.includeContext) {
        const tab = await chrome.tabs.get(message.tabId);
        if (!tab.url || !/^https?:\/\//.test(tab.url)) throw new Error('请切换到普通网页');
        const [response] = await chrome.scripting.executeScript({
          target: { tabId: message.tabId },
          func: collectContext,
          args: [false],
        });
        if (!response?.result) throw new Error('页面摘要采集失败');
        context = response.result;
      }
      const previous = message.previous
        ? { ...validateCustom(message.previous), id: 'draft', createdAt: 0 }
        : undefined;
      const data = await requestAI(
        state.settings,
        message.prompt,
        context,
        previous,
        controller.signal,
        (receivedChars) => {
          if (status?.id === id) status.receivedChars = receivedChars;
        },
        'tool',
        message.autoStart?.enabled === true,
      );
      controller.signal.throwIfAborted();
      status.stage = '代码已生成，尚未保存';
      return { ...data, params: message.params || {}, prompt: message.prompt };
    }
    const saved = message.toolId
      ? state.customTools.find((t) => t.id === message.toolId)
      : undefined;
    if (message.toolId && !saved) throw new Error('工具已删除');
    const draft = validateCustom(saved ? currentTool(saved) : message.data);
    const params = message.params ?? draft.params;
    if (!params || typeof params !== 'object' || Array.isArray(params))
      throw new Error('参数必须为 JSON 对象');
    const tab = await chrome.tabs.get(message.tabId);
    if (!tab.url || !/^https?:\/\//.test(tab.url)) throw new Error('请切换到普通网页');
    if (!chrome.userScripts) throw new Error('请在扩展详情开启“允许用户脚本”');
    await chrome.userScripts.getScripts();
    await chrome.userScripts.configureWorld({
      worldId: 'pagecraft-tools',
      messaging: true,
      csp: "script-src * 'unsafe-inline' 'unsafe-eval' data: blob:; connect-src * data: blob:; object-src *",
    });
    const [document] = await chrome.scripting.executeScript({
      target: { tabId: message.tabId },
      func: () => location.href,
    });
    if (!document?.documentId) throw new Error('目标页面已变化');
    active.tabId = message.tabId;
    active.documentId = document.documentId;
    controller.signal.throwIfAborted();
    const cancelled = new Promise<never>((_, reject) =>
      controller.signal.addEventListener('abort', () => reject(new Error('工具已取消或超时')), {
        once: true,
      }),
    );
    const results = await Promise.race([
      chrome.userScripts.execute({
        target: { tabId: message.tabId, documentIds: [document.documentId] },
        world: 'USER_SCRIPT',
        worldId: 'pagecraft-tools',
        js: [{ code: customCode(id, params, draft.css, draft.script) }],
        injectImmediately: true,
      }),
      cancelled,
    ]);
    controller.signal.throwIfAborted();
    const result = results[0];
    if (result?.error) throw new Error(result.error);
    const value = result?.result as any;
    if (!value?.ok) throw new Error(value?.error || '页面关闭或工具未返回结果');
    status.stage = '运行完成';
    return normalizeResult(value.data);
  } catch (e) {
    const error = new Error(
      controller.signal.aborted
        ? phase === 'generate'
          ? abortMessage(controller.signal)
          : '工具已取消或超时'
        : (e as Error).message,
    );
    status.stage = '未完成';
    status.error = error.message;
    throw error;
  } finally {
    for (const child of active.helpers) cancelTool(child);
    clearTimeout(timer);
    clearInterval(keep);
    status.running = false;
    if (job?.id === id) job = undefined;
  }
}

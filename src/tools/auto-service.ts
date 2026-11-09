import { readState } from '../store';
import { originsFor, matchesRules } from '../rules';
import { autoSettings, autoMatches, currentTool, validateCustom } from './custom-model';
import { autoCode } from './auto-runtime';
import { runTool, getToolStatus } from './runner';
import { customStatus } from './custom-service';
import { runRuntimeAI, cancelRuntimeAI } from './runtime-ai';

export async function requireAuto(raw: any) {
  const v = validateCustom(raw),
    a = autoSettings(v.autoStart);
  if (!a.enabled) return;
  if (!chrome.userScripts) throw new Error('请开启允许用户脚本');
  await chrome.userScripts.getScripts();
  if (!(await chrome.permissions.contains({ origins: originsFor(autoMatches(a)) })))
    throw new Error('尚未授予自动启动范围的网站权限');
}
async function allowedTools() {
  await chrome.userScripts.getScripts();
  const state = await readState();
  const result = [];
  for (const t of state.customTools) {
    const a = autoSettings(currentTool(t).autoStart);
    if (a.enabled && (await chrome.permissions.contains({ origins: originsFor(autoMatches(a)) })))
      result.push(t);
  }
  return result;
}
export async function syncAuto() {
  const api = chrome.userScripts;
  const stored = await chrome.storage.session.get('autoToolWorld');
  const worldId = stored.autoToolWorld || 'pagecraft-auto-' + crypto.randomUUID();
  if (!stored.autoToolWorld) await chrome.storage.session.set({ autoToolWorld: worldId });
  await api.configureWorld({
    worldId,
    messaging: true,
    csp: "script-src * 'unsafe-inline' 'unsafe-eval' data: blob:; connect-src * data: blob:; object-src *",
  });
  const tools = await allowedTools(),
    code = autoCode(tools);
  const matches = originsFor(
    tools.flatMap((t) => autoMatches(autoSettings(currentTool(t).autoStart))),
  );
  const id = 'pagecraft-auto-tools';
  const existing = await api.getScripts({ ids: [id] });
  const definition = {
    id,
    matches,
    js: [{ code }],
    world: 'USER_SCRIPT' as chrome.userScripts.ExecutionWorld,
    worldId,
    runAt: 'document_idle' as const,
    allFrames: false,
  };
  if (!matches.length) {
    if (existing.length) await api.unregister({ ids: [id] });
  } else if (existing.length) await api.update([definition]);
  else await api.register([definition]);
  for (const tab of await chrome.tabs.query({})) {
    if (!tab.id || !/^https?:/.test(tab.url || '')) continue;
    try {
      await api.execute({
        target: { tabId: tab.id },
        world: 'USER_SCRIPT',
        worldId,
        js: [{ code }],
      });
    } catch {}
  }
}
export async function autoMessage(m: any, sender: chrome.runtime.MessageSender) {
  const owner = `auto:${m.toolId}:${m.versionId}:${sender.tab?.id}:${sender.documentId}`;
  if (m.action === 'ai-cancel') {
    cancelRuntimeAI(owner, m.options?.requestId);
    return;
  }
  if (m.action === 'ai') return runRuntimeAI(owner, m.options, () => validateAuto(m, sender));
  const tools = await allowedTools();
  if (m.type === 'CUSTOM_AUTO_LEASE')
    return { allowed: tools.map((t) => ({ id: t.id, versionId: t.activeVersionId })) };
  const tool = tools.find((t) => t.id === m.toolId && t.activeVersionId === m.versionId);
  if (!tool || !sender.documentId || !sender.tab?.id) throw new Error('自动工具已停用');
  const [doc] = await chrome.scripting.executeScript({
    target: { tabId: sender.tab.id, documentIds: [sender.documentId] },
    func: () => location.href,
  });
  if (
    !doc?.result ||
    !matchesRules(autoMatches(autoSettings(currentTool(tool).autoStart)), [], doc.result)
  )
    throw new Error('当前页面不在工具范围内');
  if (customStatus()?.running || getToolStatus()?.running) throw new Error('已有工具正在运行');
  if (!['screenshot', 'extract-text'].includes(m.action)) throw new Error('未知工具调用');
  return runTool(
    crypto.randomUUID(),
    m.action === 'extract-text'
      ? 'extract-text'
      : m.options?.fullPage
        ? 'screenshot-full'
        : 'screenshot-visible',
    sender.tab.id,
  );
}
async function validateAuto(m: any, sender: chrome.runtime.MessageSender) {
  const tool = (await allowedTools()).find(
    (t) => t.id === m.toolId && t.activeVersionId === m.versionId,
  );
  if (!tool || !sender.tab?.id || !sender.documentId) throw new Error('自动工具已停用');
  const [doc] = await chrome.scripting.executeScript({
    target: { tabId: sender.tab.id, documentIds: [sender.documentId] },
    func: () => location.href,
  });
  if (
    !doc?.result ||
    !matchesRules(autoMatches(autoSettings(currentTool(tool).autoStart)), [], doc.result)
  )
    throw new Error('页面不在工具范围内');
}

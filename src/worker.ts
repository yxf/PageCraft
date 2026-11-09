import { readState, transact, storageReady } from './store';
import { restoreSurfaceMode, setSurfaceMode } from './surface';
import {
  activeVersion,
  emptyState,
  type Craft,
  type Context,
  type Generated,
  type Version,
} from './types';
import { originsFor, validateRules, supported, matchesRules } from './rules';
import { validateGenerated, checkScript } from './check';
import { requestAI } from './ai';
import { runTool, getToolStatus, cancelTool } from './tools/runner';
import { handleCustom, customCall, customStatus, cancelCustom } from './tools/custom-service';
import { REQUEST_TIMEOUT_MS, abortMessage } from './stream';
import { publicSettings, updateSettings, providers } from './providers';
import { collectContext } from './context';
import { runtimeCode } from './runtime';
import { requireAuto, syncAuto, autoMessage } from './tools/auto-service';
import { currentTool } from './tools/custom-model';

const jobs = new Map<string, AbortController>();
const tabJobs = new Map<number, string>();
const users = () => {
  if (!chrome.userScripts) throw new Error('请在扩展详情中开启“允许用户脚本”，然后重新打开侧边栏');
  return chrome.userScripts;
};
const safeError = (e: unknown) => (e instanceof Error ? e.message.slice(0, 500) : '操作失败');
let syncQueue: Promise<unknown> = Promise.resolve();
async function allowedCrafts(crafts: Craft[]) {
  const result: Craft[] = [];
  for (const c of crafts.filter((x) => x.enabled && !x.deletedUntil)) {
    const v = activeVersion(c);
    checkScript(v.script, v.css);
    if (await chrome.permissions.contains({ origins: originsFor(c.matches) })) result.push(c);
  }
  return result.sort((a, b) => a.createdAt - b.createdAt);
}
async function syncNow() {
  const api = users();
  await syncAuto();
  await api.configureWorld({
    messaging: true,
    csp: "script-src * 'unsafe-inline' 'unsafe-eval' data: blob:; object-src *; connect-src * data: blob:",
  });
  const state = await readState(),
    crafts = await allowedCrafts(state.crafts),
    matches = originsFor(crafts.flatMap((c) => c.matches));
  const registered = await api.getScripts({ ids: ['pagecraft-runner'] });
  const definition = {
    id: 'pagecraft-runner',
    matches,
    js: [{ code: runtimeCode(crafts) }],
    world: 'USER_SCRIPT' as chrome.userScripts.ExecutionWorld,
    runAt: 'document_idle' as const,
    allFrames: false,
  };
  if (!matches.length) {
    if (registered.length) await api.unregister({ ids: ['pagecraft-runner'] });
  } else if (registered.length) await api.update([definition]);
  else await api.register([definition]);
  if (!api.execute) return '已保存；当前浏览器需要刷新页面后应用';
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!tab.id) continue;
    try {
      await api.execute({
        target: { tabId: tab.id },
        world: 'USER_SCRIPT',
        js: [{ code: runtimeCode(crafts) }],
      });
    } catch {
      /* Tabs without permission cannot be touched. */
    }
  }
  return '已保存并注册；当前页面执行结果见运行状态。若页面未恢复，请刷新';
}
function reconcile() {
  const next = syncQueue.then(syncNow);
  syncQueue = next.catch(() => {});
  return next;
}
async function requireAccess(matches: string[]) {
  if (!(await chrome.permissions.contains({ origins: originsFor(matches) })))
    throw new Error('尚未授权目标网站，请先授予站点权限');
  await users().getScripts();
}
async function tabContext(tabId: number, select = false): Promise<Context> {
  const tab = await chrome.tabs.get(tabId);
  if (!tab.url || !supported(tab.url))
    throw new Error('此页面不支持改造，请切换到普通 HTTP/HTTPS 网页');
  const u = new URL(tab.url);
  await requireAccess([`${u.protocol}//${u.hostname}/*`]);
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: collectContext,
    args: [select],
  });
  if (!results[0]?.result) throw new Error('无法读取页面，请刷新后重试');
  return results[0].result;
}
async function saveVersion(
  data: Generated,
  prompt: string,
  matches: string[],
  exclude: string[],
  craftId?: string,
  expectedVersion?: string,
  signal?: AbortSignal,
  expectedUpdatedAt?: number,
) {
  validateGenerated(data);
  validateRules(matches, exclude);
  await requireAccess(matches);
  return transact((s) => {
    if (signal?.aborted) throw new Error(abortMessage(signal));
    let c = craftId ? s.crafts.find((x) => x.id === craftId && !x.deletedUntil) : undefined;
    if (craftId && !c) throw new Error('此改造已删除');
    if (c && expectedVersion && c.activeVersionId !== expectedVersion)
      throw new Error('此改造已在别处更新，请重新生成');
    if (c && expectedUpdatedAt !== undefined && c.updatedAt !== expectedUpdatedAt)
      throw new Error('改造状态已变化，请重新加载后再保存');
    const now = Date.now(),
      v: Version = {
        id: crypto.randomUUID(),
        prompt,
        script: data.script,
        css: data.css,
        steps: data.steps,
        createdAt: now,
      };
    if (!c) {
      c = {
        id: crypto.randomUUID(),
        name: data.name,
        description: data.description,
        matches,
        excludeMatches: exclude,
        enabled: true,
        activeVersionId: v.id,
        versions: [],
        createdAt: now,
        updatedAt: now,
      };
      s.crafts.push(c);
    }
    Object.assign(c, {
      name: data.name,
      description: data.description,
      matches,
      excludeMatches: exclude,
      enabled: true,
      activeVersionId: v.id,
      updatedAt: now,
    });
    c.versions = [v, ...c.versions].slice(0, 10);
    return { craftId: c.id, versionId: v.id, name: c.name, description: c.description };
  });
}
async function generate(m: any) {
  if (typeof m.prompt !== 'string' || !m.prompt.trim() || m.prompt.length > 6000)
    throw new Error('需求不能为空，最多 6000 字符');
  validateRules(m.matches, m.excludeMatches);
  await requireAccess(m.matches);
  const s = await readState();
  if (!s.settings.consent)
    throw new Error(`请先在设置中同意发送页面摘要到 ${providers[s.settings.provider]}`);
  const old = m.craftId ? s.crafts.find((c) => c.id === m.craftId) : undefined;
  if (m.craftId && (!old || old.deletedUntil)) throw new Error('此改造已删除');
  if (
    old &&
    ((m.expectedVersion && old.activeVersionId !== m.expectedVersion) ||
      (m.expectedUpdatedAt !== undefined && old.updatedAt !== m.expectedUpdatedAt))
  )
    throw new Error('此改造已在别处更新，请重新生成');
  const history = m.history ?? [];
  if (
    !Array.isArray(history) ||
    history.length > 6 ||
    history.some((x) => typeof x !== 'string' || x.length > 1500)
  )
    throw new Error('对话上下文无效');
  const key = String(m.tabId);
  if ([...jobs.keys()].some((id) => id === m.id)) throw new Error('任务已存在');
  const previousTask = s.tasks[key];
  if (previousTask && jobs.has(previousTask.id)) throw new Error('此标签页已有生成任务');
  const controller = new AbortController();
  jobs.set(m.id, controller);
  const timeout = setTimeout(
    () => controller.abort(new DOMException('timeout', 'TimeoutError')),
    REQUEST_TIMEOUT_MS,
  );
  const keepalive = setInterval(() => {
    void chrome.runtime.getPlatformInfo();
  }, 20000);
  try {
    await transact((s) => {
      s.tasks[key] = { id: m.id, tabId: m.tabId, stage: '采集页面', startedAt: Date.now() };
    });
    const context: Context = m.context || (await tabContext(m.tabId));
    if (typeof context.summary !== 'string' || context.summary.length > 20000)
      throw new Error('页面摘要无效或过长');
    const tab = await chrome.tabs.get(m.tabId);
    if (!tab.url || new URL(tab.url).origin + new URL(tab.url).pathname !== context.url)
      throw new Error('页面已经变化，请重新采集上下文');
    if (!matchesRules(m.matches, m.excludeMatches, tab.url))
      throw new Error('当前页面不在匹配范围内');
    await transact((s) => {
      s.tasks[key].stage = 'AI 正在生成';
    });
    let lastProgress = 0;
    const data = await requestAI(
      s.settings,
      history.length
        ? JSON.stringify({ previousRequests: history, currentRequest: m.prompt })
        : m.prompt,
      context,
      old ? activeVersion(old) : undefined,
      controller.signal,
      (receivedChars) => {
        const now = Date.now();
        if (now - lastProgress < 1000) return;
        lastProgress = now;
        void transact((s) => {
          const task = s.tasks[key];
          if (task?.id === m.id && task.stage === 'AI 正在生成') {
            task.receivedChars = receivedChars;
            task.lastResponseAt = now;
          }
        }).catch(() => {});
      },
    );
    if (controller.signal.aborted) throw new Error(abortMessage(controller.signal));
    const latest = await chrome.tabs.get(m.tabId);
    if (!latest.url || new URL(latest.url).origin + new URL(latest.url).pathname !== context.url)
      throw new Error('生成期间页面发生变化，请返回原页重试');
    await transact((s) => {
      s.tasks[key].stage = '校验并保存';
    });
    if (controller.signal.aborted) throw new Error(abortMessage(controller.signal));
    const saved = await saveVersion(
      { ...data, name: old?.name ?? data.name },
      m.prompt,
      m.matches,
      m.excludeMatches,
      m.craftId,
      old?.activeVersionId,
      controller.signal,
      old?.updatedAt,
    );
    const { craftId } = saved;
    let stage: string;
    try {
      stage = await reconcile();
    } catch {
      stage = '已保存，但注册失败；请检查用户脚本开关和站点权限后重新应用';
    }
    await transact((s) => {
      if (s.tasks[key]?.id === m.id) s.tasks[key] = { ...s.tasks[key], stage, craftId };
    });
    return { ...saved, notice: stage };
  } catch (e) {
    await transact((s) => {
      if (s.tasks[key]?.id === m.id)
        s.tasks[key] = { ...s.tasks[key], stage: '未应用', error: safeError(e) };
    });
    throw e;
  } finally {
    clearTimeout(timeout);
    clearInterval(keepalive);
    jobs.delete(m.id);
  }
}
async function handle(m: any) {
  await ready;
  if (typeof m.type === 'string' && m.type.startsWith('CUSTOM_')) {
    const mutation = ['CUSTOM_SAVE', 'CUSTOM_DELETE', 'CUSTOM_ROLLBACK'].includes(m.type);
    const hadAuto =
      mutation && (await readState()).customTools.some((t) => currentTool(t).autoStart?.enabled);
    if (m.type === 'CUSTOM_SAVE') await requireAuto(m.data);
    if (m.type === 'CUSTOM_ROLLBACK') {
      const t = (await readState()).customTools.find((t) => t.id === m.id);
      const v = t?.versions.find((v) => v.id === m.versionId);
      if (v) await requireAuto(v);
    }
    const result = await handleCustom(m);
    if (
      mutation &&
      (hadAuto || (await readState()).customTools.some((t) => currentTool(t).autoStart?.enabled))
    ) {
      try {
        await reconcile();
      } catch {
        throw new Error(
          '工具已保存或更新，但自动脚本同步失败，请开启用户脚本并重新保存；必要时刷新网页',
        );
      }
    }
    return result;
  }
  switch (m.type) {
    case 'SURFACE_MODE':
      return setSurfaceMode(m.mode);
    case 'TOOL_STATE':
      return getToolStatus();
    case 'TOOL_CANCEL':
      cancelTool(m.id);
      return;
    case 'TOOL_RUN':
      if (customStatus()?.running) throw new Error('已有自建工具任务，请等待或取消');
      return runTool(m.id, m.tool, m.tabId);
    case 'STATE': {
      const s = await readState();
      let available = false;
      try {
        await users().getScripts();
        available = true;
      } catch {}
      const grants: Record<string, boolean> = {};
      for (const c of s.crafts)
        grants[c.id] = await chrome.permissions.contains({ origins: originsFor(c.matches) });
      return {
        ...s,
        settings: publicSettings(s.settings),
        available,
        grants,
      };
    }
    case 'SETTINGS':
      return transact((s) => {
        s.settings = updateSettings(s.settings, m);
      });
    case 'TEST': {
      const s = await readState();
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(new DOMException('timeout', 'TimeoutError')),
        REQUEST_TIMEOUT_MS,
      );
      const keep = setInterval(() => void chrome.runtime.getPlatformInfo(), 20000);
      try {
        await requestAI(
          s.settings,
          '返回一个简单的无操作测试改造，script 为空，css 为 body {}。不要进行页面修改。',
          { url: '', title: 'connection-test', summary: '', truncated: false },
          undefined,
          controller.signal,
        );
        return '连接与结构化输出测试通过';
      } finally {
        clearTimeout(timer);
        clearInterval(keep);
      }
    }
    case 'CONTEXT':
      return tabContext(m.tabId, m.select);
    case 'GENERATE': {
      if (tabJobs.has(m.tabId)) throw new Error('此标签页已有生成任务');
      tabJobs.set(m.tabId, m.id);
      try {
        return await generate(m);
      } finally {
        if (tabJobs.get(m.tabId) === m.id) tabJobs.delete(m.tabId);
      }
    }
    case 'CANCEL':
      jobs.get(m.id)?.abort();
      return true;
    case 'SAVE': {
      const saved = await saveVersion(
        m.data,
        '手工编辑',
        m.matches,
        m.excludeMatches,
        m.craftId,
        m.expectedVersion,
        undefined,
        m.expectedUpdatedAt,
      );
      return { ...saved, notice: await reconcile() };
    }
    case 'TOGGLE': {
      const s = await readState();
      const c = s.crafts.find((c) => c.id === m.id);
      if (!c) throw new Error('改造不存在');
      if (m.enabled) await requireAccess(c.matches);
      await transact((s) => {
        const c = s.crafts.find((c) => c.id === m.id)!;
        c.enabled = !!m.enabled;
        c.updatedAt = Date.now();
      });
      return reconcile();
    }
    case 'CONVERSATION_UNDO': {
      const state = await readState(),
        craft = state.crafts.find((c) => c.id === m.craftId && !c.deletedUntil);
      if (!craft) throw new Error('此改造已删除');
      await requireAccess(craft.matches);
      await transact((s) => {
        const c = s.crafts.find((c) => c.id === m.craftId && !c.deletedUntil);
        if (!c || !m.versionId || c.activeVersionId !== m.versionId)
          throw new Error('已有后续修改，请在版本记录中选择回退');
        if (m.priorVersionId) {
          const v = c.versions.find((v) => v.id === m.priorVersionId);
          if (!v) throw new Error('旧版本已不存在');
          checkScript(v.script, v.css);
          c.activeVersionId = v.id;
        } else {
          c.enabled = false;
        }
        c.updatedAt = Date.now();
      });
      return reconcile();
    }
    case 'ROLLBACK': {
      const s = await readState(),
        c = s.crafts.find((c) => c.id === m.id),
        v = c?.versions.find((v) => v.id === m.versionId);
      if (!c || !v) throw new Error('版本不存在');
      checkScript(v.script, v.css);
      await requireAccess(c.matches);
      await transact((s) => {
        const c = s.crafts.find((c) => c.id === m.id)!;
        c.activeVersionId = m.versionId;
        c.updatedAt = Date.now();
      });
      return reconcile();
    }
    case 'DELETE':
      await transact((s) => {
        const c = s.crafts.find((c) => c.id === m.id);
        if (c) c.deletedUntil = Date.now() + 10000;
      });
      await chrome.alarms.create('purge', { when: Date.now() + 11000 });
      return reconcile();
    case 'UNDO':
      await transact((s) => {
        const c = s.crafts.find((c) => c.id === m.id);
        if (!c?.deletedUntil || c.deletedUntil < Date.now()) throw new Error('撤销时间已过');
        delete c.deletedUntil;
      });
      return reconcile();
    case 'REAPPLY':
      return reconcile();
    case 'CLEAR':
      cancelCustom();
      for (const controller of jobs.values()) controller.abort();
      await transact((s) => Object.assign(s, emptyState()));
      try {
        await reconcile();
      } catch {}
      await chrome.storage.session.clear();
      return true;
    default:
      throw new Error('未知操作');
  }
}
const ready = (async () => {
  await storageReady();
  await chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  await transact((s) => {
    for (const t of Object.values(s.tasks)) {
      if (['采集页面', 'AI 正在生成', '校验并保存'].includes(t.stage)) {
        t.stage = '任务中断';
        t.error = '后台已重启，请重试';
      }
    }
    s.crafts = s.crafts.filter((c) => !c.deletedUntil || c.deletedUntil > Date.now());
  });
  await restoreSurfaceMode();
})().catch(() => {});
chrome.runtime.onMessage.addListener((m, sender, reply) => {
  if (
    sender.id !== chrome.runtime.id ||
    !sender.url ||
    !['index.html', 'options.html'].some(
      (p) => sender.url!.split('?')[0] === chrome.runtime.getURL(p),
    )
  )
    return false;
  handle(m)
    .then((data) => reply({ ok: true, data }))
    .catch((e) => reply({ ok: false, error: safeError(e) }));
  return true;
});
chrome.runtime.onUserScriptMessage.addListener((m, sender, reply) => {
  if (sender.id !== chrome.runtime.id || sender.frameId !== 0 || !sender.tab?.id || !sender.url)
    return;
  if (['CUSTOM_AUTO_CALL', 'CUSTOM_AUTO_LEASE'].includes(m?.type)) {
    autoMessage(m, sender)
      .then((data) => reply(m.type === 'CUSTOM_AUTO_LEASE' ? data : { ok: true, data }))
      .catch((e) =>
        reply(
          m.type === 'CUSTOM_AUTO_LEASE' ? { allowed: [] } : { ok: false, error: safeError(e) },
        ),
      );
    return true;
  }
  if (m?.type === 'CUSTOM_TOOL_CALL') {
    customCall(m, sender)
      .then((data) => reply({ ok: true, data }))
      .catch((e) => reply({ ok: false, error: safeError(e) }));
    return true;
  }
  if (m?.type === 'LEASE') {
    readState()
      .then((s) => allowedCrafts(s.crafts))
      .then((crafts) =>
        reply({
          allowed: crafts
            .filter((c) => matchesRules(originsFor(c.matches), [], sender.url!))
            .map((c) => ({ id: c.id, versionId: c.activeVersionId })),
        }),
      )
      .catch(() => reply({ allowed: [] }));
    return true;
  }
  if (m?.type !== 'RUN' || !['ok', 'error', 'refresh'].includes(m.status)) {
    reply({ denied: true });
    return false;
  }
  const tabId = sender.tab.id,
    url = new URL(sender.url).origin + new URL(sender.url).pathname;
  void transact((s) => {
    const c = s.crafts.find((c) => c.id === m.craftId);
    if (!c || c.activeVersionId !== m.versionId || !matchesRules(c.matches, c.excludeMatches, url))
      return;
    s.runs = [
      { craftId: c.id, versionId: m.versionId, tabId, url, status: m.status, at: Date.now() },
      ...s.runs.filter((r) => !(r.craftId === c.id && r.tabId === tabId)),
    ].slice(0, 100);
  });
  reply({ received: true });
  return false;
});
chrome.runtime.onInstalled.addListener(() => {
  void ready.then(() => reconcile()).catch(() => {});
});
chrome.runtime.onStartup.addListener(() => {
  void ready.then(() => reconcile()).catch(() => {});
});
chrome.permissions.onRemoved.addListener(() => {
  void reconcile().catch(() => {});
});
chrome.permissions.onAdded.addListener(() => {
  void reconcile().catch(() => {});
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'purge')
    void transact((s) => {
      const ids = s.crafts
        .filter((c) => c.deletedUntil && c.deletedUntil <= Date.now())
        .map((c) => c.id);
      s.crafts = s.crafts.filter((c) => !ids.includes(c.id));
      s.runs = s.runs.filter((r) => !ids.includes(r.craftId));
    });
});
void ready.then(() => reconcile()).catch(() => {});

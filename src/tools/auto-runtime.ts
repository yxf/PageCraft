import {
  currentTool,
  autoSettings,
  autoMatches,
  normalizeResult,
  type CustomTool,
} from './custom-model';
import { matchesRules, matchesPattern, parsePattern } from '../rules';
import { createRuntimeAI } from './runtime-ai';

// Serialized into the user-script world; no extension credentials enter this code.
export function installAuto(
  plans: any[],
  match: typeof matchesRules,
  normalize: typeof normalizeResult,
) {
  const root = globalThis as any;
  // Persisted registrations can run before world messaging is restored on startup.
  if (typeof chrome.runtime?.sendMessage !== 'function') return;
  if (root.__pagecraftAuto) {
    root.__pagecraftAuto.sync(plans);
    return;
  }
  let current = plans;
  const live = new Map<string, any>();
  const stop = (id: string) => {
    const item = live.get(id);
    if (!item) return;
    live.delete(id);
    item.controller.abort();
    for (const fn of item.cleanup.reverse()) {
      try {
        fn();
      } catch {}
    }
  };
  const tick = () => {
    const desired = current.filter((p) => match(p.matches, [], location.href));
    for (const [id, item] of live) {
      const next = desired.find((p) => p.id === id);
      if (
        !next ||
        next.versionId !== item.plan.versionId ||
        (next.rerunOnRoute && item.url !== location.href)
      )
        stop(id);
    }
    for (const p of desired) {
      if (live.has(p.id)) continue;
      const controller = new AbortController();
      const item = { plan: p, url: location.href, controller, cleanup: [] as (() => void)[] };
      live.set(p.id, item);
      const call = async (action: string, options = {}) => {
        if (action !== 'ai-cancel') controller.signal.throwIfAborted();
        const r = await chrome.runtime.sendMessage({
          type: 'CUSTOM_AUTO_CALL',
          toolId: p.id,
          versionId: p.versionId,
          action,
          options,
        });
        controller.signal.throwIfAborted();
        if (!r?.ok) throw new Error(r?.error || '工具调用失败');
        return r.data;
      };
      const ctx = {
        ai: createRuntimeAI(call, controller.signal),
        params: p.params,
        signal: controller.signal,
        onCleanup(fn: () => void) {
          if (controller.signal.aborted) fn();
          else item.cleanup.push(fn);
        },
        tools: {
          screenshot(options = {}) {
            return call('screenshot', options);
          },
          extractText() {
            return call('extract-text');
          },
          async download(raw: any) {
            controller.signal.throwIfAborted();
            const result = normalize(raw);
            const url =
              result.kind === 'image'
                ? result.data
                : URL.createObjectURL(new Blob([result.data], { type: result.mime }));
            const a = document.createElement('a');
            a.href = url;
            a.download = result.filename;
            a.click();
            if (result.kind !== 'image') setTimeout(() => URL.revokeObjectURL(url), 10000);
            return result;
          },
        },
      };
      if (p.css) {
        const style = document.createElement('style');
        style.textContent = p.css;
        document.documentElement.append(style);
        ctx.onCleanup(() => style.remove());
      }
      void Promise.resolve()
        .then(() => {
          controller.signal.throwIfAborted();
          return p.init(ctx);
        })
        .catch((error) => {
          if (!controller.signal.aborted) {
            console.error('[PageCraft auto]', p.id, error);
            controller.abort();
            for (const fn of item.cleanup.splice(0).reverse()) {
              try {
                fn();
              } catch {}
            }
            // Keep the failed version recorded; do not retry every tick.
          }
        });
    }
  };
  let epoch = 0;
  const timer = setInterval(tick, 750);
  const lease = setInterval(async () => {
    const started = epoch;
    try {
      const r = await chrome.runtime.sendMessage({ type: 'CUSTOM_AUTO_LEASE' });
      if (started !== epoch) return;
      const allowed = new Set((r?.allowed || []).map((x: any) => x.id + ':' + x.versionId));
      current = current.filter((p) => allowed.has(p.id + ':' + p.versionId));
    } catch {
      if (started === epoch) current = [];
    }
    tick();
  }, 5000);
  root.__pagecraftAuto = {
    sync(next: any[]) {
      epoch++;
      current = next;
      tick();
    },
    dispose() {
      clearInterval(timer);
      clearInterval(lease);
      for (const id of live.keys()) stop(id);
      delete root.__pagecraftAuto;
    },
  };
  tick();
}
export function autoCode(tools: CustomTool[]) {
  const plans = tools
    .filter((t) => autoSettings(currentTool(t).autoStart).enabled)
    .map((t) => {
      const v = currentTool(t),
        a = autoSettings(v.autoStart);
      return `{...${JSON.stringify({ id: t.id, versionId: v.id, matches: autoMatches(a), rerunOnRoute: a.rerunOnRoute, params: v.params, css: v.css })},init:async function(ctx){"use strict";\n${v.script}\n}}`;
    });
  return `(()=>{const createRuntimeAI=${createRuntimeAI.toString()}; const parsePattern=${parsePattern.toString()}; const matchesPattern=${matchesPattern.toString()}; (${installAuto.toString()})([${plans.join(',')}],${matchesRules.toString()},${normalizeResult.toString()});})()`;
}

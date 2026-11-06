export function executeCustom(
  id: string,
  params: Record<string, unknown>,
  css: string,
  init: (ctx: any) => Promise<any>,
) {
  const root = globalThis as any;
  const controller = new AbortController();
  const cleanup: (() => void)[] = [];
  let downloadResult: any;
  const key = '__pagecraftCustom_' + id;
  root[key] = () => controller.abort();
  const timer = setTimeout(() => controller.abort(), 120000);
  const call = async (action: string, options = {}) => {
    controller.signal.throwIfAborted();
    const reply = await chrome.runtime.sendMessage({
      type: 'CUSTOM_TOOL_CALL',
      id,
      action,
      options,
    });
    controller.signal.throwIfAborted();
    if (!reply?.ok) throw new Error(reply?.error || '工具调用失败');
    return reply.data;
  };
  if (css) {
    const style = document.createElement('style');
    style.textContent = css;
    document.documentElement.append(style);
    cleanup.push(() => style.remove());
  }
  const ctx = {
    params,
    signal: controller.signal,
    onCleanup(fn: () => void) {
      cleanup.push(fn);
    },
    tools: {
      screenshot(options = {}) {
        return call('screenshot', options);
      },
      extractText() {
        return call('extract-text');
      },
      async download(result: any) {
        controller.signal.throwIfAborted();
        downloadResult =
          typeof result === 'string'
            ? { kind: 'text', data: result, autoDownload: true }
            : { ...result, autoDownload: true };
        return downloadResult;
      },
    },
  };
  const cancelled = new Promise<never>((_, reject) =>
    controller.signal.addEventListener('abort', () => reject(new Error('工具已取消')), {
      once: true,
    }),
  );
  return Promise.race([Promise.resolve().then(() => init(ctx)), cancelled])
    .then((result) => ({ ok: true, data: downloadResult ?? result }))
    .catch((error) => ({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }))
    .finally(() => {
      clearTimeout(timer);
      for (const fn of cleanup.reverse()) {
        try {
          fn();
        } catch {}
      }
      delete root[key];
    });
}
export function customCode(
  id: string,
  params: Record<string, unknown>,
  css: string,
  script: string,
) {
  return `(${executeCustom.toString()})(${JSON.stringify(id)},${JSON.stringify(params)},${JSON.stringify(css)},async function(ctx){"use strict";\n${script}\n})`;
}

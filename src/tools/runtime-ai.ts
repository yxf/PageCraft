import { readState } from '../store';
import { requestText } from '../ai';
const pending = new Map<string, AbortController>();
export function cancelRuntimeAI(owner: string, requestId: string) {
  pending.get(owner + ':' + requestId)?.abort();
}
export async function runRuntimeAI(
  owner: string,
  options: any,
  validate: () => Promise<void>,
  parent?: AbortSignal,
) {
  if (
    typeof options?.requestId !== 'string' ||
    options.requestId.length > 100 ||
    typeof options.instruction !== 'string' ||
    !options.instruction.trim() ||
    typeof options.input !== 'string'
  )
    throw new Error('AI 参数无效');
  if (options.instruction.length > 12000 || options.input.length > 100000)
    throw new Error('AI 输入过长，请缩小内容');
  const key = owner + ':' + options.requestId;
  if (pending.has(key) || pending.size >= 4) throw new Error('AI 请求正在处理中，请稍后重试');
  const controller = new AbortController();
  pending.set(key, controller);
  const abort = () => controller.abort();
  parent?.addEventListener('abort', abort, { once: true });
  if (parent?.aborted) abort();
  const timeout = setTimeout(
    () => controller.abort(new DOMException('timeout', 'TimeoutError')),
    120000,
  );
  let checking = false;
  const lease = setInterval(() => {
    if (checking) return;
    checking = true;
    void validate()
      .catch(abort)
      .finally(() => {
        checking = false;
      });
  }, 1000);
  const keep = setInterval(() => void chrome.runtime.getPlatformInfo(), 20000);
  try {
    await validate();
    controller.signal.throwIfAborted();
    const state = await readState();
    return await requestText(state.settings, options.instruction, options.input, controller.signal);
  } finally {
    clearTimeout(timeout);
    clearInterval(lease);
    clearInterval(keep);
    parent?.removeEventListener('abort', abort);
    pending.delete(key);
  }
}
// Serialized into USER_SCRIPT with the existing scoped message bridge.
export function createRuntimeAI(
  call: (action: string, options: any) => Promise<any>,
  lifetime: AbortSignal,
) {
  return {
    async ask(options: { instruction: string; input?: string; signal?: AbortSignal }) {
      if (
        !options ||
        typeof options.instruction !== 'string' ||
        (options.input !== undefined && typeof options.input !== 'string')
      )
        throw new Error('ctx.ai.ask 需要 instruction 和可选的 input 字符串');
      const signals = [lifetime, ...(options.signal ? [options.signal] : [])];
      for (const signal of signals) signal.throwIfAborted();
      const requestId = crypto.randomUUID();
      let abort!: () => void;
      const cancelled = new Promise<never>((_, reject) => {
        abort = () => {
          void call('ai-cancel', { requestId }).catch(() => {});
          reject(new Error('AI 请求已取消'));
        };
      });
      for (const signal of signals) signal.addEventListener('abort', abort, { once: true });
      try {
        return await Promise.race([
          call('ai', { requestId, instruction: options.instruction, input: options.input ?? '' }),
          cancelled,
        ]);
      } finally {
        for (const signal of signals) signal.removeEventListener('abort', abort);
      }
    },
  };
}

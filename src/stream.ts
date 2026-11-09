import type { Provider } from './types';

export const REQUEST_TIMEOUT_MS = 240000;
export function abortMessage(signal: AbortSignal) {
  return signal.reason?.name === 'TimeoutError'
    ? '生成超过 4 分钟，请缩小需求后重试'
    : '请求已取消';
}

// Consume SSE incrementally, including split UTF-8 characters and CRLF boundaries.
export async function readAIStream(
  response: Response,
  provider: Provider,
  signal: AbortSignal,
  progress?: (chars: number, text?: string) => void,
) {
  if (!response.body) throw new Error('模型未返回响应流');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '',
    text = '',
    finish: string | undefined,
    completed = false;
  let result: any;
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener('abort', abort, { once: true });
  const event = (block: string) => {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).replace(/^ /, ''))
      .join('\n');
    if (!data) return;
    if (data === '[DONE]') {
      completed = true;
      return;
    }
    let item: any;
    try {
      item = JSON.parse(data);
    } catch {
      throw new Error('模型返回了无效的流式数据');
    }
    if (item.error || item.type === 'error' || item.type === 'response.failed')
      throw new Error('模型服务在生成过程中报错，请重试');
    if (provider === 'openai') {
      if (item.type === 'response.output_text.delta') text += item.delta || '';
      if (item.type === 'response.refusal.delta') throw new Error('模型拒绝生成此改造，请调整需求');
      if (item.type === 'response.completed' || item.type === 'response.incomplete') {
        result = item.response;
        completed = true;
      }
    } else if (provider === 'deepseek') {
      const choice = item.choices?.find((c: any) => c.index === 0) || item.choices?.[0];
      if (choice?.delta?.refusal) throw new Error('模型拒绝生成此改造，请调整需求');
      text += choice?.delta?.content || '';
      if (choice?.finish_reason) finish = choice.finish_reason;
    } else if (provider === 'claude') {
      if (item.type === 'content_block_start' && item.content_block?.type === 'text')
        text += item.content_block.text || '';
      if (item.type === 'content_block_delta' && item.delta?.type === 'text_delta')
        text += item.delta.text || '';
      if (item.type === 'message_delta') finish = item.delta?.stop_reason || finish;
      if (item.type === 'message_stop') completed = true;
    } else {
      if (item.promptFeedback?.blockReason) throw new Error('模型请求被安全策略阻止');
      const candidate = item.candidates?.find((c: any) => c.index === 0) || item.candidates?.[0];
      text += (candidate?.content?.parts || [])
        .filter((p: any) => !p.thought)
        .map((p: any) => p.text || '')
        .join('');
      if (candidate?.finishReason) {
        finish = candidate.finishReason;
        completed = true;
      }
    }
    progress?.(text.length, text);
  };
  try {
    while (!completed) {
      if (signal.aborted) throw new Error(abortMessage(signal));
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch {
        throw new Error(
          signal.aborted ? abortMessage(signal) : '模型连接中断，未保存不完整代码，请重试',
        );
      }
      if (signal.aborted) throw new Error(abortMessage(signal));
      buffer += chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true });
      let boundary: RegExpExecArray | null;
      while (!completed && (boundary = /\r?\n\r?\n/.exec(buffer))) {
        const block = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        event(block);
      }
      if (chunk.done) {
        if (buffer.trim() && !completed) event(buffer);
        break;
      }
    }
    if (!completed) throw new Error('模型连接在完成前断开，未保存不完整代码，请重试');
    if (provider === 'openai') {
      if (!result) throw new Error('模型缺少完成响应，请重试');
      return result;
    }
    if (provider === 'deepseek')
      return { choices: [{ finish_reason: finish, message: { content: text } }] };
    if (provider === 'claude') return { stop_reason: finish, content: [{ type: 'text', text }] };
    return { candidates: [{ finishReason: finish, content: { parts: [{ text }] } }] };
  } finally {
    signal.removeEventListener('abort', abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readAIStream, abortMessage } from '../src/stream';
import { parseResponse, buildRequest } from '../src/ai';
import { normalizeSettings, updateSettings } from '../src/providers';

const value = { name: '中文测试', description: '', script: '', css: 'body {}', steps: [] };
const text = JSON.stringify(value);
const sse = (events: unknown[]) =>
  events.map((e) => `data: ${e === '[DONE]' ? e : JSON.stringify(e)}\r\n\r\n`).join('');
function response(data: string) {
  const bytes = new TextEncoder().encode(': heartbeat\r\n\r\n' + data);
  let offset = 0;
  return new Response(
    new ReadableStream({
      pull(controller) {
        if (offset === bytes.length) {
          controller.close();
          return;
        }
        controller.enqueue(bytes.slice(offset, offset + 1));
        offset++;
      },
    }),
    { headers: { 'Content-Type': 'text/event-stream' } },
  );
}
test('four streaming protocols survive byte boundaries and expose only output counts', async () => {
  const events = {
    openai: [
      { type: 'response.output_text.delta', delta: text },
      {
        type: 'response.completed',
        response: { status: 'completed', output: [{ content: [{ type: 'output_text', text }] }] },
      },
    ],
    deepseek: [
      { choices: [{ index: 0, delta: { reasoning_content: 'private reasoning' } }] },
      { choices: [{ index: 0, delta: { content: text }, finish_reason: 'stop' }] },
      '[DONE]',
    ],
    claude: [
      {
        type: 'content_block_delta',
        delta: { type: 'thinking_delta', thinking: 'private reasoning' },
      },
      { type: 'content_block_delta', delta: { type: 'text_delta', text } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
      { type: 'message_stop' },
    ],
    google: [
      {
        candidates: [
          {
            content: { parts: [{ thought: true, text: 'private reasoning' }, { text }] },
            finishReason: 'STOP',
          },
        ],
      },
    ],
  };
  for (const provider of ['openai', 'deepseek', 'claude', 'google'] as const) {
    const counts: number[] = [];
    const data = await readAIStream(
      response(sse(events[provider])),
      provider,
      new AbortController().signal,
      (n) => counts.push(n),
    );
    assert.deepEqual(parseResponse(data, provider), value);
    assert.equal(Math.max(...counts), text.length);
    const request = buildRequest(
      updateSettings(normalizeSettings({}), { provider, model: 'test', apiKey: 'fake' }),
      'input',
    );
    if (provider === 'google') assert.match(request.url, /:streamGenerateContent\?alt=sse$/);
    else assert.equal((request.body as any).stream, true);
  }
});
test('disconnected, malformed, errored and truncated streams never become usable code', async () => {
  const signal = new AbortController().signal;
  await assert.rejects(
    readAIStream(response(sse([{ choices: [{ delta: { content: text } }] }])), 'deepseek', signal),
    /断开/,
  );
  await assert.rejects(readAIStream(response('data: broken\n\n'), 'openai', signal), /无效/);
  await assert.rejects(readAIStream(response(sse([{ type: 'error' }])), 'claude', signal), /报错/);
  const data = await readAIStream(
    response(sse([{ choices: [{ delta: { content: text }, finish_reason: 'length' }] }, '[DONE]'])),
    'deepseek',
    signal,
  );
  assert.throws(() => parseResponse(data, 'deepseek'), /长度上限/);
  const broken = new Response(
    new ReadableStream({
      pull(c) {
        c.error(new Error('network'));
      },
    }),
  );
  await assert.rejects(readAIStream(broken, 'openai', signal), /连接中断/);
});
test('pending stream reads cancel promptly and timeout differs from manual cancellation', async () => {
  for (const timedOut of [false, true]) {
    const controller = new AbortController();
    const pending = readAIStream(new Response(new ReadableStream()), 'openai', controller.signal);
    controller.abort(timedOut ? new DOMException('timeout', 'TimeoutError') : undefined);
    await assert.rejects(pending, timedOut ? /4 分钟/ : /已取消/);
    assert.match(abortMessage(controller.signal), timedOut ? /4 分钟/ : /已取消/);
  }
});

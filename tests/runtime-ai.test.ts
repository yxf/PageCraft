import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRequest, parseTextResponse } from '../src/ai';
import { normalizeSettings, updateSettings } from '../src/providers';
import { createRuntimeAI } from '../src/tools/runtime-ai';
test('plain text requests remove code JSON contracts for all providers', () => {
  for (const provider of ['openai', 'deepseek', 'google', 'claude'] as const) {
    const settings = updateSettings(normalizeSettings({}), {
      provider,
      apiKey: 'fake-secret',
      model: 'test',
    });
    const body = JSON.stringify(buildRequest(settings, 'input', 'Answer as text', true).body);
    assert.ok(
      !body.includes('json_schema') &&
        !body.includes('json_object') &&
        !body.includes('responseJsonSchema'),
    );
    assert.ok(!body.includes('fake-secret'));
  }
  assert.equal(
    parseTextResponse({ output: [{ content: [{ type: 'output_text', text: 'hello' }] }] }),
    'hello',
  );
  assert.equal(
    parseTextResponse(
      { choices: [{ finish_reason: 'stop', message: { content: 'hello' } }] },
      'deepseek',
    ),
    'hello',
  );
  assert.equal(
    parseTextResponse(
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'hello' }] },
      'claude',
    ),
    'hello',
  );
  assert.equal(
    parseTextResponse(
      { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'hello' }] } }] },
      'google',
    ),
    'hello',
  );
  assert.throws(() =>
    parseTextResponse(
      { choices: [{ finish_reason: 'length', message: { content: 'partial' } }] },
      'deepseek',
    ),
  );
});
test('runtime AI serializes text and honors request cancellation', async () => {
  const lifetime = new AbortController();
  const calls: any[] = [];
  const api = createRuntimeAI(async (action, options) => {
    calls.push({ action, options });
    return 'answer';
  }, lifetime.signal);
  assert.equal(
    await api.ask({ instruction: 'summarize', input: 'data', signal: lifetime.signal }),
    'answer',
  );
  assert.equal(calls[0].options.input, 'data');
  assert.equal(calls[0].options.signal, undefined);
  const controller = new AbortController();
  const pending = createRuntimeAI((action, options) => {
    calls.push({ action, options });
    return action === 'ai' ? new Promise(() => {}) : Promise.resolve();
  }, lifetime.signal).ask({ instruction: 'wait', signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, /取消/);
  assert.equal(calls.at(-1).action, 'ai-cancel');
  lifetime.abort();
  await assert.rejects(api.ask({ instruction: 'no call' }));
});

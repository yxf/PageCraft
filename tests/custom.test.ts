import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  saveCustom,
  currentTool,
  normalizeResult,
  validateCustom,
  customInstructions,
  autoSettings,
  autoMatches,
  type CustomTool,
} from '../src/tools/custom-model';
import { buildRequest, parseResponse } from '../src/ai';
import { normalizeSettings, updateSettings } from '../src/providers';
import { checkScript } from '../src/check';
import { autoCode } from '../src/tools/auto-runtime';
import { JSDOM } from 'jsdom';
const draft = {
  name: '工具',
  description: '说明\n第二行',
  script: 'await Promise.resolve(); return "ok";',
  css: '',
  steps: [],
  prompt: '',
  params: { limit: 10 },
};
test('auto tools default to manual and validate site scope', () => {
  assert.equal(validateCustom(draft).autoStart?.enabled, false);
  assert.deepEqual(autoMatches(autoSettings()), ['*://*/*']);
  assert.throws(() =>
    autoSettings({ enabled: true, scope: 'sites', matches: [], rerunOnRoute: false }),
  );
});
test('auto lifecycle is persistent, idempotent, route aware and cleans old instances', async () => {
  const dom = new JSDOM('<body></body>', {
    url: 'https://example.com/one',
    runScripts: 'outside-only',
  });
  const win = dom.window as any;
  win.chrome = { runtime: { sendMessage: async () => ({ allowed: [] }) } };
  const tools: CustomTool[] = [];
  const autoStart = {
    enabled: true,
    scope: 'sites' as const,
    matches: ['https://example.com/*'],
    rerunOnRoute: false,
  };
  const t = saveCustom(tools, {
    ...draft,
    autoStart,
    script:
      'const b=document.createElement("button");b.textContent="auto";document.body.append(b);ctx.onCleanup(()=>b.remove());await Promise.resolve();',
  });
  const flush = () => new Promise((r) => setTimeout(r, 10));
  try {
    win.eval(autoCode(tools));
    await flush();
    assert.equal(win.document.querySelectorAll('button').length, 1);
    const original = win.document.querySelector('button');
    win.eval(autoCode(tools));
    await flush();
    assert.equal(win.document.querySelector('button'), original);
    win.history.pushState({}, '', '/two');
    win.eval(autoCode(tools));
    await flush();
    assert.equal(win.document.querySelector('button'), original);
    saveCustom(
      tools,
      { ...currentTool(t), autoStart: { ...autoStart, rerunOnRoute: true } },
      t.id,
      t.activeVersionId,
    );
    win.eval(autoCode(tools));
    await flush();
    assert.equal(original.isConnected, false);
    const second = win.document.querySelector('button');
    win.history.pushState({}, '', '/three');
    win.eval(autoCode(tools));
    await flush();
    assert.equal(second.isConnected, false);
    saveCustom(
      tools,
      { ...currentTool(t), autoStart: { ...autoStart, matches: ['https://example.com/only'] } },
      t.id,
      t.activeVersionId,
    );
    win.eval(autoCode(tools));
    await flush();
    assert.equal(win.document.querySelectorAll('button').length, 0);
    win.eval(autoCode([]));
  } finally {
    win.__pagecraftAuto?.dispose();
    win.close();
  }
});
test('custom tools support async syntax, version history and optimistic updates', () => {
  const tools: CustomTool[] = [];
  assert.equal(validateCustom(draft).name, '工具');
  assert.throws(() => checkScript(draft.script, ''));
  const tool = saveCustom(tools, draft);
  assert.equal(currentTool(tool).params.limit, 10);
  const original = tool.activeVersionId;
  saveCustom(tools, { ...draft, name: '新版' }, tool.id, original);
  assert.equal(currentTool(tool).name, '新版');
  assert.throws(() => saveCustom(tools, draft, tool.id, original), /更新/);
  for (let i = 0; i < 12; i++) saveCustom(tools, draft, tool.id, tool.activeVersionId);
  assert.equal(tool.versions.length, 10);
  assert.throws(() => validateCustom({ ...draft, params: [] }));
  assert.throws(() => validateCustom({ ...draft, script: 'const =' }));
});
test('automatic lease removes revoked instances and late cleanup executes immediately', async () => {
  const dom = new JSDOM('<body></body>', {
    url: 'https://example.com/',
    runScripts: 'outside-only',
  });
  const win = dom.window as any;
  const callbacks: (() => any)[] = [];
  win.setInterval = (fn: () => any) => {
    callbacks.push(fn);
    return callbacks.length;
  };
  win.clearInterval = () => {};
  win.chrome = { runtime: { sendMessage: async () => ({ allowed: [] }) } };
  const tools: CustomTool[] = [];
  saveCustom(tools, {
    ...draft,
    autoStart: { enabled: true, scope: 'all', matches: [], rerunOnRoute: false },
    script:
      'document.body.dataset.live="yes";ctx.onCleanup(()=>delete document.body.dataset.live);await new Promise(resolve=>globalThis.finishAuto=resolve);ctx.onCleanup(()=>document.body.dataset.late="cleaned");',
  });
  const flush = () => new Promise((r) => setTimeout(r, 10));
  try {
    win.eval(autoCode(tools));
    await flush();
    assert.equal(win.document.body.dataset.live, 'yes');
    await callbacks[1]();
    assert.equal(win.document.body.dataset.live, undefined);
    win.finishAuto();
    await flush();
    assert.equal(win.document.body.dataset.late, 'cleaned');
  } finally {
    win.__pagecraftAuto?.dispose();
    win.close();
  }
});
test('tool output handles text, files, safe image previews and CSV tables', () => {
  assert.equal(normalizeResult('Hello').kind, 'text');
  assert.equal(normalizeResult(null).kind, 'text');
  const table = normalizeResult({
    kind: 'table',
    columns: ['URL'],
    rows: [['=1+1'], ['a,b']],
    filename: 'links.csv',
  });
  assert.match(table.data, /'=1\+1/);
  assert.match(table.data, /"a,b"/);
  assert.equal(
    normalizeResult({ kind: 'file', data: 'abc', filename: '../a.txt' }).filename,
    '.._a.txt',
  );
  assert.throws(() => normalizeResult({ kind: 'image', data: 'https://example.com/image.png' }));
  assert.throws(() => normalizeResult({ kind: 'table', rows: ['wrong'], columns: [] }));
});
test('tool generation uses an async contract without changing craft generation', () => {
  const result = { name: 'tool', description: '', script: draft.script, css: '', steps: [] };
  const response = {
    output: [{ content: [{ type: 'output_text', text: JSON.stringify(result) }] }],
  };
  assert.deepEqual(parseResponse(response, 'openai', true), result);
  assert.throws(() => parseResponse(response, 'openai'));
  for (const provider of ['openai', 'deepseek', 'claude', 'google'] as const) {
    const settings = updateSettings(normalizeSettings({}), {
      provider,
      model: 'test',
      apiKey: 'fake',
    });
    assert.match(
      JSON.stringify(buildRequest(settings, 'request', customInstructions).body),
      /ASYNC FUNCTION BODY/,
    );
    assert.match(
      JSON.stringify(buildRequest(settings, 'request').body),
      /synchronous function BODY/,
    );
  }
});

import { test } from 'node:test';
import './i18n.test';
import './stream.test';
import './tools.test';
import './custom.test';
import './runtime-ai.test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { checkScript, validateGenerated } from '../src/check';
import { matchesPattern, matchesRules, originsFor, parsePattern } from '../src/rules';
import { runtimeCode } from '../src/runtime';
import { collectContext } from '../src/context';
import { parseResponse, buildRequest } from '../src/ai';
import { normalizeSettings, updateSettings, publicSettings } from '../src/providers';
import { type Craft } from '../src/types';
import { emptyState } from '../src/types';
import { transact } from '../src/store';
import { conversationHistory, type ConversationEntry } from '../src/conversation';
test('conversation history is bounded and isolated by feature', () => {
  const entry = (
    targetId: string,
    status: ConversationEntry['status'] = 'saved',
  ): ConversationEntry => ({
    id: 'id',
    targetId,
    prompt: 'x'.repeat(2000),
    message: '',
    status,
  });
  const entries = [
    ...Array.from({ length: 10 }, () => entry('one')),
    entry('two'),
    entry('one', 'error'),
    entry('one', 'pending'),
    { ...entry('one'), undone: true },
  ];
  assert.equal(conversationHistory(entries).length, 0);
  assert.equal(conversationHistory(entries, 'one').length, 6);
  assert.equal(conversationHistory(entries, 'one')[0].length, 1500);
  assert.equal(conversationHistory(entries, 'two').length, 1);
});
const craft = (script: string, css = ''): Craft => ({
  id: 'test',
  name: 'Test',
  description: '',
  matches: ['https://example.com/read*'],
  excludeMatches: ['https://example.com/read/private*'],
  enabled: true,
  activeVersionId: 'v1',
  versions: [{ id: 'v1', prompt: 'test', script, css, steps: [], createdAt: 1 }],
  createdAt: 1,
  updatedAt: 1,
});
test('provider profiles migrate, isolate credentials and redact all keys', () => {
  const legacy = normalizeSettings({ apiKey: 'legacy-secret', model: 'old-model', consent: true });
  assert.equal(legacy.provider, 'openai');
  const switched = updateSettings(legacy, { provider: 'google' });
  assert.equal(switched.apiKey, '');
  assert.equal(switched.consent, false);
  const saved = updateSettings(switched, {
    apiKey: 'google-secret',
    model: 'gemini-test',
    consent: true,
  });
  assert.equal(updateSettings(saved, { provider: 'openai' }).apiKey, 'legacy-secret');
  const cleared = updateSettings(saved, { clearKey: true });
  assert.equal(cleared.apiKey, '');
  assert.equal(cleared.profiles.openai?.apiKey, 'legacy-secret');
  const redacted = publicSettings(saved);
  assert.equal(JSON.stringify(redacted).includes('secret'), false);
  assert.equal(redacted.profiles.google.hasKey, true);
  assert.throws(() => updateSettings(saved, { provider: '__proto__' }));
});
test('native provider request contracts and completion parsing', () => {
  const value = { name: 'test', description: '', script: '', css: 'body {}', steps: [] };
  const text = JSON.stringify(value);
  const replies = {
    openai: { output: [{ content: [{ type: 'output_text', text }] }] },
    deepseek: { choices: [{ finish_reason: 'stop', message: { content: text } }] },
    google: {
      candidates: [
        { finishReason: 'STOP', content: { parts: [{ thought: true, text: 'ignore' }, { text }] } },
      ],
    },
    claude: { stop_reason: 'end_turn', content: [{ type: 'text', text }] },
  };
  for (const provider of ['openai', 'deepseek', 'google', 'claude'] as const) {
    const request = buildRequest(
      updateSettings(normalizeSettings({}), {
        provider,
        apiKey: 'unique-test-credential',
        model: 'test-model',
      }),
      'user request',
    );
    assert.equal(request.url.includes('unique-test-credential'), false);
    assert.equal(JSON.stringify(request.body).includes('unique-test-credential'), false);
    assert.equal(
      request.headers[
        provider === 'google'
          ? 'x-goog-api-key'
          : provider === 'claude'
            ? 'x-api-key'
            : 'Authorization'
      ],
      provider === 'openai' || provider === 'deepseek'
        ? 'Bearer unique-test-credential'
        : 'unique-test-credential',
    );
    assert.deepEqual(parseResponse(replies[provider], provider), value);
    assert.throws(() => parseResponse({}, provider));
    const body = request.body as any;
    if (provider === 'openai') assert.equal(body.text.format.strict, true);
    if (provider === 'deepseek') {
      assert.equal(body.response_format.type, 'json_object');
      assert.equal(body.max_tokens, 32768);
      assert.deepEqual(body.thinking, { type: 'disabled' });
    } else {
      assert.equal(body.thinking, undefined);
      assert.equal(
        body.max_tokens ?? body.max_output_tokens ?? body.generationConfig.maxOutputTokens,
        12000,
      );
    }
    if (provider === 'google')
      assert.equal(body.generationConfig.responseMimeType, 'application/json');
    if (provider === 'claude') assert.equal(body.output_config.format.type, 'json_schema');
  }
  assert.throws(() => parseResponse({ choices: [{ finish_reason: 'length' }] }, 'deepseek'));
  assert.throws(() => parseResponse({ candidates: [{ finishReason: 'MAX_TOKENS' }] }, 'google'));
  assert.throws(() => parseResponse({ stop_reason: 'refusal' }, 'claude'));
});
test('rules handle subdomains, schemes, exclusions, wildcard paths and ignore query', () => {
  assert.equal(matchesPattern('*://*.example.com/read*', 'https://example.com/read?a=1'), true);
  assert.equal(matchesPattern('*://*.example.com/*', 'https://a.example.com/a'), true);
  assert.equal(matchesPattern('*://*.example.com/*', 'https://evilexample.com/a'), false);
  assert.equal(matchesPattern('https://example.com/a.b', 'https://example.com/axb'), false);
  assert.equal(matchesPattern('https://example.com/*', 'http://example.com/'), false);
  assert.equal(
    matchesRules(
      ['https://example.com/*'],
      ['https://example.com/private*'],
      'https://example.com/private',
    ),
    false,
  );
  assert.deepEqual(originsFor(['https://example.com/a', 'https://example.com/b']), [
    'https://example.com/*',
  ]);
  assert.throws(() => parsePattern('https://example.com:3000/*'));
  assert.throws(() => parsePattern('<all_urls>'));
});
test('development mode allows browser APIs, HTML, SVG, dynamic access and external CSS', () => {
  for (const script of [
    'fetch("https://example.com")',
    'document.cookie',
    'document["cookie"]',
    'window.location.href',
    'localStorage.getItem("x")',
    'eval("1")',
    'new Function("return 1")',
    'import("https://example.com/module.js")',
    'document.createElementNS("http://www.w3.org/2000/svg", "svg")',
    'document.createElement("img").src = "https://example.com/a.png"',
    'document.createElement("a").setAttribute("onclick", "return false")',
    'const tag = "iframe"; document.createElement(tag)',
    'document.body.innerHTML = "<h2>Test</h2>"',
    'ctx.style("body { background: url(https://example.com/a.png) }")',
  ])
    assert.equal(checkScript(script, ''), true);
  for (const css of [
    '@import "https://example.com/a.css";',
    '/* comment */',
    'a { background: url(https://example.com/a.png) }',
  ]) {
    assert.equal(checkScript('', css), true);
  }
  assert.throws(() => checkScript('const broken = ;', ''));
  assert.throws(() => checkScript('with (document) {}', ''));
});
test('response parser handles refusal, incomplete and invalid schema', () => {
  assert.throws(() => parseResponse({ output: [{ content: [{ type: 'refusal' }] }] }));
  assert.throws(() => parseResponse({ status: 'incomplete' }));
  assert.throws(() => validateGenerated({ name: 'x' }));
  assert.throws(() => parseResponse({ output: [] }));
  const value = { name: 'x', description: '', script: '', css: 'body {}', steps: [] };
  assert.deepEqual(
    parseResponse({
      output: [{ content: [{ type: 'output_text', text: JSON.stringify(value) }] }],
    }),
    value,
  );
});
test('storage transactions serialize updates and failed saves preserve old data', async () => {
  let stored = emptyState();
  let fail = false;
  (globalThis as any).chrome = {
    storage: {
      local: {
        setAccessLevel: async () => {},
        get: async () => ({ state: structuredClone(stored) }),
        set: async ({ state }: any) => {
          if (fail) throw new Error('quota');
          stored = structuredClone(state);
        },
      },
    },
  };
  try {
    await Promise.all([
      transact(async (s) => {
        await new Promise((r) => setTimeout(r, 10));
        s.settings.model = 'test';
      }),
      transact((s) => {
        s.settings.consent = true;
      }),
    ]);
    assert.equal(stored.settings.model, 'test');
    assert.equal(stored.settings.consent, true);
    fail = true;
    await assert.rejects(
      transact((s) => {
        s.settings.model = 'lost';
      }),
      /quota/,
    );
    assert.equal(stored.settings.model, 'test');
    fail = false;
    await transact((s) => {
      s.settings.model = 'recovered';
    });
    assert.equal(stored.settings.model, 'recovered');
  } finally {
    delete (globalThis as any).chrome;
  }
});
test('runtime initializes once, cleans old version, reacts to SPA routes and disables', async () => {
  const dom = new JSDOM('<body><h1>Article</h1></body>', {
    url: 'https://example.com/read',
    runScripts: 'outside-only',
  });
  const w = dom.window as any;
  w.chrome = { runtime: { sendMessage: () => Promise.resolve() } };
  try {
    const c = craft(
      'const el=document.createElement("button"); el.textContent="one";ctx.append(document.body,el);',
      'h1{color:red}',
    );
    w.eval(runtimeCode([c]));
    w.eval(runtimeCode([c]));
    assert.equal(w.document.querySelectorAll('button').length, 1);
    c.activeVersionId = 'v2';
    c.versions.unshift({
      id: 'v2',
      script:
        'const el=document.createElement("button");el.textContent="two";ctx.append(document.body,el);',
      css: '',
      prompt: '',
      steps: [],
      createdAt: 2,
    });
    w.eval(runtimeCode([c]));
    assert.equal(w.document.querySelector('button').textContent, 'two');
    assert.equal(w.document.querySelectorAll('style').length, 0);
    w.history.pushState({}, '', '/read/private');
    await new Promise((r) => setTimeout(r, 820));
    assert.equal(w.document.querySelectorAll('button').length, 0);
    w.history.pushState({}, '', '/read/other');
    await new Promise((r) => setTimeout(r, 820));
    assert.equal(w.document.querySelectorAll('button').length, 1);
    w.eval(runtimeCode([]));
    assert.equal(w.document.querySelectorAll('button').length, 0);
  } finally {
    w.close();
  }
});
test('one throwing craft does not block later crafts', () => {
  const dom = new JSDOM('<body/>', { url: 'https://example.com/read', runScripts: 'outside-only' });
  const w = dom.window as any;
  w.chrome = { runtime: { sendMessage: () => Promise.resolve() } };
  try {
    const bad = craft('throw new Error("test")');
    const good = craft('ctx.append(document.body,document.createElement("button"))');
    good.id = 'good';
    w.eval(runtimeCode([bad, good]));
    assert.equal(w.document.querySelectorAll('button').length, 1);
  } finally {
    w.close();
  }
});
test('context excludes form values, editable text, hidden content and query; caps size', async () => {
  const dom = new JSDOM(
    '<body><h1>Visible</h1><input value="SECRET"><textarea>SECRET</textarea><div hidden>HIDDEN</div><div contenteditable>EDIT</div><script>COOKIE</script><p class="article">Safe</p></body>',
    { url: 'https://example.com/read?token=SECRET#secret', runScripts: 'outside-only' },
  );
  try {
    const w = dom.window as any;
    const result = await w.eval(`(${collectContext.toString()})(false)`);
    assert.match(result.summary, /Visible/);
    assert.match(result.summary, /Safe/);
    assert.doesNotMatch(result.summary, /SECRET|HIDDEN|EDIT|COOKIE/);
    assert.equal(result.url, 'https://example.com/read');
    for (let i = 0; i < 300; i++) {
      const p = w.document.createElement('p');
      p.textContent = 'a'.repeat(180);
      w.document.body.append(p);
    }
    const large = await w.eval(`(${collectContext.toString()})(false)`);
    assert.ok(large.summary.length <= 20000);
    assert.equal(large.truncated, true);
  } finally {
    dom.window.close();
  }
});

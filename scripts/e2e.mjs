import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, mkdtemp, cp } from 'node:fs/promises';
import { resolve, extname, join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { copyScript, exportScript } from '../tests/scripts.mjs';

const root = resolve('dist');
const server = createServer(async (req, res) => {
  try {
    const name = new URL(req.url, 'http://localhost').pathname;
    const file = resolve(root, '.' + name);
    if (!file.startsWith(root + '/')) throw new Error();
    const data = await readFile(file);
    res.setHeader(
      'Content-Type',
      {
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript',
        '.svg': 'image/svg+xml',
        '.css': 'text/css',
      }[extname(file)] || 'text/plain',
    );
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(join(tmpdir(), 'pagecraft-e2e-'));
// Headless Chrome cannot approve its native optional-host dialog. Only the
// disposable test copy pregrants capture permission; dist stays unchanged.
const testExtension = await mkdtemp(join(tmpdir(), 'pagecraft-extension-'));
await cp(root, testExtension, { recursive: true });
const testManifest = JSON.parse(await readFile(join(testExtension, 'manifest.json'), 'utf8'));
assert.deepEqual(testManifest.host_permissions, [
  'https://api.openai.com/*',
  'https://api.deepseek.com/*',
  'https://generativelanguage.googleapis.com/*',
  'https://api.anthropic.com/*',
]);
testManifest.host_permissions.push('<all_urls>');
await writeFile(join(testExtension, 'manifest.json'), JSON.stringify(testManifest));
let context;
await mkdir('artifacts', { recursive: true });
try {
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    viewport: null,
    args: [`--disable-extensions-except=${testExtension}`, `--load-extension=${testExtension}`],
  });
  let worker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
  const id = new URL(worker.url()).host;
  const extensions = await context.newPage();
  await extensions.goto('chrome://extensions');
  console.log('Extension loaded:', id);
  const info = await extensions.evaluate(async (id) => {
    await chrome.developerPrivate.updateExtensionConfiguration({
      extensionId: id,
      userScriptsAccess: true,
    });
    return chrome.developerPrivate.getExtensionInfo(id);
  }, id);
  console.log('User scripts enabled:', info.userScriptsAccess);
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${id}/options.html`);
  const rpc = async (type, payload = {}) => {
    console.log('RPC', type);
    const r = await panel.evaluate((m) => chrome.runtime.sendMessage(m), { type, ...payload });
    assert.equal(r?.ok, true, r?.error);
    return r.data;
  };
  let state = await rpc('STATE');
  assert.equal(state.available, true);
  const page = await context.newPage();
  await page.goto(base + '/fixtures/article.html');
  const tabId = await panel.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({});
    return tabs.find((t) => t.url === url).id;
  }, base + '/fixtures/article.html');
  const summary = await rpc('CONTEXT', { tabId });
  const captureTab = await context.newPage();
  await captureTab.goto(base + '/fixtures/capture.html');
  const captureId = await panel.evaluate(
    async (url) => (await chrome.tabs.query({})).find((t) => t.url === url).id,
    base + '/fixtures/capture.html',
  );
  await captureTab.evaluate(() => scrollTo(0, 123));
  await captureTab.bringToFront();
  // captureVisibleTab uses native window geometry, which settles after tab activation.
  await captureTab.waitForTimeout(500);
  const nativeHeight = await captureTab.evaluate(() => innerHeight * devicePixelRatio);
  const textResult = await rpc('TOOL_RUN', {
    id: 'tool-text',
    tool: 'extract-text',
    tabId: captureId,
  });
  assert.match(textResult.data, /Bottom section/);
  assert.ok(!textResult.data.includes('PRIVATE_INPUT'));
  assert.ok(!textResult.data.includes('PRIVATE_EDITABLE'));
  const screenshot = await rpc('TOOL_RUN', {
    id: 'tool-full',
    tool: 'screenshot-full',
    tabId: captureId,
  });
  assert.equal(screenshot.height, 2400);
  assert.equal(await captureTab.evaluate(() => scrollY), 123);
  assert.equal(await captureTab.locator('header').evaluate((el) => el.style.visibility), '');
  const pixels = await panel.evaluate(async (url) => {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    return [400, 1200, 2000].map((y) => Array.from(ctx.getImageData(500, y, 1, 1).data));
  }, screenshot.data);
  assert.deepEqual(pixels, [
    [230, 65, 69, 255],
    [39, 174, 96, 255],
    [39, 107, 214, 255],
  ]);
  await writeFile(
    'artifacts/full-page-result.png',
    Buffer.from(screenshot.data.split(',')[1], 'base64'),
  );
  const visible = await rpc('TOOL_RUN', {
    id: 'tool-visible',
    tool: 'screenshot-visible',
    tabId: captureId,
  });
  assert.equal(visible.height, nativeHeight);
  const cancelCapture = panel.evaluate(
    (tabId) =>
      chrome.runtime.sendMessage({
        type: 'TOOL_RUN',
        id: 'tool-cancel',
        tool: 'screenshot-full',
        tabId,
      }),
    captureId,
  );
  await panel.waitForFunction(
    async () =>
      (await chrome.runtime.sendMessage({ type: 'TOOL_STATE' })).data?.id === 'tool-cancel',
  );
  await rpc('TOOL_CANCEL', { id: 'tool-cancel' });
  assert.equal((await cancelCapture).ok, false);
  assert.equal(await captureTab.evaluate(() => scrollY), 123);
  await panel.getByRole('button', { name: '工具', exact: true }).click();
  await panel.getByRole('button', { name: '提取页面文本', exact: true }).click();
  await panel.getByLabel('提取的页面文本').waitFor();
  const toolDownload = panel.waitForEvent('download');
  await panel.getByRole('button', { name: '下载结果', exact: true }).click();
  assert.match((await toolDownload).suggestedFilename(), /\.txt$/);
  for (const width of [320, 390, 1024]) {
    await panel.setViewportSize({ width, height: 850 });
    assert.equal(
      await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    await panel.screenshot({ path: `artifacts/tools-${width}.png`, fullPage: true });
  }
  await panel.getByRole('button', { name: '创建工具', exact: true }).click();
  await panel.getByRole('tab', { name: '手动编写' }).click();
  await panel.getByLabel('工具名称', { exact: true }).fill('页面链接');
  await panel.getByLabel('工具说明', { exact: true }).fill('列出当前页链接\n可跨网站使用');
  await panel.getByLabel('工具运行参数').fill('{"label":"来自参数"}');
  await panel
    .getByLabel('工具 JavaScript')
    .fill(
      'await Promise.resolve(); return {kind:"table",columns:["标题","参数"],rows:[[document.title,ctx.params.label]],filename:"links.csv"};',
    );
  await panel.getByRole('button', { name: '试运行', exact: true }).click();
  await panel.getByRole('heading', { name: '表格结果' }).waitFor();
  assert.equal(await panel.getByRole('cell', { name: '来自参数', exact: true }).count(), 1);
  assert.equal((await rpc('CUSTOM_LIST')).length, 0);
  await panel.getByRole('button', { name: '保存工具', exact: true }).click();
  await panel.getByText('工具已保存', { exact: true }).waitFor();
  const custom = (await rpc('CUSTOM_LIST'))[0];
  const firstCustomVersion = custom.activeVersionId;
  await panel.getByLabel('工具 JavaScript').fill('return "第二版";');
  await panel.getByRole('button', { name: '保存工具', exact: true }).click();
  await panel.waitForFunction(
    async () =>
      (await chrome.runtime.sendMessage({ type: 'CUSTOM_LIST' })).data?.[0]?.versions.length === 2,
  );
  await panel.getByLabel('工具历史版本').selectOption(firstCustomVersion);
  await panel.getByRole('button', { name: '恢复版本', exact: true }).click();
  await panel.getByText('已恢复所选版本', { exact: true }).waitFor();
  for (const width of [320, 1024]) {
    await panel.setViewportSize({ width, height: 900 });
    assert.equal(
      await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    await panel.screenshot({ path: `artifacts/custom-editor-${width}.png`, fullPage: true });
  }
  const customDraft = {
    name: '截图工具',
    description: '',
    script: 'return await ctx.tools.screenshot({fullPage:false});',
    css: '',
    steps: [],
    prompt: '',
    params: {},
  };
  await captureTab.bringToFront();
  const customImage = await rpc('CUSTOM_RUN', { tabId: captureId, data: customDraft });
  assert.equal(customImage.kind, 'image');
  assert.ok(customImage.height > 0 && customImage.width > 0);
  assert.match(customImage.data, /^data:image\/png;base64,/);
  const pendingCustom = panel.evaluate(
    (tabId) =>
      chrome.runtime.sendMessage({
        type: 'CUSTOM_RUN',
        tabId,
        data: {
          name: '取消测试',
          description: '',
          script:
            'document.body.setAttribute("data-custom-running","yes");ctx.onCleanup(()=>document.body.removeAttribute("data-custom-running"));await new Promise(resolve=>ctx.signal.addEventListener("abort",resolve,{once:true}));return "late";',
          css: '',
          steps: [],
          prompt: '',
          params: {},
        },
      }),
    captureId,
  );
  await captureTab.locator('body[data-custom-running="yes"]').waitFor();
  await rpc('CUSTOM_CANCEL');
  assert.equal((await pendingCustom).ok, false);
  await captureTab.waitForFunction(() => !document.body.hasAttribute('data-custom-running'));
  const tempCustom = await rpc('CUSTOM_SAVE', { data: customDraft });
  await rpc('CUSTOM_DELETE', { id: tempCustom.id });
  assert.equal((await rpc('CUSTOM_LIST')).length, 1);
  await panel
    .getByLabel('工具 JavaScript', { exact: true })
    .fill(
      'return await ctx.tools.download({kind:"file",data:"custom download",filename:"custom.txt",mime:"text/plain"});',
    );
  const customDownloadPending = panel.waitForEvent('download');
  await panel.getByRole('button', { name: '试运行', exact: true }).click();
  const customDownload = await customDownloadPending;
  assert.equal(customDownload.suggestedFilename(), 'custom.txt');
  assert.equal(await readFile(await customDownload.path(), 'utf8'), 'custom download');
  await captureTab.close();
  await page.bringToFront();
  const crossPageResult = await rpc('CUSTOM_RUN', { tabId, toolId: custom.id });
  assert.equal(crossPageResult.kind, 'table');
  assert.equal(crossPageResult.rows[0][1], '来自参数');
  assert.notEqual(crossPageResult.rows[0][0], 'Capture fixture');
  await panel.getByRole('button', { name: '我的改造', exact: false }).click();
  assert.ok(!summary.summary.includes('DO_NOT_SEND_123'));
  const selecting = rpc('CONTEXT', { tabId, select: true });
  await page.locator('[data-pagecraft="picker"]').waitFor();
  await page.locator('h1').click();
  const selected = await selecting;
  assert.match(selected.summary, /浏览器里的小改造/);
  assert.ok(!selected.summary.includes('项目列表'));
  const data = {
    name: '阅读改造',
    description: '隐藏推荐并增加按钮',
    script:
      'const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");svg.setAttribute("data-unrestricted","yes");ctx.append(document.body,svg);const b=document.createElement("button");b.innerHTML="PageCraft 已应用";ctx.append(document.body,b);',
    css: '.recommendations { display: none; }',
    steps: ['确认右侧推荐隐藏'],
  };
  const result = await rpc('SAVE', {
    data,
    matches: ['http://127.0.0.1/fixtures/*'],
    excludeMatches: ['http://127.0.0.1/fixtures/private*'],
  });
  await page.getByRole('button', { name: 'PageCraft 已应用' }).waitFor();
  assert.equal(await page.locator('svg[data-unrestricted="yes"]').count(), 1);
  assert.equal(await page.locator('.recommendations').isVisible(), false);
  await rpc('REAPPLY');
  assert.equal(await page.getByRole('button', { name: 'PageCraft 已应用' }).count(), 1);
  await page.reload();
  await page.getByRole('button', { name: 'PageCraft 已应用' }).waitFor();
  await page.getByRole('button', { name: '切换 SPA 路径' }).click();
  await page.getByRole('button', { name: 'PageCraft 已应用' }).waitFor({ state: 'detached' });
  assert.equal(await page.locator('.recommendations').isVisible(), true);
  await page.getByRole('button', { name: '切换 SPA 路径' }).click();
  await page.getByRole('button', { name: 'PageCraft 已应用' }).waitFor();
  await rpc('TOGGLE', { id: result.craftId, enabled: false });
  await page.getByRole('button', { name: 'PageCraft 已应用' }).waitFor({ state: 'detached' });
  await rpc('TOGGLE', { id: result.craftId, enabled: true });
  await page.getByRole('button', { name: 'PageCraft 已应用' }).waitFor();
  state = await rpc('STATE');
  const old = state.crafts[0].activeVersionId;
  await rpc('SAVE', {
    craftId: result.craftId,
    expectedVersion: old,
    data: { ...data, script: data.script.replace('已应用', '第二版') },
    matches: ['http://127.0.0.1/fixtures/*'],
    excludeMatches: ['http://127.0.0.1/fixtures/private*'],
  });
  await page.getByRole('button', { name: 'PageCraft 第二版' }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'PageCraft 已应用' }).count(), 0);
  await rpc('ROLLBACK', { id: result.craftId, versionId: old });
  await page.getByRole('button', { name: 'PageCraft 已应用' }).waitFor();
  const denied = await panel.evaluate(
    (data) =>
      chrome.runtime.sendMessage({
        type: 'SAVE',
        data: { ...data, script: 'const broken = ;' },
        matches: ['http://127.0.0.1/*'],
        excludeMatches: [],
      }),
    data,
  );
  assert.equal(denied.ok, false);
  await rpc('DELETE', { id: result.craftId });
  await page.getByRole('button', { name: 'PageCraft 已应用' }).waitFor({ state: 'detached' });
  await rpc('UNDO', { id: result.craftId });
  await page.getByRole('button', { name: 'PageCraft 已应用' }).waitFor();
  for (const provider of ['deepseek', 'google', 'claude']) {
    await rpc('SETTINGS', {
      provider,
      apiKey: `fake-${provider}`,
      model: 'test-model',
      consent: true,
    });
    await worker.evaluate(
      ({ provider, data }) => {
        globalThis.fetch = async (url, options) => {
          const expected = {
            deepseek: 'api.deepseek.com',
            google: 'generativelanguage.googleapis.com',
            claude: 'api.anthropic.com',
          };
          if (new URL(url).hostname !== expected[provider])
            throw new Error('wrong provider endpoint');
          const text = JSON.stringify(data);
          const replies = {
            deepseek: [
              { choices: [{ index: 0, finish_reason: 'stop', delta: { content: text } }] },
              '[DONE]',
            ],
            google: [{ candidates: [{ finishReason: 'STOP', content: { parts: [{ text }] } }] }],
            claude: [
              { type: 'content_block_delta', delta: { type: 'text_delta', text } },
              { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
              { type: 'message_stop' },
            ],
          };
          return new Response(
            replies[provider]
              .map((event) => `data: ${event === '[DONE]' ? event : JSON.stringify(event)}\n\n`)
              .join(''),
            { headers: { 'Content-Type': 'text/event-stream' } },
          );
        };
      },
      { provider, data },
    );
    await rpc('TEST');
    const publicState = await rpc('STATE');
    assert.equal(publicState.settings.provider, provider);
    assert.equal(JSON.stringify(publicState).includes(`fake-${provider}`), false);
  }
  // Stub only the HTTP boundary; production parser, validation, storage
  // and browser execution still run. No real key or billable request is used.
  await rpc('SETTINGS', {
    provider: 'openai',
    apiKey: 'sk-test-not-a-real-key',
    model: 'test-model',
    consent: true,
  });
  await worker.evaluate((data) => {
    globalThis.fetch = async () => {
      const text = JSON.stringify({
        ...data,
        name: '阅读改造',
        script: data.script.replace('已应用', 'AI 版本'),
      });
      const encode = (event) => new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
      let timer;
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(encode({ type: 'response.output_text.delta', delta: text }));
            timer = setTimeout(() => {
              controller.enqueue(
                encode({
                  type: 'response.completed',
                  response: {
                    status: 'completed',
                    output: [{ content: [{ type: 'output_text', text }] }],
                  },
                }),
              );
              controller.close();
            }, 2000);
          },
          cancel() {
            clearTimeout(timer);
          },
        }),
        { headers: { 'Content-Type': 'text/event-stream' } },
      );
    };
  }, data);
  const generation = rpc('GENERATE', {
    id: 'generate-success',
    tabId,
    prompt: '修改按钮文字',
    matches: ['http://127.0.0.1/fixtures/*'],
    excludeMatches: [],
    craftId: result.craftId,
  });
  await panel.waitForFunction(async (tabId) => {
    const reply = await chrome.runtime.sendMessage({ type: 'STATE' });
    return reply.data?.tasks[String(tabId)]?.receivedChars > 0;
  }, tabId);
  await generation;
  await page.getByRole('button', { name: 'PageCraft AI 版本' }).waitFor();
  const beforeFailure = await rpc('STATE');
  const generatedTool = await rpc('CUSTOM_GENERATE', {
    prompt: '创建通用工具',
    params: {},
    includeContext: false,
  });
  assert.equal(typeof generatedTool.script, 'string');
  assert.equal((await rpc('CUSTOM_LIST')).length, 1);
  await worker.evaluate(() => {
    globalThis.fetch = async () =>
      new Response('data: {"type":"response.output_text.delta","delta":"partial"}\n\n', {
        headers: { 'Content-Type': 'text/event-stream' },
      });
  });
  const disconnected = await panel.evaluate((payload) => chrome.runtime.sendMessage(payload), {
    type: 'GENERATE',
    id: 'disconnected-stream',
    tabId,
    prompt: '连接中断测试',
    matches: ['http://127.0.0.1/fixtures/*'],
    excludeMatches: [],
    craftId: result.craftId,
  });
  assert.equal(disconnected.ok, false);
  assert.match(disconnected.error, /断开/);
  assert.equal(
    (await rpc('STATE')).crafts[0].activeVersionId,
    beforeFailure.crafts[0].activeVersionId,
  );
  await worker.evaluate(() => {
    globalThis.fetch = async () => new Response('{}', { status: 429 });
  });
  const fail = await panel.evaluate((payload) => chrome.runtime.sendMessage(payload), {
    type: 'GENERATE',
    id: 'generate-fail',
    tabId,
    prompt: '触发限流',
    matches: ['http://127.0.0.1/fixtures/*'],
    excludeMatches: [],
    craftId: result.craftId,
  });
  assert.equal(fail.ok, false);
  assert.match(fail.error, /受限/);
  assert.equal(
    (await rpc('STATE')).crafts[0].activeVersionId,
    beforeFailure.crafts[0].activeVersionId,
  );
  await worker.evaluate(() => {
    globalThis.fetch = (_, options) =>
      new Promise((_, reject) => {
        if (options.signal.aborted) reject(new Error('aborted'));
        else options.signal.addEventListener('abort', () => reject(new Error('aborted')));
      });
  });
  const cancelled = panel.evaluate((payload) => chrome.runtime.sendMessage(payload), {
    type: 'GENERATE',
    id: 'generate-cancel',
    tabId,
    prompt: '取消此请求',
    matches: ['http://127.0.0.1/fixtures/*'],
    excludeMatches: [],
    craftId: result.craftId,
  });
  await panel.waitForFunction(async () => {
    const r = await chrome.runtime.sendMessage({ type: 'STATE' });
    return Object.values(r.data.tasks).some(
      (t) => t.id === 'generate-cancel' && t.stage === 'AI 正在生成',
    );
  });
  await rpc('CANCEL', { id: 'generate-cancel' });
  assert.equal((await cancelled).ok, false);
  assert.equal(
    (await rpc('STATE')).crafts[0].activeVersionId,
    beforeFailure.crafts[0].activeVersionId,
  );
  console.log('Checking user-script message isolation');
  const bridge = await panel.evaluate(
    (tabId) =>
      chrome.userScripts.execute({
        target: { tabId },
        js: [
          {
            code: 'chrome.runtime.sendMessage({type:"STATE"}).then(value=>value?.settings?.apiKey||"denied").catch(()=>"denied")',
          },
        ],
      }),
    tabId,
  );
  assert.equal(bridge[0].result, 'denied');
  assert.equal((await rpc('STATE')).settings.apiKey, '');
  await rpc('ROLLBACK', { id: result.craftId, versionId: old });
  await page.getByRole('button', { name: 'PageCraft 已应用' }).waitFor();
  const unavailable = await panel.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'CONTEXT', tabId: -1 }),
  );
  assert.equal(unavailable.ok, false);
  const copyCraft = await rpc('SAVE', {
    data: { ...data, name: '代码复制', script: copyScript, css: '' },
    matches: ['http://127.0.0.1/fixtures/*'],
    excludeMatches: [],
  });
  await page.getByRole('button', { name: '复制代码' }).waitFor();
  await page.getByRole('button', { name: '加载更多' }).click();
  await page.waitForFunction(() => document.querySelectorAll('[data-copy]').length === 2);
  await rpc('SAVE', {
    data: { ...data, name: '表格导出', script: exportScript, css: '' },
    matches: ['http://127.0.0.1/fixtures/*'],
    excludeMatches: [],
  });
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 CSV' }).click();
  const download = await downloading;
  const csv = await readFile(await download.path(), 'utf8');
  assert.match(csv, /异步加载项目/);
  assert.match(csv, /"名称","状态"/);
  await rpc('TOGGLE', { id: copyCraft.craftId, enabled: false });
  assert.equal(await page.getByRole('button', { name: '复制代码' }).count(), 0);
  await panel.reload();
  await panel.getByRole('button', { name: /阅读改造/ }).waitFor();
  for (const width of [390, 320, 1024]) {
    await panel.setViewportSize({ width, height: 900 });
    await panel.screenshot({ path: `artifacts/library-${width}.png`, fullPage: true });
    assert.ok(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  await panel.getByRole('button', { name: '设置', exact: true }).click();
  for (const provider of ['deepseek', 'google', 'claude', 'openai']) {
    await panel.getByLabel('AI 服务商').selectOption(provider);
    assert.equal(await panel.getByLabel('API Key', { exact: true }).inputValue(), '');
    assert.equal(await panel.getByLabel('模型 ID', { exact: true }).inputValue(), 'test-model');
  }
  await panel.setViewportSize({ width: 320, height: 800 });
  assert.equal(
    await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
  );
  await panel.screenshot({ path: 'artifacts/settings-mobile.png', fullPage: true });
  await panel.setViewportSize({ width: 1024, height: 800 });
  await panel.screenshot({ path: 'artifacts/settings.png', fullPage: true });
  await panel.getByRole('button', { name: '当前页面', exact: true }).click();
  await panel.getByRole('heading', { name: '127.0.0.1', exact: true }).waitFor();
  await panel.setViewportSize({ width: 390, height: 1000 });
  await panel.screenshot({ path: 'artifacts/current-page.png', fullPage: true });
  const autoDraft = {
    name: '常驻测试',
    description: '自动启动回归',
    prompt: '',
    params: {},
    css: '',
    steps: [],
    autoStart: {
      enabled: true,
      scope: 'sites',
      matches: ['http://127.0.0.1/fixtures/*'],
      rerunOnRoute: false,
    },
    script:
      'const b=document.createElement("button");b.id="pc-auto-test";b.textContent="常驻工具";document.body.append(b);document.body.dataset.autoCount=String(Number(document.body.dataset.autoCount||0)+1);b.onclick=async()=>{const result=await ctx.tools.extractText();await ctx.tools.download({...result,filename:"resident.txt"});};ctx.onCleanup(()=>{b.onclick=null;b.remove();});await Promise.resolve();',
  };
  let autoTool = await rpc('CUSTOM_SAVE', { data: autoDraft });
  const autoVersion = autoTool.activeVersionId;
  await page.locator('#pc-auto-test').waitFor();
  await rpc('REAPPLY');
  assert.equal(await page.locator('#pc-auto-test').count(), 1);
  assert.equal(await page.locator('body').getAttribute('data-auto-count'), '1');
  await page.evaluate(() => history.pushState({}, '', '/fixtures/route'));
  await page.waitForTimeout(1100);
  assert.equal(await page.locator('body').getAttribute('data-auto-count'), '1');
  autoTool = await rpc('CUSTOM_SAVE', {
    id: autoTool.id,
    expectedVersion: autoTool.activeVersionId,
    data: { ...autoDraft, autoStart: { ...autoDraft.autoStart, rerunOnRoute: true } },
  });
  await page.waitForFunction(() => document.body.dataset.autoCount === '2');
  await page.evaluate(() => history.pushState({}, '', '/fixtures/another'));
  await page.waitForFunction(() => document.body.dataset.autoCount === '3');
  autoTool = await rpc('CUSTOM_SAVE', {
    id: autoTool.id,
    expectedVersion: autoTool.activeVersionId,
    data: { ...autoDraft, autoStart: { ...autoDraft.autoStart, enabled: false } },
  });
  await page.locator('#pc-auto-test').waitFor({ state: 'detached' });
  autoTool = await rpc('CUSTOM_ROLLBACK', {
    id: autoTool.id,
    expectedVersion: autoTool.activeVersionId,
    versionId: autoVersion,
  });
  await page.locator('#pc-auto-test').waitFor();
  await page.reload();
  // The route above has no fixture; restore a real document to verify reload injection.
  await page.goto(base + '/fixtures/article.html');
  await page.locator('#pc-auto-test').waitFor();
  await page.evaluate(() => history.pushState({}, '', '/outside'));
  await page.locator('#pc-auto-test').waitFor({ state: 'detached' });
  await page.evaluate(() => history.pushState({}, '', '/fixtures/article.html'));
  await page.locator('#pc-auto-test').waitFor();
  await panel.reload();
  await panel.getByRole('button', { name: '工具', exact: true }).click();
  await panel.getByRole('button', { name: '编辑 常驻测试', exact: true }).click();
  assert.equal(
    await panel.getByRole('checkbox', { name: '自动启动', exact: true }).isChecked(),
    true,
  );
  assert.equal(await panel.getByLabel('自动启动范围').inputValue(), 'sites');
  for (const width of [320, 1024]) {
    await panel.setViewportSize({ width, height: 900 });
    assert.ok(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await panel.screenshot({ path: `artifacts/auto-tools-${width}.png`, fullPage: true });
  }
  await rpc('CUSTOM_DELETE', { id: autoTool.id });
  await page.locator('#pc-auto-test').waitFor({ state: 'detached' });
  autoTool = await rpc('CUSTOM_SAVE', {
    data: { ...autoDraft, autoStart: { ...autoDraft.autoStart, scope: 'all' } },
  });
  await page.locator('#pc-auto-test').waitFor();
  await context.close();
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${testExtension}`, `--load-extension=${testExtension}`],
  });
  const reopened = await context.newPage();
  reopened.on('pageerror', (e) => console.log('AUTO PAGE ERROR', e.message));
  reopened.on('console', (m) => {
    if (m.type() === 'error') console.log('AUTO CONSOLE', m.text());
  });
  await reopened.goto(base + '/fixtures/article.html');
  await reopened.getByRole('button', { name: 'PageCraft 已应用' }).waitFor();
  await reopened.locator('#pc-auto-test').waitFor();
  const residentDownloadPending = reopened.waitForEvent('download');
  await reopened.locator('#pc-auto-test').click();
  const residentDownload = await residentDownloadPending;
  assert.equal(residentDownload.suggestedFilename(), 'resident.txt');
  assert.match(await readFile(await residentDownload.path(), 'utf8'), /这是 PageCraft 的本地验收页面/);
  const reopenedPanel = await context.newPage();
  await reopenedPanel.goto(`chrome-extension://${id}/options.html`);
  const persistedTools = await reopenedPanel.evaluate(
    async () => (await chrome.runtime.sendMessage({ type: 'CUSTOM_LIST' })).data,
  );
  assert.equal(persistedTools.length, 2);
  assert.equal(persistedTools[0].activeVersionId, firstCustomVersion);
  console.log(
    'PASS: real injection, reload, SPA, toggle, revisions, rollback, rejection, delete/undo, mocked AI generation, API failure retention, cancellation, key isolation, async code blocks, CSV download, responsive UI, browser restart',
  );
} finally {
  if (context) await context.close();
  await new Promise((r) => server.close(r));
}

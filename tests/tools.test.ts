import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureError, CAPTURE_PERMISSION, isProtectedStore } from '../src/tools/capture-error';
import { runTool } from '../src/tools/runner';
import { checkCaptureDocument } from '../src/tools/capture-document';
test('capture identity allows URL changes but stops on replacement or inactive tabs', async () => {
  const original = globalThis.chrome;
  let active = true,
    documentId = 'doc-one',
    url = 'https://example.com/#first';
  Object.assign(globalThis, {
    chrome: {
      tabs: { get: async () => ({ active, url }) },
      scripting: { executeScript: async () => [{ documentId, result: true }] },
    },
  });
  try {
    assert.equal(await checkCaptureDocument(1), 'doc-one');
    url = 'https://example.com/new-path?q=2#second';
    assert.equal(await checkCaptureDocument(1, 'doc-one'), 'doc-one');
    documentId = 'doc-two';
    await assert.rejects(checkCaptureDocument(1, 'doc-one'), /文档已刷新或跳转/);
    active = false;
    await assert.rejects(checkCaptureDocument(1, 'doc-two'), /标签页已切换/);
  } finally {
    Object.assign(globalThis, { chrome: original });
  }
});
test('protected store capture avoids injection and misleading host grants', async () => {
  assert.ok(isProtectedStore('https://chromewebstore.google.com/detail/test'));
  assert.ok(isProtectedStore('https://chrome.google.com/webstore/category/extensions'));
  assert.equal(isProtectedStore('https://chromewebstore.google.com.example.org'), false);
  const oldChrome = globalThis.chrome,
    oldBitmap = globalThis.createImageBitmap;
  let injections = 0,
    captures = 0;
  Object.assign(globalThis, {
    chrome: {
      tabs: {
        get: async () => ({ url: 'https://chromewebstore.google.com/', active: true, windowId: 1 }),
        captureVisibleTab: async () => {
          captures++;
          return 'data:image/png;base64,AA==';
        },
      },
      scripting: {
        executeScript: async () => {
          injections++;
          throw new Error('Cannot access a chrome web store page');
        },
      },
    },
    createImageBitmap: async () => ({ width: 800, height: 600, close() {} }),
  });
  try {
    await assert.rejects(runTool('full', 'screenshot-full', 1), /禁止页面脚本注入/);
    await assert.rejects(runTool('text', 'extract-text', 1), /禁止页面脚本注入/);
    assert.equal(captures, 0);
    const result = await runTool('visible', 'screenshot-visible', 1);
    assert.equal(result.width, 800);
    assert.equal(captures, 1);
    assert.equal(injections, 0);
    const error = captureError(
      new Error('activeTab permission required'),
      'https://chromewebstore.google.com/',
    );
    assert.equal(error.message.startsWith(CAPTURE_PERMISSION), false);
    assert.match(error.message, /系统截图/);
  } finally {
    Object.assign(globalThis, { chrome: oldChrome, createImageBitmap: oldBitmap });
  }
});
test('capture errors distinguish missing permission from capture failures', () => {
  assert.ok(
    captureError(
      new Error('Either the <all_urls> or activeTab permission is required.'),
    ).message.startsWith(CAPTURE_PERMISSION),
  );
  assert.equal(
    captureError(
      new Error('MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND quota exceeded'),
    ).message.startsWith(CAPTURE_PERMISSION),
    false,
  );
  assert.match(captureError(new Error('Failed to capture tab')).message, /Failed to capture tab/);
});
import { capturePositions, checkCanvasSize, toolDefinitions } from '../src/tools/registry';
test('tool registry and capture grid cover last partial tiles without gaps', () => {
  assert.deepEqual(
    toolDefinitions.map((tool) => tool.id),
    ['screenshot-visible', 'screenshot-full'],
  );
  assert.deepEqual(capturePositions(600, 800), [0]);
  assert.deepEqual(capturePositions(1600, 800), [0, 800]);
  assert.deepEqual(capturePositions(1850, 800), [0, 800, 1050]);
  assert.throws(() => capturePositions(100, 0));
  assert.throws(() => capturePositions(Infinity, 800));
  assert.throws(() => checkCanvasSize(40000, 100));
  assert.throws(() => checkCanvasSize(10000, 10000));
  assert.doesNotThrow(() => checkCanvasSize(1920, 8000));
});

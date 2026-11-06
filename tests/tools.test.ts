import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureError, CAPTURE_PERMISSION } from '../src/tools/capture-error';
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
  assert.equal(toolDefinitions.length, 3);
  assert.deepEqual(capturePositions(600, 800), [0]);
  assert.deepEqual(capturePositions(1600, 800), [0, 800]);
  assert.deepEqual(capturePositions(1850, 800), [0, 800, 1050]);
  assert.throws(() => capturePositions(100, 0));
  assert.throws(() => capturePositions(Infinity, 800));
  assert.throws(() => checkCanvasSize(40000, 100));
  assert.throws(() => checkCanvasSize(10000, 10000));
  assert.doesNotThrow(() => checkCanvasSize(1920, 8000));
});

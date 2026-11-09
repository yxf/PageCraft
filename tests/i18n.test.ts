import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { normalizePreference, resolveLanguage, translate } from '../src/i18n';
import { en } from '../src/locales/en';

test('language resolution, fallback and interpolation preserve user content', () => {
  assert.equal(resolveLanguage('auto', 'zh-TW'), 'zh-CN');
  assert.equal(resolveLanguage('auto', 'en-US'), 'en');
  assert.equal(resolveLanguage('auto', 'fr-FR'), 'en');
  assert.equal(resolveLanguage('en', 'zh-CN'), 'en');
  assert.equal(normalizePreference('invalid'), 'auto');
  assert.equal(translate('当前页面', 'en'), 'Current');
  assert.equal(translate('改造', 'en'), 'Craft');
  assert.equal(translate('我的改造', 'en'), 'Crafts');
  assert.equal(translate('创建改造', 'en'), 'Create a craft');
  assert.equal(translate('描述你想调整的地方…', 'en'), 'Describe what you want to change…');
  assert.equal(translate('当前页面', 'zh-CN'), '当前页面');
  assert.equal(translate('unknown', 'en'), 'unknown');
  assert.equal(translate('正在编辑：{0}', 'en', ['中文工具 {1}']), 'Editing: 中文工具 {1}');
});

test('all static UI translation keys have English translations', () => {
  for (const file of [
    'src/main.tsx',
    'src/CurrentPage.tsx',
    'src/tools/CustomTools.tsx',
    'src/tools/ToolsView.tsx',
  ]) {
    const source = ts.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const visit = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        node.expression.getText(source) === 't' &&
        ts.isStringLiteral(node.arguments[0])
      ) {
        const key = node.arguments[0].text;
        assert.ok(en[key], `${file}: missing translation for ${key}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
});

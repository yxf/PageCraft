import { parse } from 'acorn';
import type { Generated } from './types';

// Development mode: validate executable syntax, not capabilities or safety.
export function checkScript(script: string, _css: string, asyncMode = false) {
  try {
    parse(`${asyncMode ? 'async ' : ''}function craft(ctx){"use strict";\n${script}\n}`, {
      ecmaVersion: 'latest',
      sourceType: 'script',
    });
  } catch {
    throw new Error('JavaScript 语法错误，请修正后重试');
  }
  return true;
}
export function validateGenerated(raw: unknown, asyncMode = false): Generated {
  const x = raw as Generated;
  if (
    !x ||
    typeof x.name !== 'string' ||
    !x.name.trim() ||
    typeof x.description !== 'string' ||
    typeof x.script !== 'string' ||
    typeof x.css !== 'string' ||
    !Array.isArray(x.steps) ||
    x.steps.some((s) => typeof s !== 'string')
  )
    throw new Error('AI 返回的数据格式不符合要求');
  if (!x.script.trim() && !x.css.trim()) throw new Error('未生成有效改造');
  checkScript(x.script, x.css, asyncMode);
  return x;
}

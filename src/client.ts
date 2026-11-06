import { emptyState } from './types';
import { publicSettings } from './providers';
export const isExtension = typeof chrome !== 'undefined' && !!chrome.runtime?.id;
export async function send(type: string, payload: Record<string, unknown> = {}): Promise<any> {
  if (!isExtension) {
    if (type === 'STATE')
      return {
        ...emptyState(),
        available: false,
        grants: {},
        settings: publicSettings(emptyState().settings),
      };
    throw new Error('这是界面预览。请在 Chrome 中加载 dist 扩展后使用。');
  }
  const result = await chrome.runtime.sendMessage({ type, ...payload });
  if (!result?.ok) throw new Error(result?.error || '后台未响应，请重新打开扩展');
  return result.data;
}

import { emptyState, type State } from './types';
import { normalizeSettings } from './providers';
let queue: Promise<unknown> = Promise.resolve();
export const storageReady = () =>
  chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
export async function readState(): Promise<State> {
  await storageReady();
  const { state } = await chrome.storage.local.get('state');
  if (state && state.schemaVersion !== 1) throw new Error('存储版本不受支持，请勿覆盖现有数据');
  const result = state || emptyState();
  result.settings = normalizeSettings(result.settings);
  result.customTools ??= [];
  return result;
}
export function transact<T>(fn: (state: State) => Promise<T> | T): Promise<T> {
  const op = queue.then(async () => {
    const s = await readState();
    const result = await fn(s);
    await chrome.storage.local.set({ state: s });
    return result;
  });
  queue = op.catch(() => {});
  return op;
}

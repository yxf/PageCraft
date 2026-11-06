// Chrome 135+ API, not yet present in the pinned @types/chrome baseline.
declare namespace chrome.userScripts {
  interface WorldProperties {
    worldId?: string;
  }
  function execute(injection: {
    target: { tabId: number; frameIds?: number[]; documentIds?: string[] };
    world?: 'USER_SCRIPT' | 'MAIN';
    worldId?: string;
    js: { code: string }[];
    injectImmediately?: boolean;
  }): Promise<{ frameId: number; documentId: string; result?: unknown; error?: string }[]>;
}

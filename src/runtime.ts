import { activeVersion, type Craft } from './types';
// Emitted into USER_SCRIPT, never evaluated inside the privileged extension.
export function installRuntime(plans: any[]) {
  const root = globalThis as any;
  if (root.__pagecraftRuntime) {
    root.__pagecraftRuntime.sync(plans);
    return 'synced';
  }
  let current = plans;
  let suspended = false;
  const live = new Map<string, any>();
  const blocked = new Set<string>();
  const report = (p: any, status: string) => {
    try {
      chrome.runtime
        .sendMessage({ type: 'RUN', craftId: p.id, versionId: p.versionId, status })
        .catch(() => {});
    } catch {}
  };
  const matches = (pattern: string) => {
    const m = /^(https?|\*):\/\/(\*|\*\.[a-z0-9.-]+|[a-z0-9.-]+)(\/.*)$/i.exec(pattern);
    if (!m) return false;
    const u = new URL(location.href),
      h = m[2].toLowerCase();
    return (
      (m[1] === '*' || m[1] + ':' === u.protocol) &&
      (h === '*' ||
        h === u.hostname ||
        (h.startsWith('*.') && (u.hostname === h.slice(2) || u.hostname.endsWith(h.slice(1))))) &&
      new RegExp(
        '^' +
          m[3]
            .split('*')
            .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
            .join('.*') +
          '$',
      ).test(u.pathname)
    );
  };
  const stop = (id: string) => {
    const item = live.get(id);
    if (!item) return;
    item.disposed = true;
    let failed = false;
    for (const fn of item.cleanup.reverse()) {
      try {
        fn();
      } catch {
        failed = true;
      }
    }
    live.delete(id);
    if (failed) {
      blocked.add(id);
      report(item.plan, 'refresh');
    }
  };
  const tick = () => {
    const desired = suspended
      ? []
      : current.filter((p) => p.matches.some(matches) && !p.excludeMatches.some(matches));
    for (const [id, item] of live) {
      const next = desired.find((p) => p.id === id);
      if (!next || next.versionId !== item.plan.versionId || item.url !== location.href) stop(id);
    }
    for (const p of desired) {
      if (live.has(p.id) || blocked.has(p.id)) continue;
      const item = { plan: p, url: location.href, cleanup: [] as (() => void)[], disposed: false };
      live.set(p.id, item);
      const guarded =
        (fn: Function) =>
        (...args: any[]) => {
          if (item.disposed) return;
          try {
            const result = fn(...args);
            if (result && typeof result.catch === 'function')
              return result.catch(() => report(p, 'error'));
            return result;
          } catch {
            report(p, 'error');
          }
        };
      const ctx = {
        onCleanup(fn: () => void) {
          item.cleanup.push(fn);
        },
        append(parent: Element, node: Element) {
          node.setAttribute('data-pagecraft', p.id);
          parent.append(node);
          item.cleanup.push(() => node.remove());
          return node;
        },
        style(css: string) {
          const s = document.createElement('style');
          s.textContent = css;
          document.documentElement.append(s);
          item.cleanup.push(() => s.remove());
        },
        on(target: EventTarget, event: string, fn: EventListener) {
          const handler = guarded(fn);
          target.addEventListener(event, handler);
          item.cleanup.push(() => target.removeEventListener(event, handler));
        },
        interval(fn: () => void, ms: number) {
          const id = setInterval(guarded(fn), Math.max(250, ms));
          item.cleanup.push(() => clearInterval(id));
        },
        timeout(fn: () => void, ms: number) {
          const id = setTimeout(guarded(fn), Math.max(0, ms));
          item.cleanup.push(() => clearTimeout(id));
        },
        observe(target: Node, fn: () => void) {
          let pending = false;
          let timer: ReturnType<typeof setTimeout>;
          const handler = guarded(fn);
          const observer = new MutationObserver(() => {
            if (pending) return;
            pending = true;
            timer = setTimeout(() => {
              pending = false;
              handler();
            }, 150);
          });
          observer.observe(target, { childList: true, subtree: true });
          item.cleanup.push(() => {
            observer.disconnect();
            clearTimeout(timer);
          });
        },
        attribute(el: Element, name: string, value: string) {
          const old = el.getAttribute(name);
          el.setAttribute(name, value);
          item.cleanup.push(() =>
            old === null ? el.removeAttribute(name) : el.setAttribute(name, old),
          );
        },
        text(el: Element, value: string) {
          const old = el.textContent;
          el.textContent = value;
          item.cleanup.push(() => {
            el.textContent = old;
          });
        },
        copy(text: string) {
          return navigator.clipboard.writeText(text);
        },
        download(filename: string, text: string) {
          const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = filename.replace(/[\\/]/g, '_');
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        },
      };
      try {
        if (p.css) ctx.style(p.css);
        const cleanup = p.init(ctx);
        if (typeof cleanup === 'function') item.cleanup.push(cleanup);
        report(p, 'ok');
      } catch {
        stop(p.id);
        blocked.add(p.id);
        report(p, 'error');
      }
    }
  };
  const timer = setInterval(tick, 750);
  // A short lease stops already-injected scripts after host access is revoked.
  const lease = setInterval(async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'LEASE' });
      if (!response?.allowed) throw new Error();
      const allowed = new Set(response.allowed.map((x: any) => x.id + ':' + x.versionId));
      current = current.filter((p) => allowed.has(p.id + ':' + p.versionId));
      suspended = false;
    } catch {
      suspended = true;
    }
    tick();
  }, 5000);
  root.__pagecraftRuntime = {
    sync(next: any[]) {
      current = next;
      suspended = false;
      tick();
    },
    dispose() {
      clearInterval(timer);
      clearInterval(lease);
      for (const id of live.keys()) stop(id);
      delete root.__pagecraftRuntime;
    },
  };
  tick();
  return 'synced';
}
export function runtimeCode(crafts: Craft[]) {
  const plans = crafts
    .filter((c) => c.enabled && !c.deletedUntil)
    .map((c) => {
      const v = activeVersion(c);
      return `{...${JSON.stringify({ id: c.id, versionId: v.id, matches: c.matches, excludeMatches: c.excludeMatches, css: v.css })},init:function(ctx){"use strict";\n${v.script}\n}}`;
    });
  return `(${installRuntime.toString()})([${plans.join(',')}]);`;
}

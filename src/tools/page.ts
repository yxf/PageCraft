// Runs only in the target document's isolated world; the watchdog restores it if the worker stops.
export function capturePage(
  command: 'prepare' | 'move' | 'restore',
  id: string,
  full: boolean,
  x = 0,
  y = 0,
) {
  const root = globalThis as any;
  const key = '__pagecraftCapture';
  if (command === 'restore') {
    if (root[key]?.id === id) root[key].restore();
    return null;
  }
  if (command === 'prepare') {
    root[key]?.restore();
    const originalX = scrollX,
      originalY = scrollY;
    const style = document.createElement('style');
    style.textContent =
      '* { scroll-behavior: auto !important; scroll-snap-type: none !important; animation-play-state: paused !important; transition: none !important; } html { scrollbar-width: none !important; }';
    document.documentElement.append(style);
    const hidden = new Map<HTMLElement, [string, string]>();
    const hide = (el: HTMLElement) => {
      if (!hidden.has(el))
        hidden.set(el, [
          el.style.getPropertyValue('visibility'),
          el.style.getPropertyPriority('visibility'),
        ]);
      el.style.setProperty('visibility', 'hidden', 'important');
    };
    for (const el of document.querySelectorAll<HTMLElement>('[data-pagecraft="picker"]')) hide(el);
    const state = {
      id,
      hidden,
      hide,
      timer: 0,
      restore() {
        clearTimeout(state.timer);
        for (const [el, [value, priority]] of hidden) {
          if (value) el.style.setProperty('visibility', value, priority);
          else el.style.removeProperty('visibility');
        }
        scrollTo({ left: originalX, top: originalY, behavior: 'instant' });
        style.remove();
        delete root[key];
      },
    };
    root[key] = state;
    if (full) scrollTo({ left: 0, top: 0, behavior: 'instant' });
  }
  const state = root[key];
  if (!state || state.id !== id) throw new Error('截图页面已变化');
  clearTimeout(state.timer);
  state.timer = setTimeout(state.restore, 15000);
  if (command === 'move') {
    if (full && (x || y)) {
      for (const el of document.querySelectorAll<HTMLElement>('body *')) {
        const position = getComputedStyle(el).position;
        if (position === 'fixed' || position === 'sticky') state.hide(el);
      }
    }
    scrollTo({ left: x, top: y, behavior: 'instant' });
  }
  const el = document.scrollingElement || document.documentElement;
  return {
    x: scrollX,
    y: scrollY,
    width: el.scrollWidth,
    height: el.scrollHeight,
    viewportWidth: innerWidth,
    viewportHeight: innerHeight,
    url: location.href,
  };
}

export function extractPageText() {
  const root = document.querySelector('main, [role="main"], article') || document.body;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const chunks: string[] = [];
  let length = 0,
    visited = 0,
    truncated = false;
  while (walker.nextNode()) {
    if (++visited > 50000) {
      truncated = true;
      break;
    }
    const parent = walker.currentNode.parentElement;
    if (
      !parent ||
      parent.closest(
        'script,style,noscript,input,textarea,select,[contenteditable],[data-pagecraft]',
      )
    )
      continue;
    if (!parent.getClientRects().length || getComputedStyle(parent).visibility !== 'visible')
      continue;
    const text = walker.currentNode.textContent?.trim();
    if (!text) continue;
    if (length + text.length > 200000) {
      truncated = true;
      break;
    }
    chunks.push(text);
    length += text.length;
  }
  return { text: chunks.join('\n'), title: document.title, truncated };
}

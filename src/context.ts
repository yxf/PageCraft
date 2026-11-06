// This function is serialized by Chrome; keep all dependencies inside it.
export function collectContext(
  select = false,
): Promise<{ url: string; title: string; summary: string; truncated: boolean }> {
  return new Promise((resolve, reject) => {
    const capture = (root: Element) => {
      const out: string[] = [];
      let size = 0,
        truncated = false,
        visited = 0;
      const walk = (el: Element, depth: number) => {
        if (size >= 20000 || visited++ >= 3000 || depth > 12) {
          truncated = true;
          return;
        }
        if (
          el.closest(
            'input,textarea,select,[contenteditable],script,style,noscript,[hidden],[aria-hidden="true"],[data-pagecraft]',
          )
        )
          return;
        if (
          el instanceof HTMLElement &&
          (el.hidden ||
            getComputedStyle(el).display === 'none' ||
            getComputedStyle(el).visibility === 'hidden')
        )
          return;
        const tag = el.tagName.toLowerCase();
        const text = Array.from(el.childNodes)
          .filter((n) => n.nodeType === Node.TEXT_NODE)
          .map((n) => n.textContent)
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 180);
        const id = el.id ? `#${el.id.slice(0, 80)}` : '';
        const classes = Array.from(el.classList)
          .slice(0, 4)
          .map((c) => '.' + c.slice(0, 60))
          .join('');
        const label = (el.getAttribute('aria-label') || '').slice(0, 100);
        const line = `${' '.repeat(depth)}${tag}${id}${classes}${label ? ' label=' + label : ''}${text ? ' ' + text : ''}\n`;
        out.push(line.slice(0, 20000 - size));
        if (line.length > 20000 - size) truncated = true;
        size += line.length;
        for (const child of el.children) {
          if (size >= 20000) {
            truncated = true;
            break;
          }
          walk(child, depth + 1);
        }
      };
      walk(root, 0);
      resolve({
        url: location.origin + location.pathname,
        title: document.title.slice(0, 150),
        summary: out.join(''),
        truncated,
      });
    };
    if (!select) {
      capture(document.body);
      return;
    }
    const overlay = document.createElement('div');
    overlay.setAttribute('data-pagecraft', 'picker');
    overlay.style.cssText =
      'position:fixed;pointer-events:none;z-index:2147483647;border:2px solid #187358;background:#18735818;';
    document.documentElement.append(overlay);
    let last: Element | null = null;
    const move = (e: MouseEvent) => {
      last = e.target as Element;
      const r = last.getBoundingClientRect();
      Object.assign(overlay.style, {
        left: r.left + 'px',
        top: r.top + 'px',
        width: r.width + 'px',
        height: r.height + 'px',
      });
    };
    const cleanup = () => {
      clearTimeout(timer);
      overlay.remove();
      document.removeEventListener('mousemove', move, true);
      document.removeEventListener('click', click, true);
      document.removeEventListener('keydown', key, true);
    };
    const click = (e: MouseEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      cleanup();
      capture((e.target as Element) || last || document.body);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        cleanup();
        reject(new Error('已取消元素选择'));
      }
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('元素选择超时'));
    }, 30000);
    document.addEventListener('mousemove', move, true);
    document.addEventListener('click', click, true);
    document.addEventListener('keydown', key, true);
  });
}

export function parsePattern(pattern: string) {
  const m = /^(https?|\*):\/\/(\*|\*\.[a-z0-9.-]+|[a-z0-9.-]+)(\/[^?#\s]*)$/i.exec(pattern);
  if (!m)
    throw new Error(`匹配规则无效：${pattern}。例如 https://example.com/*（不含端口或查询参数）`);
  return { scheme: m[1].toLowerCase(), host: m[2].toLowerCase(), path: m[3] };
}
export function matchesPattern(pattern: string, url: string): boolean {
  try {
    const p = parsePattern(pattern),
      u = new URL(url);
    if (!['http:', 'https:'].includes(u.protocol)) return false;
    const host = u.hostname.toLowerCase();
    return (
      (p.scheme === '*' || u.protocol === p.scheme + ':') &&
      (p.host === '*' ||
        p.host === host ||
        (p.host.startsWith('*.') &&
          (host === p.host.slice(2) || host.endsWith(p.host.slice(1))))) &&
      new RegExp(
        '^' +
          p.path
            .split('*')
            .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
            .join('.*') +
          '$',
      ).test(u.pathname)
    );
  } catch {
    return false;
  }
}
export function matchesRules(matches: string[], exclude: string[], url: string) {
  return (
    matches.some((p) => matchesPattern(p, url)) && !exclude.some((p) => matchesPattern(p, url))
  );
}
export function originsFor(patterns: string[]) {
  return [
    ...new Set(
      patterns.map((p) => {
        const x = parsePattern(p);
        return `${x.scheme}://${x.host}/*`;
      }),
    ),
  ];
}
export function lines(text: string) {
  return [
    ...new Set(
      text
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
}
export function validateRules(matches: string[], exclude: string[]) {
  if (!matches.length) throw new Error('请至少填写一条匹配规则');
  if (matches.length + exclude.length > 30) throw new Error('最多 30 条规则');
  [...matches, ...exclude].forEach(parsePattern);
}
export function pagePattern(url: string, path = false) {
  const u = new URL(url);
  return `${u.protocol}//${u.hostname}${path ? u.pathname : '/*'}`;
}
export function supported(url: string) {
  try {
    const u = new URL(url);
    return (
      /^https?:$/.test(u.protocol) &&
      !['chromewebstore.google.com', 'chrome.google.com', 'microsoftedge.microsoft.com'].includes(
        u.hostname,
      ) &&
      !u.pathname.toLowerCase().endsWith('.pdf')
    );
  } catch {
    return false;
  }
}

export const CAPTURE_PERMISSION = '截图授权不足：';
export function isProtectedStore(url: string) {
  try {
    const u = new URL(url);
    return (
      u.hostname === 'chromewebstore.google.com' ||
      (u.hostname === 'chrome.google.com' && /^\/webstore(?:\/|$)/.test(u.pathname))
    );
  } catch {
    return false;
  }
}
export function captureError(error: unknown, url = '') {
  const message = error instanceof Error ? error.message : String(error);
  if (isProtectedStore(url)) {
    return new Error(
      `Chrome 扩展商店是受保护页面，所有网站授权不能替代临时 activeTab 授权。请保持该标签页激活，在其工具栏点击 PageCraft 图标后重试“可视区域截图”；若 Chrome 仍拒绝，请使用系统截图。原始错误：${message}`,
    );
  }
  if (/activeTab|<all_urls>|permission|not been invoked/i.test(message)) {
    return new Error(
      `${CAPTURE_PERMISSION}请点击“授权截图”，允许 Chrome 请求的网站访问权限后重试。`,
    );
  }
  return new Error(`截图失败：${message}`);
}

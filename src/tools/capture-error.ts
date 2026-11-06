export const CAPTURE_PERMISSION = '截图授权不足：';
export function captureError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/activeTab|<all_urls>|permission|not been invoked/i.test(message)) {
    return new Error(
      `${CAPTURE_PERMISSION}请点击“授权截图”，允许 Chrome 请求的网站访问权限后重试。`,
    );
  }
  return new Error(`截图失败：${message}`);
}

export const toolDefinitions = [
  { id: 'screenshot-visible', name: '可视区域截图', kind: 'image' },
  { id: 'screenshot-full', name: '整页截图', kind: 'image' },
] as const;
// Text extraction remains available to custom tools, without a standalone list entry.
export type ToolId = (typeof toolDefinitions)[number]['id'] | 'extract-text';
export interface ToolStatus {
  id: string;
  tool: ToolId;
  tabId: number;
  stage: string;
  current: number;
  total: number;
  running: boolean;
  error?: string;
}
export interface ToolResult {
  kind: 'image' | 'text' | 'table' | 'file';
  columns?: string[];
  rows?: string[][];
  mime?: string;
  autoDownload?: boolean;
  filename: string;
  data: string;
  width?: number;
  height?: number;
  warning?: string;
}
export function capturePositions(size: number, viewport: number) {
  if (!Number.isFinite(size) || !Number.isFinite(viewport) || size < 1 || viewport < 1)
    throw new Error('页面尺寸无效');
  const result = [0];
  while (result[result.length - 1] + viewport < size)
    result.push(Math.min(result[result.length - 1] + viewport, size - viewport));
  return result;
}
export function checkCanvasSize(width: number, height: number) {
  if (width > 32760 || height > 32760 || width * height > 32000000)
    throw new Error('页面过大，无法合并为一张图片，请改用可视区域截图');
}

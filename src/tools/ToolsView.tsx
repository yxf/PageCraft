import { t, getLocale } from '../i18n';
import { useEffect, useState } from 'react';
import { Camera, ScanLine, Download, Copy, Square, LoaderCircle, X } from 'lucide-react';
import { isExtension, send } from '../client';
import { CAPTURE_PERMISSION, isProtectedStore } from './capture-error';
import { CustomTools } from './CustomTools';
import { toolDefinitions, type ToolId, type ToolStatus, type ToolResult } from './registry';

export function ToolsView({ tab }: { tab: { id?: number; url?: string; title?: string } }) {
  const [status, setStatus] = useState<ToolStatus>();
  const [result, setResult] = useState<ToolResult>();
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [permissionNotice, setPermissionNotice] = useState('');
  const [customBusy, setCustomBusy] = useState(false);
  useEffect(() => {
    if (!isExtension) return;
    let alive = true;
    const refresh = () =>
      send('TOOL_STATE')
        .then((s) => {
          if (alive) setStatus(s);
        })
        .catch(() => {});
    void refresh();
    const timer = setInterval(refresh, 500);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  const busy = pending || !!status?.running || customBusy;
  const run = async (tool: ToolId) => {
    setError('');
    setPermissionNotice('');
    setCopied(false);
    setPending(true);
    try {
      if (!isExtension) throw new Error(t('请在 Chrome 中加载扩展后运行工具'));
      if (!tab.id || !tab.url || !/^https?:\/\//.test(tab.url))
        throw new Error(t('请切换到普通网页'));
      const origin = new URL(tab.url).origin + '/*';
      if (
        !isProtectedStore(tab.url) &&
        !(await chrome.permissions.contains({ origins: [origin] })) &&
        !(await chrome.permissions.request({ origins: [origin] }))
      )
        throw new Error(t('未授予当前网站权限'));
      setResult(undefined);
      const id = crypto.randomUUID();
      setStatus({
        id,
        tool,
        tabId: tab.id,
        stage: t('准备中'),
        current: 0,
        total: 1,
        running: true,
      });
      setResult(await send('TOOL_RUN', { id, tool, tabId: tab.id }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
      if (isExtension) setStatus(await send('TOOL_STATE').catch(() => undefined));
    }
  };
  const download = () => {
    if (!result) return;
    const url =
      result.kind === 'image'
        ? result.data
        : URL.createObjectURL(
            new Blob([result.data], { type: result.mime || 'text/plain;charset=utf-8' }),
          );
    const a = document.createElement('a');
    a.href = url;
    a.download = result.filename;
    a.click();
    if (result.kind !== 'image') setTimeout(() => URL.revokeObjectURL(url), 10000);
  };
  useEffect(() => {
    if (result?.autoDownload) {
      download();
      setResult({ ...result, autoDownload: false });
    }
  }, [result]);
  return (
    <>
      <section className="page-heading">
        <div>
          <h1>{t('通用工具')}</h1>
        </div>
      </section>
      <section className="tool-list" aria-label={t('通用工具')}>
        {toolDefinitions.map((tool) => {
          const Icon = tool.id === 'screenshot-visible' ? Camera : ScanLine;
          return (
            <button key={tool.id} onClick={() => void run(tool.id)} disabled={busy}>
              <Icon size={20} />
              <span>{t(tool.name)}</span>
            </button>
          );
        })}
      </section>
      <CustomTools
        tab={tab}
        disabled={pending || !!status?.running}
        onBusy={setCustomBusy}
        onResult={(value) => {
          setError('');
          setCopied(false);
          setResult(value);
        }}
        onFailure={(message) => {
          if (message.startsWith(CAPTURE_PERMISSION)) setError(message);
        }}
      />
      {(pending || status?.running) && (
        <div className="tool-progress" role="status">
          <LoaderCircle size={16} className="spin" />
          <span>{status?.stage ? t(status.stage) : t('准备中')}</span>
          <button
            className="tool-stop"
            title={t('取消工具')}
            aria-label={t('取消工具')}
            onClick={() => {
              if (status?.id)
                void send('TOOL_CANCEL', { id: status.id }).catch((e) => setError(e.message));
            }}
          >
            <Square size={14} fill="currentColor" strokeWidth={0} />
          </button>
          <progress max={status?.total || 1} value={status?.current || 0} />
        </div>
      )}
      {error && (
        <div className="message error" role="alert">
          {t(error)}
        </div>
      )}
      {error.startsWith(CAPTURE_PERMISSION) && (
        <section className="settings-section">
          <p className="settings-note">
            {t(
              '备用截图授权需要访问所有网站。仅在运行工具时截图；你可在 Chrome 扩展设置中撤销此权限。',
            )}
          </p>
          <button
            disabled={busy}
            onClick={async () => {
              try {
                const granted = await chrome.permissions.request({ origins: ['<all_urls>'] });
                if (!granted) {
                  setError(CAPTURE_PERMISSION + t('你取消了授权，可再次点击“授权截图”。'));
                  return;
                }
                setError('');
                setPermissionNotice(t('截图权限已授予，请重新点击截图工具。'));
              } catch (e) {
                setError(
                  CAPTURE_PERMISSION +
                    (e as Error).message +
                    t('。请确认已在 chrome://extensions 重新加载扩展。'),
                );
              }
            }}
          >
            {t('授权截图')}
          </button>
        </section>
      )}
      {permissionNotice && (
        <div className="message success" role="status">
          {permissionNotice}
        </div>
      )}
      {result && (
        <section className="tool-result">
          <div className="section-title">
            <h2>
              {result.kind === 'image'
                ? t('截图预览')
                : result.kind === 'table'
                  ? t('表格结果')
                  : result.kind === 'file'
                    ? t('文件结果')
                    : t('页面文本')}
            </h2>
            <div className="button-row">
              <button onClick={download} title={t('下载结果')} aria-label={t('下载结果')}>
                <Download size={17} />
              </button>
              {result.kind !== 'image' && (
                <button
                  title={copied ? t('已复制') : t('复制文本')}
                  aria-label={t('复制文本')}
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(result.data)
                      .then(() => setCopied(true))
                      .catch(() => setError(t('复制失败，请下载文本')))
                  }
                >
                  <Copy size={17} />
                </button>
              )}
              <button
                title={t('关闭结果')}
                aria-label={t('关闭结果')}
                onClick={() => setResult(undefined)}
              >
                <X size={17} />
              </button>
            </div>
          </div>
          {result.kind === 'image' ? (
            <>
              <p className="muted">
                {result.width} × {result.height} px
              </p>
              <img className="tool-image" src={result.data} alt={t('当前网页截图')} />
            </>
          ) : result.kind === 'table' ? (
            <div className="tool-table">
              <table>
                <thead>
                  <tr>
                    {result.columns?.map((column, i) => (
                      <th key={i}>{column}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows?.slice(0, 200).map((row, i) => (
                    <tr key={i}>
                      {row.map((cell, j) => (
                        <td key={j}>{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="muted">
                {t('共')}
                {result.rows?.length || 0} {t('行')}
                {(result.rows?.length || 0) > 200 ? t(' · 预览前 200 行') : ''}
              </p>
            </div>
          ) : (
            <textarea
              className="tool-text"
              aria-label={t('提取的页面文本')}
              readOnly
              value={result.data}
            />
          )}
          {copied && <p role="status">{t('已复制')}</p>}
          {result.warning && <p className="settings-note">{result.warning}</p>}
        </section>
      )}
    </>
  );
}

import {
  t,
  getLocale,
  getPreference,
  subscribeLanguage,
  initializeLanguage,
  setLanguage,
  type LanguagePreference,
} from './i18n';
import React, { useCallback, useEffect, useState } from 'react';
import { CurrentPage } from './CurrentPage';
import { createRoot } from 'react-dom/client';
import {
  ArrowLeft,
  Check,
  Code2,
  Globe,
  Layers,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Settings2,
  Trash2,
  Unplug,
  X,
  ExternalLink,
  PanelRightOpen,
  PanelsTopLeft,
  KeyRound,
  Wrench,
} from 'lucide-react';
import { activeVersion, type Craft, type State } from './types';
import { lines, matchesRules, originsFor, supported, validateRules } from './rules';
import { isExtension, send } from './client';
import { providers, publicSettings } from './providers';
import type { Provider } from './types';
import './style.css';
import { ToolsView } from './tools/ToolsView';
const isPopup = new URLSearchParams(location.search).get('surface') === 'popup';
const isSidePanel = !location.pathname.includes('options') && !isPopup;
document.documentElement.classList.toggle('popup-surface', isPopup);
type Snapshot = Omit<State, 'settings'> & {
  available: boolean;
  grants: Record<string, boolean>;
  settings: ReturnType<typeof publicSettings>;
};
const time = (n: number) =>
  new Date(n).toLocaleString(getLocale(), {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
function IconButton({
  title,
  onClick,
  children,
  disabled = false,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="icon-button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
function App() {
  React.useSyncExternalStore(subscribeLanguage, () => `${getPreference()}:${getLocale()}`);
  const [state, setState] = useState<Snapshot>(),
    [view, setView] = useState<'create' | 'library' | 'settings' | 'tools'>(
      location.pathname.includes('options') ? 'library' : 'create',
    );
  const [tab, setTab] = useState<{ id?: number; windowId?: number; url?: string; title?: string }>(
    {},
  );
  const [openingPanel, setOpeningPanel] = useState(false);
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(''),
    [error, setError] = useState('');
  const [selected, setSelected] = useState<string>(),
    [editing, setEditing] = useState<Craft>(),
    [query, setQuery] = useState(''),
    [site, setSite] = useState('all'),
    [undo, setUndo] = useState<string>();
  const [key, setKey] = useState(''),
    [provider, setProvider] = useState<Provider>('openai'),
    [model, setModel] = useState(''),
    [consent, setConsent] = useState(false),
    [settingsLoaded, setSettingsLoaded] = useState(false);
  const [clearConfirm, setClearConfirm] = useState(false);
  const refresh = useCallback(async () => {
    try {
      setState(await send('STATE'));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const id = setInterval(refresh, 1500);
    return () => clearInterval(id);
  }, [refresh]);
  useEffect(() => {
    if (state && !settingsLoaded) {
      setProvider(state.settings.provider);
      setModel(state.settings.model);
      setConsent(state.settings.consent);
      setSettingsLoaded(true);
    }
  }, [state, settingsLoaded]);
  useEffect(() => {
    if (!isExtension) return;
    let alive = true;
    let sequence = 0;
    const update = async () => {
      const request = ++sequence;
      const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      let target = t;
      if (t?.url?.startsWith(chrome.runtime.getURL(''))) {
        const pages = (await chrome.tabs.query({ lastFocusedWindow: true })).filter(
          (p) => p.url && supported(p.url),
        );
        pages.sort((a, b) => ((b as any).lastAccessed || 0) - ((a as any).lastAccessed || 0));
        target = pages[0];
      }
      if (alive && sequence === request) setTab(target || {});
    };
    void update();
    chrome.tabs.onActivated.addListener(update);
    chrome.tabs.onUpdated.addListener(update);
    return () => {
      alive = false;
      chrome.tabs.onActivated.removeListener(update);
      chrome.tabs.onUpdated.removeListener(update);
    };
  }, []);
  const run = async (fn: () => Promise<any>) => {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const result = await fn();
      if (typeof result === 'string') setNotice(result);
      await refresh();
      return result;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const grant = async (matches: string[]) => {
    validateRules(matches, []);
    if (!isExtension) throw new Error(t('请先加载 Chrome 扩展'));
    const granted = await chrome.permissions.request({ origins: originsFor(matches) });
    if (!granted) throw new Error(t('未授予网站权限'));
  };
  const live = state?.crafts.filter((c) => !c.deletedUntil) || [];
  const revise = (c: Craft) => {
    setSelected(c.id);
    setView('create');
  };
  const toggle = (c: Craft) =>
    void run(async () => {
      if (!c.enabled) await grant(c.matches);
      return send('TOGGLE', { id: c.id, enabled: !c.enabled });
    });
  const remove = (c: Craft) =>
    void run(async () => {
      const result = await send('DELETE', { id: c.id });
      setUndo(c.id);
      setTimeout(() => setUndo(undefined), 10000);
      setEditing(undefined);
      return result;
    });
  function craftRow(c: Craft) {
    const record = state?.runs.find(
      (r) =>
        r.craftId === c.id &&
        r.versionId === c.activeVersionId &&
        (view === 'library' || r.tabId === tab.id),
    );
    return (
      <article className="craft-row" key={c.id}>
        <div className="craft-symbol">
          <Code2 size={19} />
        </div>
        <button className="craft-main" onClick={() => setEditing(c)}>
          <strong>{c.name}</strong>
          <span>{c.description || c.matches[0]}</span>
          <small className={record?.status === 'error' ? 'danger' : ''}>
            {!state?.grants[c.id]
              ? t('缺少站点权限')
              : !c.enabled
                ? t('已停用')
                : record?.status === 'ok'
                  ? t('执行无异常 · 待验证')
                  : record?.status === 'error'
                    ? t('运行失败 · 可修改或重新生成')
                    : record?.status === 'refresh'
                      ? t('请刷新恢复页面')
                      : t('等待匹配页面')}{' '}
            · {time(c.updatedAt)}
          </small>
        </button>
        <button
          role="switch"
          aria-label={t('{0} 启用状态', c.name)}
          aria-checked={c.enabled}
          className={'toggle ' + (c.enabled ? 'on' : '')}
          onClick={() => toggle(c)}
          disabled={busy}
        >
          <span />
        </button>
      </article>
    );
  }
  return (
    <div
      className={
        'app ' +
        (location.pathname.includes('options') ? 'wide ' : '') +
        (view === 'create' && !editing ? 'current-view' : '')
      }
    >
      <header className="topbar">
        <div className="brand-actions">
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setView('create');
            }}
            className="brand"
          >
            <img src="/icons/icon-128.png" alt="" />
            <span>
              PageCraft<small>{t('页匠')}</small>
            </span>
          </a>
        </div>
        <div className="header-actions">
          <span className="version">LOCAL · 0.1</span>
          {isSidePanel && (
            <IconButton
              title={t('切换到弹出框')}
              disabled={!isExtension || tab.windowId === undefined || openingPanel}
              onClick={() => {
                setOpeningPanel(true);
                void send('SURFACE_MODE', { mode: 'popup' })
                  .then(() => chrome.action.openPopup({ windowId: tab.windowId! }))
                  .then(async () => {
                    const sidePanel = chrome.sidePanel as typeof chrome.sidePanel & {
                      close?: (options: { windowId: number }) => Promise<void>;
                    };
                    if (sidePanel.close) await sidePanel.close({ windowId: tab.windowId! });
                    else window.close();
                  })
                  .catch((e) => {
                    setError(
                      t(
                        '已尝试切换到弹出框，请点击工具栏图标重试；若侧边栏仍显示，可手动关闭。{0}',
                        e.message,
                      ),
                    );
                  })
                  .finally(() => setOpeningPanel(false));
              }}
            >
              <PanelsTopLeft size={17} />
            </IconButton>
          )}
          {isPopup && (
            <IconButton
              title={t('在侧边栏打开')}
              disabled={!isExtension || tab.windowId === undefined || openingPanel}
              onClick={() => {
                setOpeningPanel(true);
                // Queue persistence before opening can dismiss the popup; don't await before open.
                const remember = send('SURFACE_MODE', { mode: 'sidepanel' });
                void Promise.all([remember, chrome.sidePanel.open({ windowId: tab.windowId! })])
                  .then(() => window.close())
                  .catch(async (e) => {
                    await remember.catch(() => {});
                    await send('SURFACE_MODE', { mode: 'popup' }).catch(() => {});
                    setError(t('无法打开侧边栏：{0}', e.message));
                    setOpeningPanel(false);
                  });
              }}
            >
              <PanelRightOpen size={17} />
            </IconButton>
          )}
          <IconButton
            title={t('打开管理页')}
            onClick={() =>
              isExtension ? void chrome.runtime.openOptionsPage() : setView('library')
            }
          >
            <ExternalLink size={17} />
          </IconButton>
        </div>
      </header>
      <nav className="tabs" aria-label={t('主要导航')}>
        {(
          [
            ['create', t('当前页面'), Globe],
            ['library', t('我的改造'), Layers],
            ['tools', t('工具'), Wrench],
            ['settings', t('设置'), Settings2],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            className={view === id ? 'active' : ''}
            onClick={() => {
              setView(id);
              setEditing(undefined);
            }}
          >
            <Icon size={16} />
            {label}
            {id === 'library' && <span className="count">{live.length}</span>}
          </button>
        ))}
      </nav>
      <main>
        <div hidden={view !== 'tools'}>
          <ToolsView tab={tab} />
        </div>
        {!isExtension && (
          <div className="preview-note">
            <Unplug size={15} />
            {t('界面预览 · 尚未连接浏览器扩展')}
          </div>
        )}
        {error && (
          <div className="message error" role="alert">
            <span>{t(error)}</span>
            <IconButton title={t('关闭错误')} onClick={() => setError('')}>
              <X size={15} />
            </IconButton>
          </div>
        )}
        {notice && (
          <div className="message success" role="status">
            <span>{t(notice)}</span>
            <IconButton title={t('关闭通知')} onClick={() => setNotice('')}>
              <X size={15} />
            </IconButton>
          </div>
        )}
        {undo && (
          <div className="message">
            <span>{t('改造已删除')}</span>
            <button
              onClick={() =>
                void run(async () => {
                  const result = await send('UNDO', { id: undo });
                  setUndo(undefined);
                  return result;
                })
              }
            >
              {t('撤销')}
            </button>
          </div>
        )}
        {view === 'create' && !editing && state && (
          <CurrentPage
            key={`${tab.id}:${tab.url && supported(tab.url) ? new URL(tab.url).origin : 'no-page'}`}
            state={state}
            tab={tab}
            initialTarget={selected}
            onTargetConsumed={() => setSelected(undefined)}
            onEdit={setEditing}
            refresh={refresh}
          />
        )}
        {view === 'library' && !editing && (
          <>
            <section className="page-heading">
              <div>
                <div className="eyebrow">{t('工作空间')}</div>
                <h1>{t('我的改造')}</h1>
                <p>
                  {live.filter((c) => c.enabled).length} {t('个启用 ·')}
                  {live.length} {t('个已保存')}
                </p>
              </div>
              <button
                className="primary"
                onClick={() => {
                  setSelected(undefined);
                  setView('create');
                }}
              >
                <Plus size={16} />
                {t('新建')}
              </button>
            </section>
            <div className="filters">
              <label className="search">
                <Search size={16} />
                <input
                  aria-label={t('搜索改造')}
                  placeholder={t('搜索改造')}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              <select
                aria-label={t('站点筛选')}
                value={site}
                onChange={(e) => setSite(e.target.value)}
              >
                <option value="all">{t('全部站点')}</option>
                {[...new Set(live.flatMap((c) => c.matches))].map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </div>
            {live
              .filter(
                (c) =>
                  (c.name + c.description).toLowerCase().includes(query.toLowerCase()) &&
                  (site === 'all' || c.matches.includes(site)),
              )
              .map(craftRow)}
            {!live.length && (
              <div className="empty large">
                <Layers size={36} />
                <h3>{t('你的网页，你的版本')}</h3>
                <p>{t('尚未保存任何改造')}</p>
                <button className="primary" onClick={() => setView('create')}>
                  <Plus size={16} />
                  {t('创建改造')}
                </button>
              </div>
            )}
          </>
        )}
        {editing && view !== 'settings' && (
          <Editor
            craft={editing}
            busy={busy}
            onClose={() => setEditing(undefined)}
            onRevise={() => {
              revise(editing);
              setEditing(undefined);
            }}
            onDelete={() => remove(editing)}
            onSave={(data, matches, exclude) =>
              void run(async () => {
                await grant(matches);
                const result = await send('SAVE', {
                  data,
                  matches,
                  excludeMatches: exclude,
                  craftId: editing.id,
                  expectedVersion: editing.activeVersionId,
                  expectedUpdatedAt: editing.updatedAt,
                });
                setEditing(undefined);
                return result.notice;
              })
            }
            onRollback={(versionId) =>
              void run(async () => {
                await grant(editing.matches);
                const result = await send('ROLLBACK', { id: editing.id, versionId });
                setEditing(undefined);
                return result;
              })
            }
          />
        )}
        {view === 'settings' && (
          <>
            <section className="page-heading">
              <div>
                <div className="eyebrow">{t('偏好设置')}</div>
                <h1>{t('设置')}</h1>
              </div>
              <Settings2 size={25} />
            </section>
            <section className="settings-form" aria-labelledby="general-settings-title">
              <h2 id="general-settings-title">{t('通用设置')}</h2>
              <label>
                {t('界面语言')}
                <select
                  aria-label={t('界面语言')}
                  value={getPreference()}
                  onChange={(e) =>
                    void setLanguage(e.target.value as LanguagePreference).catch(() =>
                      setError(t('语言设置保存失败')),
                    )
                  }
                >
                  <option value="auto">{t('跟随浏览器')}</option>
                  <option value="zh-CN">简体中文</option>
                  <option value="en">English</option>
                </select>
              </label>
            </section>
            <section className="settings-section settings-form" aria-labelledby="ai-settings-title">
              <h2 id="ai-settings-title">{t('AI 配置')}</h2>
              <p className="settings-note">
                {providers[provider]} {t('· 用户自带 API Key')}
              </p>
              <label>
                {t('AI 服务商')}
                <select
                  aria-label={t('AI 服务商')}
                  value={provider}
                  disabled={busy}
                  onChange={(e) => {
                    const next = e.target.value as Provider;
                    const profile = state?.settings.profiles[next];
                    setProvider(next);
                    setKey('');
                    setModel(profile?.model || '');
                    setConsent(profile?.consent || false);
                  }}
                >
                  {Object.entries(providers).map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                API Key
                <span className="field-status">
                  {state?.settings.profiles[provider].hasKey ? t('已保存') : t('未配置')}
                </span>
                <input
                  type="password"
                  autoComplete="off"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder={
                    state?.settings.profiles[provider].hasKey
                      ? t('留空保留现有 Key')
                      : t('填写当前服务商的 API Key')
                  }
                  aria-label="API Key"
                />
              </label>
              <label>
                {t('模型 ID')}
                <input
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder={t('填写支持结构化输出的模型 ID')}
                  aria-label={t('模型 ID')}
                />
              </label>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                />
                <span>
                  {t('允许将我的需求及必要的页面摘要发送到')}
                  {providers[provider]}
                  {t('。可见文本可能包含个人信息。')}
                </span>
              </label>
              <p className="settings-note">
                {t('Key 仅保存在本机扩展存储，不会传入网页。API 调用由你的')}
                {providers[provider]}
                {t('账户计费，本地保存不等同于加密保险库。')}
              </p>
              <div className="button-row">
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await send('SETTINGS', { provider, apiKey: key, model, consent });
                      setKey('');
                      return t('设置已保存');
                    })
                  }
                >
                  <Save size={16} />
                  {t('保存设置')}
                </button>
                <button
                  disabled={busy || !state?.settings.hasKey || provider !== state.settings.provider}
                  onClick={() => void run(() => send('TEST'))}
                >
                  <RefreshCw size={16} />
                  {t('测试已保存连接')}
                </button>
              </div>
              <p className="muted">{t('连接测试会产生少量 API 费用。')}</p>
            </section>
            <section className="settings-section">
              <h2>{t('脚本执行')}</h2>
              <p>{state?.available ? t('用户脚本 API 已就绪') : t('用户脚本尚未启用')}</p>
              <p className="settings-note">
                {t(
                  '开发模式：仅校验代码语法，不限制脚本能力。生成代码可读取页面数据、联网或改变页面行为，请仅在测试网页使用。关闭改造可能无法撤销全部副作用。',
                )}
              </p>
              <button
                onClick={() =>
                  isExtension &&
                  void chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` })
                }
              >
                <ExternalLink size={15} />
                {t('扩展权限')}
              </button>
            </section>
            <section className="settings-section">
              <h2>{t('本地数据')}</h2>
              <div className="button-row">
                <button
                  disabled={busy || !state?.settings.profiles[provider].hasKey}
                  onClick={() =>
                    void run(async () => {
                      await send('SETTINGS', { provider, clearKey: true, model, consent });
                      setKey('');
                      return t('API Key 已清除');
                    })
                  }
                >
                  <KeyRound size={15} />
                  {t('清除 Key')}
                </button>
                <button className="danger" onClick={() => setClearConfirm(true)}>
                  <Trash2 size={15} />
                  {t('清除全部数据')}
                </button>
              </div>
              {clearConfirm && (
                <div className="message error">
                  <span>{t('将删除全部改造、版本和 Key，无法撤销。')}</span>
                  <button
                    onClick={() =>
                      void run(async () => {
                        await send('CLEAR');
                        setClearConfirm(false);
                        setSettingsLoaded(false);
                        return t('本地数据已清除；请刷新已打开的网页');
                      })
                    }
                  >
                    {t('确认清除')}
                  </button>
                  <button onClick={() => setClearConfirm(false)}>{t('取消')}</button>
                </div>
              )}
            </section>
          </>
        )}
      </main>
      <footer>
        <span>
          <i />
          {t('本地工作空间')}
        </span>
        <span>{t('PageCraft / 页匠')}</span>
      </footer>
    </div>
  );
}
function Editor({
  craft,
  busy,
  onClose,
  onSave,
  onDelete,
  onRevise,
  onRollback,
}: {
  craft: Craft;
  busy: boolean;
  onClose: () => void;
  onSave: (data: any, matches: string[], exclude: string[]) => void;
  onDelete: () => void;
  onRevise: () => void;
  onRollback: (id: string) => void;
}) {
  const v = activeVersion(craft);
  const [name, setName] = useState(craft.name),
    [description, setDescription] = useState(craft.description),
    [script, setScript] = useState(v.script),
    [css, setCss] = useState(v.css),
    [matches, setMatches] = useState(craft.matches.join('\n')),
    [exclude, setExclude] = useState(craft.excludeMatches.join('\n')),
    [url, setUrl] = useState('');
  return (
    <section className="editor">
      <div className="section-title">
        <button className="quiet" onClick={onClose}>
          <ArrowLeft size={16} />
          {t('返回')}
        </button>
        <IconButton title={t('删除改造')} onClick={onDelete} disabled={busy}>
          <Trash2 size={16} />
        </IconButton>
      </div>
      <h1>{craft.name}</h1>
      <label>
        {t('名称')}
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
      </label>
      <label>
        {t('说明')}
        <textarea
          rows={4}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={1000}
        />
      </label>
      <label>
        JavaScript
        <textarea
          aria-label={t('JavaScript 源码')}
          className="code source"
          spellCheck={false}
          value={script}
          onChange={(e) => setScript(e.target.value)}
        />
      </label>
      <label>
        CSS
        <textarea
          aria-label={t('CSS 源码')}
          className="code"
          spellCheck={false}
          value={css}
          onChange={(e) => setCss(e.target.value)}
        />
      </label>
      <label>
        {t('匹配规则')}
        <textarea
          className="code compact"
          value={matches}
          onChange={(e) => setMatches(e.target.value)}
        />
      </label>
      <label>
        {t('排除规则')}
        <textarea
          className="code compact"
          value={exclude}
          onChange={(e) => setExclude(e.target.value)}
        />
      </label>
      <label>
        {t('测试 URL')}
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com/page"
        />
      </label>
      {url && <p>{matchesRules(lines(matches), lines(exclude), url) ? t('匹配') : t('不匹配')}</p>}
      <div className="button-row">
        <button
          className="primary"
          disabled={busy}
          onClick={() =>
            onSave(
              { name, description, script, css, steps: v.steps },
              lines(matches),
              lines(exclude),
            )
          }
        >
          <Save size={16} />
          {t('保存并应用')}
        </button>
        <button onClick={onRevise} disabled={busy}>
          <Code2 size={16} />
          {t('用 AI 修改')}
        </button>
      </div>
      {v.steps.length > 0 && (
        <div className="verification">
          <h2>{t('验证步骤')}</h2>
          <ol>
            {v.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </div>
      )}
      <div className="history">
        <h2>{t('版本记录')}</h2>
        {craft.versions.map((version, i) => (
          <div className="history-row" key={version.id}>
            <div>
              <strong>{time(version.createdAt)}</strong>
              <span>{version.prompt}</span>
            </div>
            {version.id === craft.activeVersionId ? (
              <small>{t('当前版本')}</small>
            ) : (
              <IconButton
                title={t('回退到版本 {0}', craft.versions.length - i)}
                onClick={() => onRollback(version.id)}
                disabled={busy}
              >
                <RotateCcw size={16} />
              </IconButton>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
void initializeLanguage().then(() => createRoot(document.getElementById('root')!).render(<App />));

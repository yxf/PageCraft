import React, { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowUp,
  ArrowLeft,
  Check,
  ChevronRight,
  Code2,
  FileText,
  Globe,
  Layers,
  LoaderCircle,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Settings2,
  Square,
  Trash2,
  Unplug,
  X,
  MousePointer2,
  ExternalLink,
  KeyRound,
  ShieldCheck,
  Wrench,
} from 'lucide-react';
import { activeVersion, type Craft, type Context, type State } from './types';
import { lines, matchesRules, originsFor, pagePattern, supported, validateRules } from './rules';
import { isExtension, send } from './client';
import { providers, publicSettings } from './providers';
import type { Provider } from './types';
import './style.css';
import { ToolsView } from './tools/ToolsView';
type Snapshot = Omit<State, 'settings'> & {
  available: boolean;
  grants: Record<string, boolean>;
  settings: ReturnType<typeof publicSettings>;
};
const time = (n: number) =>
  new Date(n).toLocaleString('zh-CN', {
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
  const [state, setState] = useState<Snapshot>(),
    [view, setView] = useState<'create' | 'library' | 'settings' | 'tools'>(
      location.pathname.includes('options') ? 'library' : 'create',
    );
  const [tab, setTab] = useState<{ id?: number; url?: string; title?: string }>({}),
    [prompt, setPrompt] = useState(''),
    [patterns, setPatterns] = useState(''),
    [excludes, setExcludes] = useState('');
  const [context, setContext] = useState<Context>(),
    [contextOpen, setContextOpen] = useState(false),
    [busy, setBusy] = useState(false),
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
  useEffect(() => {
    setContext(undefined);
    setContextOpen(false);
    if (tab.url && supported(tab.url)) setPatterns(pagePattern(tab.url));
    else setPatterns('');
    setExcludes('');
    setSelected(undefined);
    if (tab.id && isExtension) {
      let alive = true;
      chrome.storage.session.get(`draft:${tab.id}`).then((v) => {
        if (alive) setPrompt(v[`draft:${tab.id}`] || '');
      });
      return () => {
        alive = false;
      };
    }
  }, [tab.id, tab.url]);
  const draft = (value: string) => {
    setPrompt(value);
    if (isExtension && tab.id) void chrome.storage.session.set({ [`draft:${tab.id}`]: value });
  };
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
    if (!isExtension) throw new Error('请先加载 Chrome 扩展');
    const granted = await chrome.permissions.request({ origins: originsFor(matches) });
    if (!granted) throw new Error('未授予网站权限');
  };
  const live = state?.crafts.filter((c) => !c.deletedUntil) || [];
  const current = live.filter((c) => tab.url && matchesRules(c.matches, c.excludeMatches, tab.url));
  const task = state?.tasks[String(tab.id)];
  const generating = task && ['采集页面', 'AI 正在生成', '校验并保存'].includes(task.stage);
  const create = () =>
    void run(async () => {
      const matches = lines(patterns),
        excludeMatches = lines(excludes);
      validateRules(matches, excludeMatches);
      await grant(matches);
      if (!tab.id || !tab.url || !supported(tab.url)) throw new Error('请切换到普通网页');
      if (!state?.settings.hasKey || !state.settings.model)
        throw new Error('请先在设置中填写 API Key 和模型 ID');
      if (!state.settings.consent) throw new Error('请先在设置中确认页面摘要发送说明');
      const id = crypto.randomUUID();
      const result = await send('GENERATE', {
        id,
        tabId: tab.id,
        prompt,
        matches,
        excludeMatches,
        context,
        craftId: selected,
      });
      setSelected(result.craftId);
      return result.notice;
    });
  const capture = (select = false) =>
    void run(async () => {
      if (!tab.id || !tab.url || !supported(tab.url)) throw new Error('请切换到普通网页');
      await grant([pagePattern(tab.url)]);
      const data = await send('CONTEXT', { tabId: tab.id, select });
      setContext(data);
      setContextOpen(true);
      return select ? '已选择页面区域' : '页面摘要已更新';
    });
  const revise = (c: Craft) => {
    setSelected(c.id);
    setPatterns(c.matches.join('\n'));
    setExcludes(c.excludeMatches.join('\n'));
    draft('');
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
              ? '缺少站点权限'
              : !c.enabled
                ? '已停用'
                : record?.status === 'ok'
                  ? '执行无异常 · 待验证'
                  : record?.status === 'error'
                    ? '运行失败 · 可修改或重新生成'
                    : record?.status === 'refresh'
                      ? '请刷新恢复页面'
                      : '等待匹配页面'}{' '}
            · {time(c.updatedAt)}
          </small>
        </button>
        <button
          role="switch"
          aria-label={`${c.name} 启用状态`}
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
    <div className={'app ' + (location.pathname.includes('options') ? 'wide' : '')}>
      <header className="topbar">
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setView('create');
          }}
          className="brand"
        >
          <img src="/icon.svg" alt="" />
          <span>
            PageCraft<small>页匠</small>
          </span>
        </a>
        <div className="header-actions">
          <span className="version">LOCAL · 0.1</span>
          <IconButton
            title="打开管理页"
            onClick={() =>
              isExtension ? void chrome.runtime.openOptionsPage() : setView('library')
            }
          >
            <ExternalLink size={17} />
          </IconButton>
        </div>
      </header>
      <nav className="tabs" aria-label="主要导航">
        {(
          [
            ['create', '当前页面', Globe],
            ['library', '我的改造', Layers],
            ['tools', '工具', Wrench],
            ['settings', '设置', Settings2],
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
            界面预览 · 尚未连接浏览器扩展
          </div>
        )}
        {error && (
          <div className="message error" role="alert">
            <span>{error}</span>
            <IconButton title="关闭错误" onClick={() => setError('')}>
              <X size={15} />
            </IconButton>
          </div>
        )}
        {notice && (
          <div className="message success" role="status">
            <span>{notice}</span>
            <IconButton title="关闭通知" onClick={() => setNotice('')}>
              <X size={15} />
            </IconButton>
          </div>
        )}
        {undo && (
          <div className="message">
            <span>改造已删除</span>
            <button
              onClick={() =>
                void run(async () => {
                  const result = await send('UNDO', { id: undo });
                  setUndo(undefined);
                  return result;
                })
              }
            >
              撤销
            </button>
          </div>
        )}
        {view === 'create' && !editing && (
          <>
            <section className="page-heading">
              <div>
                <div className="eyebrow">当前页面</div>
                <h1>
                  {tab.url && supported(tab.url) ? new URL(tab.url).hostname : '等待打开网页'}
                </h1>
                <p className="page-title">{tab.title || 'PageCraft'}</p>
              </div>
              <span
                className={'connection ' + (tab.url && supported(tab.url) ? 'connected' : '')}
              />
            </section>
            {state && !state.available && isExtension && (
              <div className="setup-note">
                <ShieldCheck size={18} />
                <div>
                  尚未允许用户脚本
                  <button
                    onClick={() =>
                      void chrome.tabs.create({
                        url: `chrome://extensions/?id=${chrome.runtime.id}`,
                      })
                    }
                  >
                    打开扩展详情
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            )}
            <section className="composer-section">
              <div className="section-title">
                <h2>{selected ? '继续修改' : '创建改造'}</h2>
                {selected && (
                  <IconButton
                    title="新建改造"
                    onClick={() => {
                      setSelected(undefined);
                      draft('');
                    }}
                  >
                    <Plus size={17} />
                  </IconButton>
                )}
              </div>
              {selected && (
                <div className="selected-name">
                  <Code2 size={14} />
                  {live.find((c) => c.id === selected)?.name}
                </div>
              )}
              <div className="composer">
                <textarea
                  aria-label="改造需求"
                  placeholder="你想让这个网页有什么不同？"
                  value={prompt}
                  maxLength={6000}
                  onChange={(e) => draft(e.target.value)}
                  disabled={!!generating}
                />
                <div className="composer-bottom">
                  <span>{prompt.length} / 6000</span>
                  {generating ? (
                    <IconButton
                      title="取消生成"
                      onClick={() =>
                        void send('CANCEL', { id: task.id }).catch((e) => setError(e.message))
                      }
                    >
                      <Square size={17} />
                    </IconButton>
                  ) : (
                    <button
                      className="primary generate"
                      onClick={create}
                      disabled={busy || !prompt.trim()}
                    >
                      <ArrowUp size={17} />
                      生成并应用
                    </button>
                  )}
                </div>
              </div>
              <div className="context-actions">
                <button className="quiet" onClick={() => capture(true)} disabled={busy}>
                  <MousePointer2 size={15} />
                  选择元素
                </button>
                <button
                  className="quiet"
                  onClick={() => (context ? setContextOpen(!contextOpen) : capture())}
                  disabled={busy}
                >
                  <FileText size={15} />
                  {context ? '查看摘要' : '采集摘要'}
                </button>
                {context && (
                  <IconButton title="重新采集摘要" onClick={() => capture()} disabled={busy}>
                    <RefreshCw size={14} />
                  </IconButton>
                )}
              </div>
              {contextOpen && context && (
                <div className="context-preview">
                  <div>
                    {context.summary.length} 字符{context.truncated ? ' · 已裁剪' : ''}
                  </div>
                  <pre>{context.summary}</pre>
                </div>
              )}
              <details className="rules" open>
                <summary>
                  应用范围 <span>{lines(patterns).length} 条规则</span>
                </summary>
                <div className="rule-presets">
                  <button
                    disabled={!tab.url || !supported(tab.url)}
                    onClick={() => setPatterns(pagePattern(tab.url!))}
                  >
                    当前网站
                  </button>
                  <button
                    disabled={!tab.url || !supported(tab.url)}
                    onClick={() => setPatterns(pagePattern(tab.url!, true))}
                  >
                    当前路径
                  </button>
                </div>
                <label>
                  匹配规则
                  <textarea
                    className="code compact"
                    aria-label="匹配规则"
                    value={patterns}
                    onChange={(e) => setPatterns(e.target.value)}
                    placeholder="https://example.com/*"
                  />
                </label>
                <label>
                  排除规则
                  <textarea
                    className="code compact"
                    aria-label="排除规则"
                    value={excludes}
                    onChange={(e) => setExcludes(e.target.value)}
                    placeholder="https://example.com/private/*"
                  />
                </label>
                <p className="rule-result">
                  {tab.url
                    ? matchesRules(lines(patterns), lines(excludes), tab.url)
                      ? '当前页面在应用范围内'
                      : '当前页面不在应用范围内'
                    : '尚未选择页面'}
                </p>
              </details>
            </section>
            {(busy || task) && (
              <div className={'task-status ' + (task?.error ? 'danger' : '')}>
                {busy ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}
                <span>
                  {task?.error || task?.stage || '正在处理'}
                  {generating && task?.stage === 'AI 正在生成' && (
                    <span>
                      {' '}
                      ·{' '}
                      {task.receivedChars
                        ? `已接收 ${task.receivedChars} 字符`
                        : task.lastResponseAt
                          ? '模型已响应，等待代码'
                          : '等待模型响应'}
                    </span>
                  )}
                  {task?.error && (
                    <button
                      className="text-link"
                      onClick={create}
                      disabled={busy || !prompt.trim()}
                    >
                      重试
                    </button>
                  )}
                </span>
              </div>
            )}
            <section className="current-crafts">
              <div className="section-title">
                <h2>
                  此页的改造 <span className="count">{current.length}</span>
                </h2>
                <IconButton
                  title="重新应用已保存改造"
                  onClick={() => void run(() => send('REAPPLY'))}
                  disabled={busy}
                >
                  <RefreshCw size={16} />
                </IconButton>
              </div>
              {current.length ? (
                current.map(craftRow)
              ) : (
                <div className="empty">
                  <Layers size={28} />
                  <h3>还没有改造</h3>
                  <p>此页面的改造会保存在这里</p>
                </div>
              )}
            </section>
          </>
        )}
        {view === 'library' && !editing && (
          <>
            <section className="page-heading">
              <div>
                <div className="eyebrow">工作空间</div>
                <h1>我的改造</h1>
                <p>
                  {live.filter((c) => c.enabled).length} 个启用 · {live.length} 个已保存
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
                新建
              </button>
            </section>
            <div className="filters">
              <label className="search">
                <Search size={16} />
                <input
                  aria-label="搜索改造"
                  placeholder="搜索改造"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              <select aria-label="站点筛选" value={site} onChange={(e) => setSite(e.target.value)}>
                <option value="all">全部站点</option>
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
                <h3>你的网页，你的版本</h3>
                <p>尚未保存任何改造</p>
                <button className="primary" onClick={() => setView('create')}>
                  <Plus size={16} />
                  创建改造
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
                <div className="eyebrow">偏好设置</div>
                <h1>连接你的 AI</h1>
                <p>{providers[provider]} · 用户自带 API Key</p>
              </div>
              <KeyRound size={25} />
            </section>
            <section className="settings-form">
              <label>
                AI 服务商
                <select
                  aria-label="AI 服务商"
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
                  {state?.settings.profiles[provider].hasKey ? '已保存' : '未配置'}
                </span>
                <input
                  type="password"
                  autoComplete="off"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder={
                    state?.settings.profiles[provider].hasKey
                      ? '留空保留现有 Key'
                      : '填写当前服务商的 API Key'
                  }
                  aria-label="API Key"
                />
              </label>
              <label>
                模型 ID
                <input
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="填写支持结构化输出的模型 ID"
                  aria-label="模型 ID"
                />
              </label>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                />
                <span>
                  允许将我的需求及必要的页面摘要发送到 {providers[provider]}
                  。可见文本可能包含个人信息。
                </span>
              </label>
              <p className="settings-note">
                Key 仅保存在本机扩展存储，不会传入网页。API 调用由你的 {providers[provider]}
                账户计费，本地保存不等同于加密保险库。
              </p>
              <div className="button-row">
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await send('SETTINGS', { provider, apiKey: key, model, consent });
                      setKey('');
                      return '设置已保存';
                    })
                  }
                >
                  <Save size={16} />
                  保存设置
                </button>
                <button
                  disabled={busy || !state?.settings.hasKey || provider !== state.settings.provider}
                  onClick={() => void run(() => send('TEST'))}
                >
                  <RefreshCw size={16} />
                  测试已保存连接
                </button>
              </div>
              <p className="muted">连接测试会产生少量 API 费用。</p>
            </section>
            <section className="settings-section">
              <h2>脚本执行</h2>
              <p>{state?.available ? '用户脚本 API 已就绪' : '用户脚本尚未启用'}</p>
              <p className="settings-note">
                开发模式：仅校验代码语法，不限制脚本能力。生成代码可读取页面数据、联网或改变页面行为，请仅在测试网页使用。关闭改造可能无法撤销全部副作用。
              </p>
              <button
                onClick={() =>
                  isExtension &&
                  void chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` })
                }
              >
                <ExternalLink size={15} />
                扩展权限
              </button>
            </section>
            <section className="settings-section">
              <h2>本地数据</h2>
              <div className="button-row">
                <button
                  disabled={busy || !state?.settings.profiles[provider].hasKey}
                  onClick={() =>
                    void run(async () => {
                      await send('SETTINGS', { provider, clearKey: true, model, consent });
                      setKey('');
                      return 'API Key 已清除';
                    })
                  }
                >
                  <KeyRound size={15} />
                  清除 Key
                </button>
                <button className="danger" onClick={() => setClearConfirm(true)}>
                  <Trash2 size={15} />
                  清除全部数据
                </button>
              </div>
              {clearConfirm && (
                <div className="message error">
                  <span>将删除全部改造、版本和 Key，无法撤销。</span>
                  <button
                    onClick={() =>
                      void run(async () => {
                        await send('CLEAR');
                        setClearConfirm(false);
                        setSettingsLoaded(false);
                        return '本地数据已清除；请刷新已打开的网页';
                      })
                    }
                  >
                    确认清除
                  </button>
                  <button onClick={() => setClearConfirm(false)}>取消</button>
                </div>
              )}
            </section>
          </>
        )}
      </main>
      <footer>
        <span>
          <i />
          本地工作空间
        </span>
        <span>PageCraft / 页匠</span>
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
          返回
        </button>
        <IconButton title="删除改造" onClick={onDelete} disabled={busy}>
          <Trash2 size={16} />
        </IconButton>
      </div>
      <h1>{craft.name}</h1>
      <label>
        名称
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
      </label>
      <label>
        说明
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
          aria-label="JavaScript 源码"
          className="code source"
          spellCheck={false}
          value={script}
          onChange={(e) => setScript(e.target.value)}
        />
      </label>
      <label>
        CSS
        <textarea
          aria-label="CSS 源码"
          className="code"
          spellCheck={false}
          value={css}
          onChange={(e) => setCss(e.target.value)}
        />
      </label>
      <label>
        匹配规则
        <textarea
          className="code compact"
          value={matches}
          onChange={(e) => setMatches(e.target.value)}
        />
      </label>
      <label>
        排除规则
        <textarea
          className="code compact"
          value={exclude}
          onChange={(e) => setExclude(e.target.value)}
        />
      </label>
      <label>
        测试 URL
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com/page"
        />
      </label>
      {url && <p>{matchesRules(lines(matches), lines(exclude), url) ? '匹配' : '不匹配'}</p>}
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
          保存并应用
        </button>
        <button onClick={onRevise} disabled={busy}>
          <Code2 size={16} />用 AI 修改
        </button>
      </div>
      {v.steps.length > 0 && (
        <div className="verification">
          <h2>验证步骤</h2>
          <ol>
            {v.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </div>
      )}
      <div className="history">
        <h2>版本记录</h2>
        {craft.versions.map((version, i) => (
          <div className="history-row" key={version.id}>
            <div>
              <strong>{time(version.createdAt)}</strong>
              <span>{version.prompt}</span>
            </div>
            {version.id === craft.activeVersionId ? (
              <small>当前版本</small>
            ) : (
              <IconButton
                title={`回退到版本 ${craft.versions.length - i}`}
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
createRoot(document.getElementById('root')!).render(<App />);

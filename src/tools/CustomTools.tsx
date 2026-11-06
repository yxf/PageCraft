import { useEffect, useState } from 'react';
import {
  Plus,
  Play,
  Save,
  Sparkles,
  Pencil,
  Trash2,
  ArrowLeft,
  RotateCcw,
  Square,
  LoaderCircle,
} from 'lucide-react';
import { isExtension, send } from '../client';
import {
  currentTool,
  autoSettings,
  autoMatches,
  defaultAutoStart,
  type CustomTool,
  type CustomVersion,
} from './custom-model';
import { originsFor, lines } from '../rules';
import type { CustomStatus } from './custom-service';
import type { ToolResult } from './registry';

type Draft = Omit<CustomVersion, 'id' | 'createdAt'>;
const blank = (): Draft => ({
  name: '',
  description: '',
  script: 'return { kind: "text", data: document.title, filename: "page-title.txt" };',
  css: '',
  steps: [],
  prompt: '',
  params: {},
  autoStart: defaultAutoStart(),
});
export function CustomTools({
  tab,
  disabled,
  onResult,
  onBusy,
  onFailure,
}: {
  tab: { id?: number; url?: string };
  disabled: boolean;
  onResult: (r: ToolResult) => void;
  onBusy: (busy: boolean) => void;
  onFailure: (message: string) => void;
}) {
  const [tools, setTools] = useState<CustomTool[]>([]);
  const [editing, setEditing] = useState(false),
    [tool, setTool] = useState<CustomTool>();
  const [draft, setDraft] = useState<Draft>(blank),
    [params, setParams] = useState('{}');
  const [mode, setMode] = useState<'ai' | 'code'>('ai'),
    [includeContext, setIncludeContext] = useState(false);
  const [matchText, setMatchText] = useState('');
  const auto = draft.autoStart || defaultAutoStart();
  const [status, setStatus] = useState<CustomStatus>(),
    [pending, setPending] = useState(false);
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [versionId, setVersionId] = useState('');
  const refresh = async () => {
    if (isExtension) setTools(await send('CUSTOM_LIST'));
  };
  useEffect(() => {
    if (!isExtension) return;
    let alive = true;
    const poll = async () => {
      try {
        const s = await send('CUSTOM_STATUS');
        const list = await send('CUSTOM_LIST');
        if (alive) {
          setStatus(s);
          setTools(list);
        }
      } catch {}
    };
    void poll();
    const timer = setInterval(poll, 1000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  const ownBusy = pending || !!status?.running,
    busy = ownBusy || disabled;
  useEffect(() => {
    onBusy(ownBusy);
  }, [ownBusy, onBusy]);
  const setEditor = (value?: CustomTool) => {
    setTool(value);
    const data = value ? currentTool(value) : blank();
    setDraft(data);
    setMatchText((data.autoStart?.matches || []).join('\n'));
    setParams(JSON.stringify(data.params, null, 2));
    setVersionId(value?.activeVersionId || '');
    setEditing(true);
    setError('');
    setNotice('');
  };
  const data = () => {
    let parsed;
    try {
      parsed = JSON.parse(params);
    } catch {
      throw new Error('运行参数不是有效 JSON');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error('运行参数必须是 JSON 对象');
    return {
      ...draft,
      params: parsed,
      autoStart: autoSettings({ ...auto, matches: lines(matchText) }),
    };
  };
  const accessAuto = async (value: Draft) => {
    const a = autoSettings(value.autoStart);
    if (!a.enabled) return;
    if (!isExtension) throw new Error('请在 Chrome 扩展中保存自动工具');
    const origins = originsFor(autoMatches(a));
    if (
      !(await chrome.permissions.contains({ origins })) &&
      !(await chrome.permissions.request({ origins }))
    )
      throw new Error('未授予自动启动范围的网站权限');
  };
  const access = async () => {
    if (!isExtension) throw new Error('请在 Chrome 扩展中使用自建工具');
    if (!tab.id || !tab.url || !/^https?:\/\//.test(tab.url)) throw new Error('请切换到普通网页');
    const origins = [new URL(tab.url).origin + '/*'];
    if (
      !(await chrome.permissions.contains({ origins })) &&
      !(await chrome.permissions.request({ origins }))
    )
      throw new Error('未授予当前网站权限');
  };
  const action = async (fn: () => Promise<void>) => {
    setPending(true);
    setError('');
    setNotice('');
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
      onFailure((e as Error).message);
    } finally {
      setPending(false);
      if (isExtension) setStatus(await send('CUSTOM_STATUS').catch(() => undefined));
    }
  };
  const run = (saved?: CustomTool) =>
    void action(async () => {
      await access();
      const result = await send('CUSTOM_RUN', {
        tabId: tab.id,
        ...(saved ? { toolId: saved.id } : { data: data() }),
      });
      onResult(result);
      setNotice('运行完成');
    });
  return (
    <section className="custom-tools">
      <div className="section-title">
        <h2>
          我的工具 <span className="count">{tools.length}</span>
        </h2>
        <button disabled={busy} onClick={() => setEditor()}>
          <Plus size={16} />
          创建工具
        </button>
      </div>
      {ownBusy && (
        <div className="tool-progress" role="status">
          <LoaderCircle className="spin" size={16} />
          <span>
            {status?.running ? status.stage : '正在处理'}
            {status?.running && status.receivedChars ? ` · ${status.receivedChars} 字符` : ''}
          </span>
          <button
            aria-label="取消自建工具任务"
            title="取消自建工具任务"
            disabled={!status?.running}
            onClick={() =>
              void send('CUSTOM_CANCEL', { id: status?.id }).catch((e) => setError(e.message))
            }
          >
            <Square size={16} />
          </button>
        </div>
      )}
      {error && (
        <div className="message error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="message success" role="status">
          {notice}
        </div>
      )}
      {editing ? (
        <div className="custom-editor">
          <button
            className="quiet"
            disabled={busy}
            onClick={() => {
              if (confirm('离开编辑？未保存的修改将丢失。')) setEditing(false);
            }}
          >
            <ArrowLeft size={16} />
            工具列表
          </button>
          <div className="button-row" role="tablist" aria-label="创建方式">
            <button role="tab" aria-selected={mode === 'ai'} onClick={() => setMode('ai')}>
              自然语言
            </button>
            <button role="tab" aria-selected={mode === 'code'} onClick={() => setMode('code')}>
              手动编写
            </button>
          </div>
          <fieldset disabled={busy}>
            {mode === 'ai' && (
              <>
                <label>
                  功能需求
                  <textarea
                    aria-label="工具功能需求"
                    rows={4}
                    value={draft.prompt}
                    onChange={(e) => setDraft({ ...draft, prompt: e.target.value })}
                  />
                </label>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={includeContext}
                    onChange={(e) => setIncludeContext(e.target.checked)}
                  />
                  <span>生成时发送当前页摘要</span>
                </label>
                <button
                  disabled={!draft.prompt.trim()}
                  onClick={() =>
                    void action(async () => {
                      if (includeContext) await access();
                      const previous = draft.name.trim() ? data() : undefined;
                      const generated = await send('CUSTOM_GENERATE', {
                        prompt: draft.prompt,
                        previous,
                        params: data().params,
                        includeContext,
                        tabId: tab.id,
                        autoStart: data().autoStart,
                      });
                      setDraft({ ...generated, autoStart: data().autoStart });
                      setParams(JSON.stringify(generated.params, null, 2));
                      setNotice('已生成草稿，尚未运行或保存');
                    })
                  }
                >
                  <Sparkles size={16} />
                  生成代码
                </button>
              </>
            )}
            <label>
              工具名称
              <input
                aria-label="工具名称"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            <label>
              工具说明
              <textarea
                aria-label="工具说明"
                rows={3}
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
            </label>
            <label>
              JavaScript
              <textarea
                aria-label="工具 JavaScript"
                className="code source"
                spellCheck={false}
                value={draft.script}
                onChange={(e) => setDraft({ ...draft, script: e.target.value })}
              />
            </label>
            <label>
              运行参数（JSON）
              <textarea
                aria-label="工具运行参数"
                className="code"
                rows={3}
                spellCheck={false}
                value={params}
                onChange={(e) => setParams(e.target.value)}
              />
            </label>
            <details>
              <summary>临时 CSS</summary>
              <textarea
                aria-label="工具 CSS"
                className="code"
                rows={3}
                value={draft.css}
                onChange={(e) => setDraft({ ...draft, css: e.target.value })}
              />
            </details>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={auto.enabled}
                onChange={(e) =>
                  setDraft({ ...draft, autoStart: { ...auto, enabled: e.target.checked } })
                }
              />
              <span>自动启动</span>
            </label>
            {auto.enabled && (
              <>
                <label>
                  生效范围
                  <select
                    aria-label="自动启动范围"
                    value={auto.scope}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        autoStart: { ...auto, scope: e.target.value as 'all' | 'sites' },
                      })
                    }
                  >
                    <option value="all">所有网站（需授权）</option>
                    <option value="sites">指定网站</option>
                  </select>
                </label>
                {auto.scope === 'sites' && (
                  <label>
                    网址规则
                    <textarea
                      aria-label="自动启动网址规则"
                      rows={3}
                      placeholder="https://example.com/*"
                      value={matchText}
                      onChange={(e) => setMatchText(e.target.value)}
                    />
                  </label>
                )}
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={auto.rerunOnRoute}
                    onChange={(e) =>
                      setDraft({ ...draft, autoStart: { ...auto, rerunOnRoute: e.target.checked } })
                    }
                  />
                  <span>SPA 路由变化时重新运行</span>
                </label>
                <p className="settings-note">
                  保存后立即在已打开的匹配网页生效；代码可能联网或产生不可撤销的操作。
                </p>
              </>
            )}
            <p className="settings-note">
              自建代码可读取或修改页面并联网；试运行会真实执行，取消不能撤销所有副作用。
            </p>
            <div className="button-row">
              <button onClick={() => run()}>
                <Play size={16} />
                试运行
              </button>
              <button
                className="primary"
                onClick={() =>
                  void action(async () => {
                    const value = data();
                    await accessAuto(value);
                    const saved = await send('CUSTOM_SAVE', {
                      id: tool?.id,
                      expectedVersion: tool?.activeVersionId,
                      data: value,
                    });
                    setEditor(saved);
                    setNotice('工具已保存');
                  })
                }
              >
                <Save size={16} />
                保存工具
              </button>
            </div>
            {tool && (
              <div className="custom-history">
                <label>
                  历史版本
                  <select
                    aria-label="工具历史版本"
                    value={versionId}
                    onChange={(e) => setVersionId(e.target.value)}
                  >
                    {tool.versions.map((v) => (
                      <option key={v.id} value={v.id}>
                        {new Date(v.createdAt).toLocaleString()} · {v.name}
                        {v.id === tool.activeVersionId ? '（当前）' : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  disabled={versionId === tool.activeVersionId}
                  onClick={() =>
                    void action(async () => {
                      await accessAuto(tool.versions.find((v) => v.id === versionId)!);
                      const saved = await send('CUSTOM_ROLLBACK', {
                        id: tool.id,
                        versionId,
                        expectedVersion: tool.activeVersionId,
                      });
                      setEditor(saved);
                      setNotice('已恢复所选版本');
                    })
                  }
                >
                  <RotateCcw size={16} />
                  恢复版本
                </button>
              </div>
            )}
          </fieldset>
        </div>
      ) : (
        <div className="custom-list">
          {!tools.length && <p className="muted">暂无自建工具</p>}
          {tools.map((item) => {
            const version = currentTool(item);
            return (
              <article className="custom-row" key={item.id}>
                <div>
                  <h3>{version.name}</h3>
                  <p>{version.description}</p>
                  <p className="muted">{version.autoStart?.enabled ? '自动启动' : '手动运行'}</p>
                </div>
                <div className="button-row">
                  <button
                    title={`运行 ${version.name}`}
                    aria-label={`运行 ${version.name}`}
                    disabled={busy}
                    onClick={() => run(item)}
                  >
                    <Play size={16} />
                  </button>
                  <button
                    title={`编辑 ${version.name}`}
                    aria-label={`编辑 ${version.name}`}
                    disabled={busy}
                    onClick={() => {
                      setMode('code');
                      setEditor(item);
                    }}
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    title={`删除 ${version.name}`}
                    aria-label={`删除 ${version.name}`}
                    disabled={busy}
                    onClick={() => {
                      if (confirm(`删除工具“${version.name}”及其版本？`))
                        void action(async () => {
                          await send('CUSTOM_DELETE', { id: item.id });
                        });
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

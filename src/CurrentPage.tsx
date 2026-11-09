import { t, getLocale } from './i18n';
import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  Code2,
  FileText,
  LoaderCircle,
  MousePointer2,
  Plus,
  RefreshCw,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Square,
  X,
} from 'lucide-react';
import { isExtension, send } from './client';
import { type Context, type Craft, type State } from './types';
import { lines, matchesRules, originsFor, pagePattern, supported, validateRules } from './rules';
import {
  conversationHistory,
  emptyConversation,
  type Conversation,
  type ConversationEntry,
} from './conversation';

type Props = {
  state: Omit<State, 'settings'> & {
    available: boolean;
    grants: Record<string, boolean>;
    settings: { hasKey: boolean; model: string; consent: boolean };
  };
  tab: { id?: number; url?: string; title?: string };
  initialTarget?: string;
  onTargetConsumed: () => void;
  onEdit: (craft: Craft) => void;
  refresh: () => Promise<void>;
};
export function CurrentPage({
  state,
  tab,
  initialTarget,
  onTargetConsumed,
  onEdit,
  refresh,
}: Props) {
  const origin = tab.url && supported(tab.url) ? new URL(tab.url).origin : '';
  const storageKey = `conversation:${tab.id}:${origin}`;
  const [chat, setChat] = useState<Conversation>(emptyConversation);
  const chatRef = useRef(chat);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState('');
  const [patterns, setPatterns] = useState(tab.url && origin ? pagePattern(tab.url) : '');
  const [excludes, setExcludes] = useState('');
  const [context, setContext] = useState<Context>();
  const [requestId, setRequestId] = useState<string>();
  const input = useRef<HTMLTextAreaElement>(null);
  const writes = useRef(Promise.resolve());
  const live = state.crafts.filter((c) => !c.deletedUntil);
  const target = live.find((c) => c.id === chat.targetId);
  const current = live.filter((c) => tab.url && matchesRules(c.matches, c.excludeMatches, tab.url));
  const task = state.tasks[String(tab.id)];
  const generating = !!task && ['采集页面', 'AI 正在生成', '校验并保存'].includes(task.stage);
  const locked = busy || generating || !ready;
  function update(fn: (value: Conversation) => Conversation) {
    const next = fn(chatRef.current);
    next.entries = next.entries.slice(-40);
    chatRef.current = next;
    setChat(next);
    if (isExtension && origin) {
      writes.current = writes.current
        .then(() => chrome.storage.session.set({ [storageKey]: next }))
        .catch(() => {
          setError(t('对话保存失败，请勿关闭侧边栏'));
        });
    }
  }
  useEffect(() => {
    let alive = true;
    (async () => {
      const stored =
        isExtension && origin
          ? (await chrome.storage.session.get(storageKey))[storageKey]
          : undefined;
      if (!alive) return;
      const value: Conversation = stored || emptyConversation();
      // A closed panel may lose its request response; never blindly replay that operation.
      value.entries = value.entries.map((e) =>
        e.status === 'pending'
          ? {
              ...e,
              status: 'error',
              message: t('响应未确认，请先检查已有功能和运行状态，避免重复生成。'),
            }
          : e,
      );
      if (initialTarget && live.some((c) => c.id === initialTarget)) value.targetId = initialTarget;
      onTargetConsumed();
      chatRef.current = value;
      setChat(value);
      setReady(true);
    })().catch(() => {
      if (alive) {
        setReady(true);
        setError(t('无法读取对话记录'));
      }
    });
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    setContext(undefined);
    if (!target) {
      setPatterns(origin && tab.url ? pagePattern(tab.url) : '');
      setExcludes('');
    }
  }, [tab.url]);
  useEffect(() => {
    setPatterns(target ? target.matches.join('\n') : origin && tab.url ? pagePattern(tab.url) : '');
    setExcludes(target ? target.excludeMatches.join('\n') : '');
  }, [target?.id, target?.updatedAt]);
  const choose = (craft?: Craft) => {
    if (locked) return;
    update((c) => ({ ...c, targetId: craft?.id }));
    setError('');
    setPatterns(craft ? craft.matches.join('\n') : origin && tab.url ? pagePattern(tab.url) : '');
    setExcludes(craft ? craft.excludeMatches.join('\n') : '');
    input.current?.focus();
  };
  async function access(matches: string[]) {
    validateRules(matches, []);
    if (!isExtension) throw new Error(t('请先加载 Chrome 扩展'));
    if (!(await chrome.permissions.request({ origins: originsFor(matches) })))
      throw new Error(t('未授予网站权限'));
  }
  async function action(fn: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function generate() {
    if (locked || !chat.draft.trim()) return;
    await action(async () => {
      if (!tab.id || !origin) throw new Error(t('请切换到普通网页'));
      if (chat.targetId && !target)
        throw new Error(t('选中的功能已删除，请选择其他功能或新增改造'));
      if (!state.settings.hasKey || !state.settings.model || !state.settings.consent)
        throw new Error(t('请先在设置中配置模型并授权发送页面摘要'));
      const matches = lines(patterns),
        excludeMatches = lines(excludes);
      validateRules(matches, excludeMatches);
      await access(matches);
      const id = crypto.randomUUID(),
        prompt = chat.draft;
      const entry: ConversationEntry = {
        id,
        prompt,
        targetId: target?.id,
        targetName: target?.name,
        priorVersionId: target?.activeVersionId,
        status: 'pending',
        message: t('正在生成'),
      };
      const history = conversationHistory(chat.entries, target?.id);
      update((c) => ({ ...c, draft: '', entries: [...c.entries, entry] }));
      setRequestId(id);
      try {
        const result = await send('GENERATE', {
          id,
          tabId: tab.id,
          prompt,
          matches,
          excludeMatches,
          context,
          craftId: target?.id,
          expectedVersion: target?.activeVersionId,
          expectedUpdatedAt: target?.updatedAt,
          history,
        });
        update((c) => ({
          ...c,
          targetId: result.craftId,
          entries: c.entries.map((e) =>
            e.id === id
              ? {
                  ...e,
                  status: 'saved',
                  message: result.notice,
                  targetId: result.craftId,
                  targetName: result.name,
                  versionId: result.versionId,
                  summary: result.description,
                }
              : e,
          ),
        }));
      } catch (e) {
        update((c) => ({
          ...c,
          draft: prompt,
          entries: c.entries.map((item) =>
            item.id === id ? { ...item, status: 'error', message: (e as Error).message } : item,
          ),
        }));
      } finally {
        setRequestId(undefined);
      }
    });
  }
  function undo(entry: ConversationEntry) {
    void action(async () => {
      await send('CONVERSATION_UNDO', {
        craftId: entry.targetId,
        versionId: entry.versionId,
        priorVersionId: entry.priorVersionId,
      });
      update((c) => ({
        ...c,
        entries: c.entries.map((e) => (e.id === entry.id ? { ...e, undone: true } : e)),
      }));
    });
  }
  function status(c: Craft) {
    if (!state.grants[c.id]) return t('缺少权限');
    if (!c.enabled) return t('已停用');
    const record = state.runs.find(
      (r) =>
        r.tabId === tab.id &&
        r.craftId === c.id &&
        r.versionId === c.activeVersionId &&
        r.url === tab.url,
    );
    return record?.status === 'ok'
      ? t('已应用')
      : record?.status === 'error'
        ? t('执行失败')
        : record?.status === 'refresh'
          ? t('需刷新')
          : t('已启用 · 待确认');
  }
  return (
    <div className="conversation-page">
      <section className="page-heading">
        <div>
          <div className="eyebrow">{t('当前页面')}</div>
          <h1>{origin ? new URL(origin).hostname : t('等待打开网页')}</h1>
          <p className="page-title">{tab.title || 'PageCraft'}</p>
        </div>
        <span className={`connection ${origin ? 'connected' : ''}`} />
      </section>
      {!state.available && isExtension && (
        <div className="setup-note">
          <ShieldCheck size={18} />
          <div>
            {t('尚未允许用户脚本')}
            <button
              onClick={() =>
                void chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` })
              }
            >
              {t('打开扩展详情')}
            </button>
          </div>
        </div>
      )}
      <section className="conversation-features" aria-label={t('已有功能')}>
        <div className="section-title">
          <h2>
            {t('此页的改造')}
            <span className="count">{current.length}</span>
          </h2>
          <div className="feature-controls">
            <button
              className="icon-button"
              title={t('重新应用已保存改造')}
              aria-label={t('重新应用已保存改造')}
              disabled={locked || !origin}
              onClick={() =>
                void action(async () => {
                  await send('REAPPLY');
                })
              }
            >
              <RefreshCw size={15} />
            </button>
            <button className="quiet" disabled={locked} onClick={() => choose()}>
              <Plus size={16} />
              {t('新增改造')}
            </button>
          </div>
        </div>
        <div className="feature-list">
          {current.map((c) => (
            <div className="feature-item" key={c.id}>
              <button
                className="feature-select"
                title={`${c.description}\n${c.matches.join('\n')}`}
                aria-label={t('继续优化 {0}', c.name)}
                aria-pressed={chat.targetId === c.id}
                disabled={locked}
                onClick={() => choose(c)}
              >
                <Code2 size={16} />
                <span>
                  <strong>{c.name}</strong>
                  <small>{status(c)}</small>
                </span>
              </button>
              <button
                className={'toggle ' + (c.enabled ? 'on' : '')}
                role="switch"
                aria-checked={c.enabled}
                aria-label={t('启用 {0}', c.name)}
                disabled={locked}
                onClick={() =>
                  void action(async () => {
                    if (!c.enabled) await access(c.matches);
                    await send('TOGGLE', { id: c.id, enabled: !c.enabled });
                  })
                }
              >
                <span />
              </button>
              <button
                className="icon-button"
                title={t('管理 {0}', c.name)}
                aria-label={t('管理 {0}', c.name)}
                disabled={locked}
                onClick={() => onEdit(c)}
              >
                <Settings2 size={15} />
              </button>
            </div>
          ))}
        </div>
        {!current.length && <p>{t('此页面暂无改造')}</p>}
      </section>
      <section className="conversation-compose">
        {chat.entries.slice(-1).map((entry) => {
          const craft = live.find((c) => c.id === entry.targetId);
          const canUndo =
            craft &&
            entry.versionId === craft.activeVersionId &&
            !entry.undone &&
            (!entry.priorVersionId || craft.versions.some((v) => v.id === entry.priorVersionId));
          return (
            <div className="last-operation" key={entry.id} aria-live="polite">
              {entry.status === 'pending' ? (
                <p role="status">
                  <LoaderCircle className="spin" size={14} />
                  {task?.id === entry.id ? t(task.stage) : t('正在处理')}
                  {task?.id === entry.id && task.receivedChars
                    ? t(' · {0} 字符', task.receivedChars)
                    : ''}
                </p>
              ) : (
                <>
                  <h3>
                    {entry.status === 'saved'
                      ? `${entry.undone ? t('已撤销本次修改') : entry.priorVersionId ? t('已更新') : t('已新增')} · ${entry.targetName || t('改造')}`
                      : t('未完成')}
                  </h3>
                  <p className={entry.status === 'error' ? 'danger' : ''}>{t(entry.message)}</p>
                  {entry.status === 'saved' && (
                    <button
                      className="icon-button"
                      title={t('撤销本次')}
                      aria-label={t('撤销本次 {0}', entry.targetName)}
                      disabled={locked || !canUndo}
                      onClick={() => undo(entry)}
                    >
                      <RotateCcw size={15} />
                    </button>
                  )}
                </>
              )}
            </div>
          );
        })}
        {error && (
          <div className="message error" role="alert">
            {t(error)}
          </div>
        )}
        <div className="conversation-target">
          <span>
            {chat.targetId ? t('正在编辑：{0}', target?.name || t('功能已删除')) : t('新增改造')}
          </span>
          {chat.targetId && (
            <button
              className="icon-button"
              title={t('退出编辑，新增改造')}
              aria-label={t('退出编辑')}
              disabled={locked}
              onClick={() => choose()}
            >
              <X size={15} />
            </button>
          )}
        </div>
        {target && tab.url && !matchesRules(target.matches, target.excludeMatches, tab.url) && (
          <p className="danger">{t('此功能不在当前页生效，请返回匹配页面后修改。')}</p>
        )}
        <div className="composer">
          <textarea
            ref={input}
            aria-label={t('改造需求')}
            placeholder={target ? t('描述你想调整的地方…') : t('描述要新增的功能…')}
            value={chat.draft}
            maxLength={6000}
            disabled={locked}
            onChange={(e) => update((c) => ({ ...c, draft: e.target.value }))}
          />
          <div className="composer-bottom">
            <span>{chat.draft.length} / 6000</span>
            {requestId || generating ? (
              <button
                className="icon-button"
                title={t('取消生成')}
                aria-label={t('取消生成')}
                onClick={() =>
                  void send('CANCEL', { id: requestId || task?.id }).catch((e) =>
                    setError(e.message),
                  )
                }
              >
                <Square size={12} fill="currentColor" strokeWidth={0} />
              </button>
            ) : (
              <button
                className="primary generate"
                title={t('生成并应用')}
                aria-label={t('生成并应用')}
                disabled={locked || !chat.draft.trim() || !origin}
                onClick={() => void generate()}
              >
                <ArrowUp size={16} />
              </button>
            )}
          </div>
        </div>
        <div className="context-actions">
          <button
            className="quiet"
            disabled={locked || !origin}
            onClick={() =>
              void action(async () => {
                await access([pagePattern(tab.url!)]);
                setContext(await send('CONTEXT', { tabId: tab.id, select: true }));
              })
            }
          >
            <MousePointer2 size={15} />
            {t('选择元素')}
          </button>
          <button
            className="quiet"
            disabled={locked || !origin}
            onClick={() =>
              void action(async () => {
                await access([pagePattern(tab.url!)]);
                setContext(await send('CONTEXT', { tabId: tab.id }));
              })
            }
          >
            <FileText size={15} />
            {t('采集摘要')}
          </button>
          {context && (
            <button
              className="icon-button"
              title={t('清除摘要，下次重新采集')}
              aria-label={t('清除摘要')}
              disabled={locked}
              onClick={() => setContext(undefined)}
            >
              <X size={14} />
            </button>
          )}
        </div>
        {context && (
          <details className="context-preview">
            <summary>
              {t('页面摘要 ·')}
              {context.summary.length} {t('字符')}
            </summary>
            <pre>{context.summary}</pre>
          </details>
        )}
        <details className="rules">
          <summary>
            {t('应用范围')}
            <span>
              {lines(patterns).length} {t('条规则')}
            </span>
          </summary>
          <fieldset disabled={locked}>
            <div className="rule-presets">
              <button disabled={!origin} onClick={() => setPatterns(pagePattern(tab.url!))}>
                {t('当前网站')}
              </button>
              <button disabled={!origin} onClick={() => setPatterns(pagePattern(tab.url!, true))}>
                {t('当前路径')}
              </button>
            </div>
            <label>
              {t('匹配规则')}
              <textarea
                className="code compact"
                aria-label={t('匹配规则')}
                value={patterns}
                onChange={(e) => setPatterns(e.target.value)}
              />
            </label>
            <label>
              {t('排除规则')}
              <textarea
                className="code compact"
                aria-label={t('排除规则')}
                value={excludes}
                onChange={(e) => setExcludes(e.target.value)}
              />
            </label>
          </fieldset>
        </details>
      </section>
    </div>
  );
}

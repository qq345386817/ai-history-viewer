import { FolderOpen, SearchX, PanelLeft, X } from "lucide-react";
import { useRef } from "react";
import {
  providerNames,
  type Provider,
  type SessionSummary,
} from "../../shared/types";
import { dayLabel, time } from "../format";
import ReplyToggle from "./ReplyToggle";
import ScrollToBottomButton from "./ScrollToBottomButton";

export default function SessionList({
  sessions,
  activeId,
  onSelect,
  provider,
  onProvider,
  sort,
  onSort,
  query,
  onClear,
  loading,
  error,
  onProjects,
  onRetry,
  includeAssistant,
  onToggle,
}: {
  sessions: SessionSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  provider: Provider | "all" | "custom";
  onProvider: (p: Provider | "all" | "custom") => void;
  sort: string;
  onSort: (s: string) => void;
  query: string;
  onClear: () => void;
  loading: boolean;
  error: string;
  onProjects: () => void;
  onRetry: () => void;
  includeAssistant: boolean;
  onToggle: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const groups = new Map<string, SessionSummary[]>();
  for (const session of sessions) {
    const label = dayLabel(session.updatedAt);
    const group = groups.get(label) || [];
    group.push(session);
    groups.set(label, group);
  }
  return (
    <section className="session-list" aria-label="会话列表">
      <header className="list-header">
        <div className="list-title">
          <button
            className="icon-button projects-toggle"
            onClick={onProjects}
            aria-label="打开项目导航"
          >
            <PanelLeft size={21} />
          </button>
          <h1>会话历史</h1>
          <span>{sessions.length}</span>
          {loading ? (
            <span className="small-spinner" aria-label="正在更新" />
          ) : null}
        </div>
        <div className="filters">
          <select
            aria-label="筛选 AI 工具"
            value={provider}
            onChange={(e) =>
              onProvider(e.target.value as Provider | "all" | "custom")
            }
          >
            <option value="all">全部工具</option>
            {provider === "custom" ? (
              <option value="custom" disabled>
                自定义数据源
              </option>
            ) : null}
            <option value="codex">Codex</option>
            <option value="gemini">Gemini</option>
            <option value="claude">Claude</option>
          </select>
          <select
            aria-label="会话排序"
            value={sort}
            onChange={(e) => onSort(e.target.value)}
          >
            <option value="updated">最近更新</option>
            <option value="oldest">最早更新</option>
          </select>
        </div>
        {query ? (
          <div className="search-query">
            <span>搜索：{query}</span>
            <button
              className="icon-button"
              aria-label="清空搜索"
              onClick={onClear}
            >
              <X size={14} />
            </button>
          </div>
        ) : null}
        <div className="mobile-reply-toggle">
          <ReplyToggle checked={includeAssistant} onToggle={onToggle} />
        </div>
      </header>
      <div
        ref={scrollRef}
        id="session-scroll"
        className="session-scroll"
        aria-busy={loading}
      >
        {error ? (
          <div className="empty compact">
            <p>{error}</p>
            <button className="plain-button" onClick={onRetry}>
              重新连接
            </button>
          </div>
        ) : !sessions.length ? (
          <div className="empty compact">
            {query ? <SearchX size={30} /> : <FolderOpen size={30} />}
            <h2>
              {loading
                ? "正在读取会话…"
                : query
                  ? "没有匹配的会话"
                  : "暂无会话记录"}
            </h2>
            <p>
              {query
                ? "试试项目名、路径或消息中的关键词。"
                : "有新的本地会话时会自动出现在这里。"}
            </p>
          </div>
        ) : (
          [...groups].map(([label, items]) => (
            <div key={label} className="session-group">
              <h2>{label}</h2>
              {items.map((s) => (
                <button
                  key={s.id}
                  className={`session-row ${s.id === activeId ? "selected" : ""}`}
                  onClick={() => onSelect(s.id)}
                  aria-pressed={s.id === activeId}
                >
                  <div className="row-meta">
                    <span>
                      <i className={`dot ${s.provider}`} />
                      {providerNames[s.provider]}
                    </span>
                    <time dateTime={s.updatedAt}>{time(s.updatedAt)}</time>
                  </div>
                  <strong>{s.title}</strong>
                  <p>{s.preview}</p>
                  <small>
                    {s.userCount} 条提问{query ? ` · ${s.projectName}` : ""}
                  </small>
                </button>
              ))}
            </div>
          ))
        )}
      </div>
      {!error && sessions.length > 0 ? (
        <ScrollToBottomButton targetRef={scrollRef} controls="session-scroll" />
      ) : null}
    </section>
  );
}

import {
  ArrowLeft,
  Folder,
  LockKeyhole,
  MessageSquareText,
  RefreshCw,
} from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { providerNames, type Session } from "../../shared/types";
import { shortPath, dateTime } from "../format";
import ReplyToggle from "./ReplyToggle";
import CopyButton from "./CopyButton";
import ScrollToBottomButton from "./ScrollToBottomButton";
import { searchHighlight } from "../searchHighlight";

const markdownPlugins = [remarkGfm];
export default function Reader({
  session,
  selectedId,
  error,
  includeAssistant,
  onToggle,
  connected,
  onRefresh,
  onBack,
  refreshing,
  query,
  ready,
  navigationKey,
  showDetail,
}: {
  session: Session | null;
  selectedId: string | null;
  error: string;
  includeAssistant: boolean;
  onToggle: () => void;
  connected: boolean;
  onRefresh: () => void;
  onBack: () => void;
  refreshing: boolean;
  query: string;
  ready: boolean;
  navigationKey: number;
  showDetail: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const rehypePlugins = useMemo(
    () => [
      [searchHighlight, { query }] as [
        typeof searchHighlight,
        { query: string },
      ],
    ],
    [query],
  );
  useEffect(() => {
    if (!ready) return;
    const frame = requestAnimationFrame(() => {
      const container = scrollRef.current;
      if (!container) return;
      const match = container.querySelector<HTMLElement>(
        "mark[data-search-match]",
      );
      // Raw Markdown searches may include syntax absent from the rendered text.
      const matchingMessage = session?.messages.find((m) =>
        m.content
          .toLocaleLowerCase()
          .includes(query.trim().toLocaleLowerCase()),
      );
      const target =
        match ||
        (query.trim() && matchingMessage
          ? [
              ...container.querySelectorAll<HTMLElement>("[data-message-id]"),
            ].find((el) => el.dataset.messageId === matchingMessage.id)
          : null);
      if (query.trim() && target)
        target.scrollIntoView({
          block: "center",
          inline: "nearest",
          behavior: "instant",
        });
      else container.scrollTo({ top: 0 });
    });
    return () => cancelAnimationFrame(frame);
    // Live message updates deliberately preserve the reader's scroll position.
  }, [selectedId, ready, query, navigationKey, showDetail, includeAssistant]);
  return (
    <main className="reader" aria-label="会话阅读区">
      <div className="reader-topbar">
        <button
          className="icon-button back-button"
          aria-label="返回会话列表"
          onClick={onBack}
        >
          <ArrowLeft size={20} />
        </button>
        <div className="breadcrumb">
          <Folder size={20} />
          <span>{session?.projectName || "选择会话"}</span>
          {session ? (
            <>
              <span className="slash">/</span>
              <span>{providerNames[session.provider]}</span>
            </>
          ) : null}
        </div>
        <div className="sync">
          <span className={`dot ${connected ? "codex" : "offline"}`} />
          <span>{connected ? "自动同步" : "正在重连"}</span>
        </div>
        <button
          className={`icon-button refresh ${refreshing ? "spinning" : ""}`}
          aria-label="刷新会话"
          title="刷新会话"
          onClick={onRefresh}
        >
          <RefreshCw size={19} />
        </button>
      </div>
      {error ? (
        <div className="empty">
          <MessageSquareText size={36} />
          <h2>暂时无法读取会话</h2>
          <p>{error}</p>
          <button className="plain-button" onClick={onRefresh}>
            重试
          </button>
        </div>
      ) : session ? (
        <>
          <header className="reader-header">
            <h2>{session.title}</h2>
            <p
              className="project-path"
              title={session.projectPath || undefined}
            >
              {shortPath(session.projectPath)}
            </p>
            <div className="reader-meta">
              <span>
                {new Date(session.createdAt).toLocaleDateString("zh-CN", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}{" "}
                · {session.userCount} 条提问
              </span>
              <ReplyToggle checked={includeAssistant} onToggle={onToggle} />
            </div>
          </header>
          <div
            ref={scrollRef}
            id="conversation-messages"
            className="messages"
            aria-label="消息内容"
            aria-live="polite"
          >
            {session.messages.map((m) => (
              <article
                className={`message ${m.role}`}
                key={m.id}
                data-message-id={m.id}
              >
                <div className="avatar" aria-hidden="true">
                  {m.role === "user" ? "U" : "AI"}
                </div>
                <div className="message-main">
                  <div className="message-meta">
                    <strong>
                      {m.role === "user"
                        ? "你"
                        : providerNames[session.provider]}
                    </strong>
                    <time
                      dateTime={m.timestamp}
                      title={new Date(m.timestamp).toLocaleString("zh-CN")}
                    >
                      {dateTime(m.timestamp)}
                    </time>
                    <CopyButton content={m.content} />
                  </div>
                  <div className="markdown">
                    <Markdown
                      remarkPlugins={markdownPlugins}
                      rehypePlugins={rehypePlugins}
                      skipHtml
                      components={{
                        a: ({ children, href }) => (
                          <a
                            href={href}
                            target="_blank"
                            rel="noreferrer noopener"
                          >
                            {children}
                          </a>
                        ),
                        img: ({ alt }) => (
                          <span className="attachment">
                            [图片附件{alt ? `：${alt}` : ""}]
                          </span>
                        ),
                        input: ({ checked }) => (
                          <input
                            type="checkbox"
                            checked={checked || false}
                            disabled
                            readOnly
                          />
                        ),
                      }}
                    >
                      {m.content}
                    </Markdown>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </>
      ) : (
        <div className="empty">
          <MessageSquareText size={38} strokeWidth={1.3} />
          <h2>{selectedId ? "正在读取会话…" : "每一次提问，都有迹可循"}</h2>
          <p>
            {selectedId
              ? "会话内容正在从本机加载。"
              : "从左侧选择项目和会话，开始回顾。"}
          </p>
          {!selectedId ? (
            <ReplyToggle checked={includeAssistant} onToggle={onToggle} />
          ) : null}
        </div>
      )}
      {!error && ready && session && session.messages.length > 0 ? (
        <ScrollToBottomButton
          targetRef={scrollRef}
          controls="conversation-messages"
          title="滚动到底部，查看最新消息"
        />
      ) : null}
      <footer className="reader-footer">
        <LockKeyhole size={15} />
        <span>只读浏览 · 原始会话文件不会被修改。</span>
      </footer>
    </main>
  );
}

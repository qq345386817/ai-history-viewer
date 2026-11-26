import { ChevronDown, ChevronUp } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { Message } from "../../shared/types";

type Hit = { element: HTMLElement; messageId: string; occurrence: number };

function collectHits(container: HTMLElement, messages: Message[], query: string): Hit[] {
  const textById = new Map(messages.map((message) => [message.id, message.content]));
  const hits: Hit[] = [];
  for (const article of container.querySelectorAll<HTMLElement>("[data-message-id]")) {
    const messageId = article.dataset.messageId!;
    const marks = article.querySelectorAll<HTMLElement>("mark[data-search-match]");
    marks.forEach((element, occurrence) => hits.push({ element, messageId, occurrence }));
    // A raw Markdown match can exist in syntax that is absent from the rendered text.
    if (!marks.length && textById.get(messageId)?.toLocaleLowerCase().includes(query)) {
      hits.push({ element: article, messageId, occurrence: 0 });
    }
  }
  return hits;
}

export default function ReaderSearch({
  scrollRef,
  messages,
  query,
  scope,
  ready,
}: {
  scrollRef: RefObject<HTMLDivElement | null>;
  messages: Message[];
  query: string;
  scope: string;
  ready: boolean;
}) {
  const navigation = useRef({ hits: [] as Hit[], index: 0, scope: "" });
  const [position, setPosition] = useState({ current: 0, total: 0 });
  const search = query.trim().toLocaleLowerCase();

  const selectHit = useCallback((hits: Hit[], index: number, scope: string, scroll: boolean) => {
    const previous = navigation.current;
    previous.hits[previous.index]?.element.removeAttribute("data-search-current");
    navigation.current = { hits, index, scope };
    const target = hits[index]?.element;
    target?.setAttribute("data-search-current", "");
    if (scroll) {
      target?.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
    }
    const current = target ? index + 1 : 0;
    setPosition((old) => old.current === current && old.total === hits.length
      ? old : { current, total: hits.length });
  }, []);

  useEffect(() => {
    if (!ready) return;
    const frame = requestAnimationFrame(() => {
      const container = scrollRef.current;
      if (!container) return;
      const previous = navigation.current;
      const reset = previous.scope !== scope;
      if (!search && !reset) return;
      const hits = search ? collectHits(container, messages, search) : [];
      const active = previous.hits[previous.index];
      const retained = active ? hits.findIndex((hit) =>
        hit.messageId === active.messageId && hit.occurrence === active.occurrence,
      ) : -1;
      let index = 0;
      if (!reset && hits.length) {
        index = retained >= 0 ? retained : Math.min(previous.index, hits.length - 1);
      }
      // Refresh the count without pulling the reader away from the current scroll position.
      selectHit(hits, index, scope, reset);
      if (reset && hits.length === 0) container.scrollTo({ top: 0 });
    });
    return () => cancelAnimationFrame(frame);
  }, [ready, scope, search, messages, scrollRef, selectHit]);

  function move(direction: number) {
    const current = navigation.current;
    const { hits, index } = current;
    if (current.scope !== scope || hits.length < 2) return;
    selectHit(hits, (index + direction + hits.length) % hits.length, scope, true);
  }

  if (!query.trim()) return null;
  const disabled = !ready || position.total < 2;
  return (
    <div className="reader-search" role="group" aria-label="会话内搜索导航">
      <span role="status" aria-atomic="true" className="reader-search-position">
        {!ready ? "正在查找…" : position.total ? `${position.current} / ${position.total}` : "会话内无匹配"}
      </span>
      <button
        type="button"
        aria-controls="conversation-messages"
        aria-label="上一个匹配"
        title="上一个匹配"
        disabled={disabled}
        onClick={() => move(-1)}
      >
        <ChevronUp size={17} aria-hidden="true" />
      </button>
      <button
        type="button"
        aria-controls="conversation-messages"
        aria-label="下一个匹配"
        title="下一个匹配"
        disabled={disabled}
        onClick={() => move(1)}
      >
        <ChevronDown size={17} aria-hidden="true" />
      </button>
    </div>
  );
}

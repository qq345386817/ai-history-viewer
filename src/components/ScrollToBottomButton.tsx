import { ArrowDownToLine } from "lucide-react";
import type { RefObject } from "react";

export default function ScrollToBottomButton({
  targetRef,
  controls,
  title = "滚动到底部",
}: {
  targetRef: RefObject<HTMLDivElement | null>;
  controls: string;
  title?: string;
}) {
  function scrollToBottom() {
    const container = targetRef.current;
    if (!container) return;
    container.scrollTo({
      top: container.scrollHeight,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  }

  return (
    <button
      type="button"
      className="scroll-bottom-button"
      aria-label="滚动到底部"
      aria-controls={controls}
      title={title}
      onClick={scrollToBottom}
    >
      <ArrowDownToLine size={16} aria-hidden="true" />
      滚动到底部
    </button>
  );
}

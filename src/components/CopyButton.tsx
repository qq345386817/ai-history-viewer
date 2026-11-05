import { Check, Copy, AlertCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export default function CopyButton({ content }: { content: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  async function copy() {
    clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(content);
      setStatus("copied");
    } catch {
      setStatus("error");
    }
    timer.current = setTimeout(() => setStatus("idle"), 2500);
  }
  const label =
    status === "copied" ? "已复制" : status === "error" ? "复制失败" : "复制";
  return (
    <button
      className={`copy-message ${status}`}
      onClick={copy}
      aria-label="复制消息内容"
      title={
        status === "error"
          ? "无法访问剪贴板，请选择文本手动复制"
          : "复制原始文本（保留 Markdown）"
      }
    >
      {status === "copied" ? (
        <Check size={14} />
      ) : status === "error" ? (
        <AlertCircle size={14} />
      ) : (
        <Copy size={14} />
      )}
      <span aria-live="polite">{label}</span>
    </button>
  );
}

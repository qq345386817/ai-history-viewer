export default function ReplyToggle({
  checked,
  onToggle,
}: {
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      className="reply-toggle"
      role="switch"
      aria-checked={checked}
      aria-label="显示 AI 回复"
      onClick={onToggle}
    >
      <span className={`toggle-track ${checked ? "on" : ""}`}>
        <span />
      </span>
      显示 AI 回复
    </button>
  );
}

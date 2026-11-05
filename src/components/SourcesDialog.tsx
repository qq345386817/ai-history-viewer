import { useEffect, useRef } from "react";
import { Database, X } from "lucide-react";
import { providerNames, type Catalog } from "../../shared/types";

export default function SourcesDialog({
  open,
  onClose,
  catalog,
}: {
  open: boolean;
  onClose: () => void;
  catalog: Catalog | null;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);
  return (
    <dialog
      ref={dialog}
      className="sources-dialog"
      aria-labelledby="sources-title"
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="dialog-content">
        <header>
          <h2 id="sources-title">
            <Database size={21} />
            本地数据源
          </h2>
          <button
            className="icon-button"
            aria-label="关闭数据源"
            onClick={onClose}
          >
            <X size={21} />
          </button>
        </header>
        <p>自动发现本地会话，只读访问，不上传任何会话内容。</p>
        <div className="source-items">
          {catalog?.sources.map((source) => (
            <section key={source.provider}>
              <div className="source-heading">
                <strong>
                  <span className={`dot ${source.provider}`} />
                  {providerNames[source.provider]}
                  {source.provider === "gemini"
                    ? " CLI"
                    : source.provider === "claude"
                      ? " Code"
                      : ""}
                </strong>
                <span>
                  {source.available
                    ? `${source.sessions} 个会话`
                    : "未发现目录"}
                </span>
              </div>
              <code>{source.root}</code>
              <small>
                {source.files} 个记录文件
                {source.errors
                  ? ` · ${source.errors} 个文件或目录暂时无法读取，正在自动重试`
                  : ""}
              </small>
            </section>
          ))}
        </div>
        <p className="source-note">
          Codex 包含已归档会话。Gemini
          通过项目注册信息和已知路径还原项目；无法识别的项目会保留独立分组。
        </p>
        <p className="source-note">
          自定义目录与项目映射：启动时传入{" "}
          <code>--config config.local.json</code>，详见项目 README。
        </p>
        <div className="dialog-footer">
          {catalog?.scannedAt
            ? `最近更新：${new Date(catalog.scannedAt).toLocaleString("zh-CN")}`
            : "正在扫描…"}
        </div>
      </div>
    </dialog>
  );
}

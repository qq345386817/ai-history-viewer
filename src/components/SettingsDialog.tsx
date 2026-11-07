import { useEffect, useRef } from "react";
import { Check, Database, Palette, Settings, X } from "lucide-react";
import { providerNames, type Catalog, type Provider } from "../../shared/types";
import ThemeControl from "./ThemeControl";

const sourceProviders: Provider[] = ["codex", "gemini", "claude"];

export default function SettingsDialog({
  open,
  onClose,
  catalog,
  providers,
  onToggleProvider,
}: {
  open: boolean;
  onClose: () => void;
  catalog: Catalog | null;
  providers: Provider[];
  onToggleProvider: (provider: Provider) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);
  return (
    <dialog
      ref={dialog}
      id="settings-dialog"
      className="settings-dialog"
      aria-labelledby="settings-title"
      onCancel={onClose}
      onKeyDown={(event) => {
        // Escape closes this dialog without also dismissing the mobile drawer.
        if (event.key === "Escape") event.stopPropagation();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <header className="settings-header">
        <h2 id="settings-title">
          <Settings size={21} />
          设置
        </h2>
        <button
          className="icon-button"
          aria-label="关闭设置"
          onClick={onClose}
        >
          <X size={21} />
        </button>
      </header>
      <div className="settings-body">
        <section className="settings-section" aria-labelledby="appearance-title">
          <h3 id="appearance-title">
            <Palette size={18} />
            外观
          </h3>
          <p>选择显示主题，默认跟随系统。</p>
          <ThemeControl />
        </section>
        <section className="settings-section" aria-labelledby="sources-title">
          <h3 id="sources-title">
            <Database size={18} />
            本地数据源
          </h3>
          <p>
            选择要显示的会话来源，可多选，立即生效。仅在本机读取，不上传会话内容。
          </p>
          <div className="source-items">
            {sourceProviders.map((provider) => {
              const source = catalog?.sources.find(
                (item) => item.provider === provider,
              );
              const selected = providers.includes(provider);
              return (
                <section key={provider}>
                  <button
                    type="button"
                    className="source-heading source-toggle"
                    aria-label={`筛选 ${providerNames[provider]}`}
                    aria-pressed={selected}
                    onClick={() => onToggleProvider(provider)}
                  >
                    <strong>
                      <span className="source-check" aria-hidden="true">
                        {selected ? <Check size={12} /> : null}
                      </span>
                      <span className={`dot ${provider}`} />
                      {providerNames[provider]}
                      {provider === "gemini"
                        ? " CLI"
                        : provider === "claude"
                          ? " Code"
                          : ""}
                    </strong>
                    <span>
                      {!source
                        ? "正在读取…"
                        : source.available
                          ? `${source.sessions} 个会话`
                          : "未发现目录"}
                    </span>
                  </button>
                  {source ? (
                    <>
                      <code>{source.root}</code>
                      <small>
                        {source.files} 个记录文件
                        {source.errors
                          ? ` · ${source.errors} 个文件或目录暂时无法读取，正在自动重试`
                          : ""}
                      </small>
                    </>
                  ) : (
                    <small className="source-loading">正在读取数据源信息…</small>
                  )}
                </section>
              );
            })}
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
        </section>
      </div>
    </dialog>
  );
}

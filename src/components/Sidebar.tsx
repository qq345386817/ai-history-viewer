import {
  Check,
  Database,
  Folder,
  Layers,
  LockKeyhole,
  MessageSquareText,
  Search,
  X,
} from "lucide-react";
import {
  providerNames,
  type Catalog,
  type Project,
  type Provider,
} from "../../shared/types";
import { shortPath } from "../format";
import type { RefObject } from "react";
import ThemeControl from "./ThemeControl";

export default function Sidebar({
  catalog,
  projects,
  providers,
  onToggleProvider,
  projectId,
  onProject,
  query,
  onQuery,
  searchRef,
  onSources,
  mobileOpen,
  onClose,
}: {
  catalog: Catalog | null;
  projects: Project[];
  providers: Provider[];
  onToggleProvider: (provider: Provider) => void;
  projectId: string;
  onProject: (id: string) => void;
  query: string;
  onQuery: (query: string) => void;
  searchRef: RefObject<HTMLInputElement | null>;
  onSources: () => void;
  mobileOpen: boolean;
  onClose: () => void;
}) {
  const total = projects.reduce((n, p) => n + p.count, 0);
  return (
    <>
      {mobileOpen ? (
        <button
          className="sidebar-backdrop"
          aria-label="关闭项目导航"
          onClick={onClose}
        />
      ) : null}
      <aside
        className={`sidebar ${mobileOpen ? "is-open" : ""}`}
        aria-label="项目导航"
      >
        <div className="brand">
          <MessageSquareText size={27} strokeWidth={1.8} />
          <strong>回声</strong>
          <span>Echo</span>
          <button
            className="icon-button close-sidebar"
            onClick={onClose}
            aria-label="关闭项目导航"
          >
            <X size={19} />
          </button>
        </div>
        <label className="search">
          <Search size={17} />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="搜索全部项目会话…"
            aria-label="搜索会话"
          />
          <kbd>⌘ K</kbd>
        </label>
        <div className="nav-label">项目</div>
        <nav className="projects">
          <button
            className={`project all-projects ${projectId === "all" ? "selected" : ""}`}
            onClick={() => onProject("all")}
            aria-pressed={projectId === "all"}
          >
            <Layers size={19} />
            <span>全部项目</span>
            <span className="count">{total}</span>
          </button>
          {projects.map((project) => (
            <button
              className={`project ${projectId === project.id ? "selected" : ""}`}
              key={project.id}
              onClick={() => onProject(project.id)}
              aria-pressed={projectId === project.id}
              title={project.path || project.name}
            >
              <Folder size={19} />
              <span className="project-copy">
                <span>{project.name}</span>
                <small>{shortPath(project.path)}</small>
              </span>
              <span className="count">{project.count}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="provider-legend">
            {(["codex", "gemini", "claude"] as Provider[]).map((provider) => (
              <button
                type="button"
                key={provider}
                className={`provider-filter ${providers.includes(provider) ? "active" : ""}`}
                aria-label={`筛选 ${providerNames[provider]}`}
                aria-pressed={providers.includes(provider)}
                onClick={() => onToggleProvider(provider)}
              >
                <span className="provider-check">
                  {providers.includes(provider) ? <Check size={12} /> : null}
                </span>
                <span className={`dot ${provider}`} />
                <span>{providerNames[provider]}</span>
                <span className="legend-count">
                  {catalog?.sources.find((s) => s.provider === provider)
                    ?.sessions ?? "—"}
                </span>
              </button>
            ))}
          </div>
          <button className="sources-button" onClick={onSources}>
            <Database size={17} />
            数据源
          </button>
          <ThemeControl />
          <p className="readonly">
            <LockKeyhole size={13} />
            只读访问
          </p>
        </div>
      </aside>
    </>
  );
}

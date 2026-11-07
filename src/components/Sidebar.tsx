import {
  Settings,
  Folder,
  Layers,
  LockKeyhole,
  MessageSquareText,
  Search,
  X,
} from "lucide-react";
import type { Project } from "../../shared/types";
import { shortPath } from "../format";
import type { RefObject } from "react";

export default function Sidebar({
  projects,
  projectId,
  onProject,
  query,
  onQuery,
  searchRef,
  onSettings,
  mobileOpen,
  onClose,
}: {
  projects: Project[];
  projectId: string;
  onProject: (id: string) => void;
  query: string;
  onQuery: (query: string) => void;
  searchRef: RefObject<HTMLInputElement | null>;
  onSettings: () => void;
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
          <button
            className="settings-button"
            onClick={onSettings}
            aria-haspopup="dialog"
            aria-controls="settings-dialog"
          >
            <Settings size={17} />
            设置
          </button>
          <p className="readonly">
            <LockKeyhole size={13} />
            只读访问
          </p>
        </div>
      </aside>
    </>
  );
}

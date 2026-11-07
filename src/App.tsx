import { useEffect, useMemo, useRef, useState } from "react";
import type { Provider } from "../shared/types";
import Sidebar from "./components/Sidebar";
import SessionList from "./components/SessionList";
import Reader from "./components/Reader";
import SettingsDialog from "./components/SettingsDialog";
import { useHistory, useSession } from "./hooks/useHistory";

export default function App() {
  const [query, setQuery] = useState("");
  const [projectId, setProjectId] = useState("all");
  const [providers, setProviders] = useState<Provider[]>([
    "codex",
    "gemini",
    "claude",
  ]);
  const [navigationKey, setNavigationKey] = useState(0);
  const [sort, setSort] = useState("updated");
  const [includeAssistant, setIncludeAssistant] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const { catalog, error, connected, loading, refresh, refreshKey } =
    useHistory(query, includeAssistant);
  const projects = useMemo(
    () =>
      (catalog?.projects || [])
        .map((p) => ({
          ...p,
          count: providers.reduce(
            (sum, provider) => sum + (p.providerCounts[provider] || 0),
            0,
          ),
        }))
        .filter((p) => p.count > 0),
    [catalog, providers],
  );
  const effectiveProject =
    query.trim() || !projects.some((p) => p.id === projectId)
      ? "all"
      : projectId;
  const sessions = useMemo(() => {
    const items = (catalog?.sessions || []).filter(
      (s) =>
        (effectiveProject === "all" || s.projectId === effectiveProject) &&
        providers.includes(s.provider),
    );
    if (sort === "oldest") items.reverse();
    return items;
  }, [catalog, effectiveProject, providers, sort]);
  const activeId = sessions.some((s) => s.id === selectedId)
    ? selectedId
    : sessions[0]?.id || null;
  // Keep the open conversation stable when a newer session arrives in the background.
  useEffect(() => {
    setSelectedId(activeId);
  }, [activeId]);
  const {
    session,
    ready,
    error: sessionError,
  } = useSession(
    activeId,
    includeAssistant,
    catalog?.revision || 0,
    refreshKey,
  );
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setMobileOpen(true);
        requestAnimationFrame(() => searchRef.current?.focus());
      }
      if (event.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className={`app ${showDetail ? "show-detail" : ""}`}>
      <Sidebar
        projects={projects}
        projectId={effectiveProject}
        onProject={(id) => {
          setQuery("");
          setProjectId(id);
          setSelectedId(null);
          setMobileOpen(false);
          setShowDetail(false);
        }}
        query={query}
        onQuery={(value) => {
          setQuery(value);
          setProjectId("all");
          setShowDetail(false);
        }}
        searchRef={searchRef}
        onSettings={() => setSettingsOpen(true)}
        mobileOpen={mobileOpen}
        onClose={() => setMobileOpen(false)}
      />
      <SessionList
        sessions={sessions}
        activeId={activeId}
        onSelect={(id) => {
          setSelectedId(id);
          setNavigationKey((k) => k + 1);
          setShowDetail(true);
        }}
        provider={
          providers.length === 3
            ? "all"
            : providers.length === 1
              ? providers[0]
              : "custom"
        }
        onProvider={(value) => {
          if (value !== "custom")
            setProviders(
              value === "all" ? ["codex", "gemini", "claude"] : [value],
            );
        }}
        sort={sort}
        onSort={setSort}
        query={query}
        onClear={() => setQuery("")}
        loading={loading || !!catalog?.scanning}
        error={error}
        onProjects={() => setMobileOpen(true)}
        onRetry={refresh}
        includeAssistant={includeAssistant}
        onToggle={() => setIncludeAssistant((v) => !v)}
      />
      <Reader
        session={session}
        ready={ready}
        query={query}
        navigationKey={navigationKey}
        showDetail={showDetail}
        selectedId={activeId}
        error={sessionError}
        includeAssistant={includeAssistant}
        onToggle={() => setIncludeAssistant((v) => !v)}
        connected={connected}
        onRefresh={refresh}
        onBack={() => setShowDetail(false)}
        refreshing={loading}
      />
      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        catalog={catalog}
        providers={providers}
        onToggleProvider={(provider) =>
          setProviders((current) =>
            current.includes(provider)
              ? current.filter((value) => value !== provider)
              : [...current, provider],
          )
        }
      />
    </div>
  );
}

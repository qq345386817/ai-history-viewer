import { useEffect, useState } from "react";
import type { Catalog, Session } from "../../shared/types";

async function getJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal, cache: "no-store" });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "无法连接本机服务");
  }
  return response.json();
}
export function useHistory(query: string, includeAssistant: boolean) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);
  const [revision, setRevision] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [search, setSearch] = useState(query);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query), 180);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    const events = new EventSource("/api/events");
    events.onopen = () => {
      setConnected(true);
      setRefreshKey((k) => k + 1);
    };
    events.onerror = () => setConnected(false);
    events.addEventListener("change", (event) => {
      setRevision(JSON.parse(event.data).revision);
    });
    return () => events.close();
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    const params = new URLSearchParams({
      q: search,
      includeAssistant: String(includeAssistant),
    });
    getJson<Catalog>(`/api/catalog?${params}`, abort.signal)
      .then((data) => {
        setCatalog(data);
        setError("");
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [search, includeAssistant, revision, refreshKey]);
  return {
    catalog,
    error,
    connected,
    loading,
    refreshKey,
    refresh: () => setRefreshKey((k) => k + 1),
  };
}
export function useSession(
  id: string | null,
  includeAssistant: boolean,
  revision: number,
  refreshKey: number,
) {
  const [loaded, setLoaded] = useState<{
    session: Session;
    includeAssistant: boolean;
  } | null>(null);
  const session = loaded?.session;
  const [error, setError] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    setError("");
    if (!id) {
      setLoaded(null);
      return;
    }
    getJson<Session>(
      `/api/sessions/${encodeURIComponent(id)}?includeAssistant=${includeAssistant}`,
      abort.signal,
    )
      .then((data) => {
        setLoaded({ session: data, includeAssistant });
        setError("");
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, [id, includeAssistant, revision, refreshKey]);
  // Filter again locally so switching OFF never leaves an earlier reply visible while fetching.
  return {
    ready: session?.id === id && loaded?.includeAssistant === includeAssistant,
    session:
      session?.id === id
        ? {
            ...session,
            messages: session.messages.filter(
              (m) => includeAssistant || m.role === "user",
            ),
          }
        : null,
    error,
  };
}

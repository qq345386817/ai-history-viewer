import { useCallback, useEffect, useState } from "react";

export const SEARCH_HISTORY_STORAGE_KEY = "echo-search-history";
export const MAX_SEARCH_HISTORY = 10;

export function parseSearchHistory(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const items: string[] = [];
    for (const entry of parsed) {
      if (typeof entry !== "string") continue;
      const trimmed = entry.trim();
      if (!trimmed) continue;
      const key = trimmed.toLocaleLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(trimmed);
      if (items.length >= MAX_SEARCH_HISTORY) break;
    }
    return items;
  } catch {
    return [];
  }
}

export function addSearchHistoryItem(
  current: string[],
  rawTerm: string,
  limit = MAX_SEARCH_HISTORY,
): string[] {
  const term = rawTerm.trim();
  if (!term) return current;
  const key = term.toLocaleLowerCase();
  if (current[0] === term) return current;
  const next = [
    term,
    ...current.filter((item) => item.toLocaleLowerCase() !== key),
  ];
  return next.slice(0, limit);
}

export function removeSearchHistoryItem(
  current: string[],
  rawTerm: string,
): string[] {
  const key = rawTerm.trim().toLocaleLowerCase();
  return current.filter((item) => item.toLocaleLowerCase() !== key);
}

export function filterSearchHistory(history: string[], rawQuery: string): string[] {
  const needle = rawQuery.trim().toLocaleLowerCase();
  if (!needle) return history;
  const prefix: string[] = [];
  const contains: string[] = [];
  for (const item of history) {
    const lower = item.toLocaleLowerCase();
    if (lower === needle) continue;
    const index = lower.indexOf(needle);
    if (index === 0) prefix.push(item);
    else if (index > 0) contains.push(item);
  }
  return [...prefix, ...contains];
}

function readStoredHistory(): string[] {
  try {
    return parseSearchHistory(localStorage.getItem(SEARCH_HISTORY_STORAGE_KEY));
  } catch {
    return [];
  }
}

function writeStoredHistory(items: string[]) {
  try {
    if (items.length) {
      localStorage.setItem(SEARCH_HISTORY_STORAGE_KEY, JSON.stringify(items));
    } else {
      localStorage.removeItem(SEARCH_HISTORY_STORAGE_KEY);
    }
  } catch {
    // Keep search history usable for this page when storage is unavailable.
  }
}

export function useSearchHistory() {
  const [history, setHistory] = useState<string[]>(readStoredHistory);

  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === SEARCH_HISTORY_STORAGE_KEY || event.key === null) {
        setHistory(parseSearchHistory(event.newValue));
      }
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);

  const record = useCallback((term: string) => {
    setHistory((current) => {
      const next = addSearchHistoryItem(current, term);
      if (next !== current) writeStoredHistory(next);
      return next;
    });
  }, []);

  const remove = useCallback((term: string) => {
    setHistory((current) => {
      const next = removeSearchHistoryItem(current, term);
      if (next.length !== current.length) writeStoredHistory(next);
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setHistory((current) => {
      if (!current.length) return current;
      writeStoredHistory([]);
      return [];
    });
  }, []);

  return { history, record, remove, clear };
}

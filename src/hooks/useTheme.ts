import { useEffect, useState } from "react";

export type ThemePreference = "system" | "light" | "dark";
const storageKey = "echo-theme";

function parsePreference(value: string | null | undefined): ThemePreference {
  return value === "light" || value === "dark" ? value : "system";
}

export function useTheme() {
  const [preference, setPreference] = useState<ThemePreference>(() =>
    parsePreference(document.documentElement.dataset.themePreference),
  );

  useEffect(() => {
    const system = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const theme = preference === "system"
        ? (system.matches ? "dark" : "light")
        : preference;
      document.documentElement.dataset.themePreference = preference;
      document.documentElement.dataset.theme = theme;
      document.querySelector('meta[name="theme-color"]')?.setAttribute(
        "content", theme === "dark" ? "#171c22" : "#f3f5f7",
      );
    };
    apply();
    system.addEventListener("change", apply);
    return () => system.removeEventListener("change", apply);
  }, [preference]);

  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === storageKey || event.key === null)
        setPreference(parsePreference(event.newValue));
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);

  function changePreference(value: ThemePreference) {
    setPreference(value);
    try {
      localStorage.setItem(storageKey, value);
    } catch {
      // Keep the selection usable for this page when storage is unavailable.
    }
  }

  return { preference, changePreference };
}

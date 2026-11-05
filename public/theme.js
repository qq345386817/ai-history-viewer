// Apply the saved appearance before styles and React load, including with a strict CSP.
(() => {
  let preference = "system";
  try {
    const saved = localStorage.getItem("echo-theme");
    if (saved === "light" || saved === "dark") preference = saved;
  } catch {
    // System appearance still works when browser storage is unavailable.
  }
  const theme = preference === "system"
    ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : preference;
  document.documentElement.dataset.themePreference = preference;
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute(
    "content", theme === "dark" ? "#171c22" : "#f3f5f7",
  );
})();

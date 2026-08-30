const STORAGE_KEY = "quantify-ticker-collapsed";

export function readTickerCollapsed(): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeTickerCollapsed(collapsed: boolean) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0");
  } catch {
    // Ignore quota / private-mode failures
  }
}

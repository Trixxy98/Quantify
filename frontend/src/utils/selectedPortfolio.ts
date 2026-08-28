const storageKey = (userId: string) => `quantify-selected-portfolio:${userId}`;

export function readSelectedPortfolioId(userId: string | undefined): string | undefined {
  if (!userId || typeof localStorage === "undefined") return undefined;
  try {
    return localStorage.getItem(storageKey(userId)) || undefined;
  } catch {
    return undefined;
  }
}

export function writeSelectedPortfolioId(userId: string | undefined, portfolioId: string | undefined) {
  if (!userId || typeof localStorage === "undefined") return;
  try {
    if (!portfolioId) {
      localStorage.removeItem(storageKey(userId));
      return;
    }
    localStorage.setItem(storageKey(userId), portfolioId);
  } catch {
    // Ignore quota / private-mode failures
  }
}

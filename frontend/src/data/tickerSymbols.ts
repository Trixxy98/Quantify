/** Fixed watchlist for the ticker tape. Yahoo symbols on the left, tape label on the right. */
export const TICKER_SYMBOLS: {symbol: string; label: string}[] = [
  {symbol: "SPY", label: "SPY"},
  {symbol: "QQQ", label: "QQQ"},
  {symbol: "AAPL", label: "AAPL"},
  {symbol: "NVDA", label: "NVDA"},
  {symbol: "^KLSE", label: "KLCI"},
  {symbol: "MYR=X", label: "USD/MYR"},
];

export const TICKER_LABELS = new Map(TICKER_SYMBOLS.map((row) => [row.symbol, row.label]));

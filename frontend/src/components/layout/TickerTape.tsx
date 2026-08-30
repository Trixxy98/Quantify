import { useState } from "react";
import { TICKER_LABELS, TICKER_SYMBOLS } from "../../data/tickerSymbols";
import { useTickerQuotes } from "../../hooks/useTickerQuotes";
import { readTickerCollapsed, writeTickerCollapsed } from "../../utils/tickerPrefs";
import { formatNumber, formatPct, toneClass } from "../../utils/format";
import type { TickerQuote } from "../../types/api.types";

const SYMBOLS = TICKER_SYMBOLS.map((row) => row.symbol);

function priceDigits(symbol: string) {
  return symbol.includes("=X") ? 4 : 2;
}

function TickerItem({ quote }: { quote: TickerQuote }) {
  const label = TICKER_LABELS.get(quote.symbol) ?? quote.symbol;
  const arrow = quote.changePercent > 0 ? "▲" : quote.changePercent < 0 ? "▼" : "·";
  const asOf = quote.asOf ? ` · ${new Date(quote.asOf).toLocaleString()}` : "";

  return (
    <span
      className="flex shrink-0 items-center gap-2.5 px-5 text-sm"
      title={`${quote.name} · ${quote.marketState}${asOf}`}
    >
      <span className="font-semibold">{label}</span>
      <span className="tabular-nums text-[var(--color-text-muted)]">
        {formatNumber(quote.price, priceDigits(quote.symbol))}
      </span>
      <span className={`tabular-nums ${toneClass(quote.changePercent)}`}>
        {arrow} {formatPct(quote.changePercent)}
      </span>
    </span>
  );
}

export function TickerTape() {
  const [isCollapsed, setIsCollapsed] = useState(readTickerCollapsed);
  const { data, isError, dataUpdatedAt } = useTickerQuotes(SYMBOLS, !isCollapsed);

  function toggle(collapsed: boolean) {
    setIsCollapsed(collapsed);
    writeTickerCollapsed(collapsed);
  }

  if (isCollapsed) {
    return (
      <button
        type="button"
        onClick={() => toggle(false)}
        className="fixed bottom-4 right-4 z-30 rounded-full border border-slate-700 bg-[var(--color-surface)] px-4 py-2 text-sm text-[var(--color-text-muted)] shadow-lg hover:text-[var(--color-text)]"
      >
        Show ticker ▲
      </button>
    );
  }

  const quotes = data ?? [];
  const isLive = quotes.some((quote) => quote.marketState === "REGULAR");
  const items = quotes.map((quote) => <TickerItem key={quote.symbol} quote={quote} />);

  return (
    <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-slate-800 bg-[var(--color-bg)]">
      <div className="mx-auto flex max-w-7xl items-center gap-4 px-6">
        <span className="flex shrink-0 items-center gap-2 text-sm text-[var(--color-text-muted)]">
          <span
            className={`h-2.5 w-2.5 rounded-full ${
              isLive ? "animate-pulse bg-[var(--color-accent)]" : "bg-slate-600"
            }`}
          />
          {isLive ? "Live" : "Closed"}
        </span>

        {isError ? (
          <span className="flex-1 py-3.5 text-sm text-[var(--color-text-muted)]">
            Quotes unavailable — retrying
          </span>
        ) : quotes.length === 0 ? (
          <span className="flex-1 py-3.5 text-sm text-[var(--color-text-muted)]">Loading quotes…</span>
        ) : (
          <div className="ticker-viewport min-w-0 flex-1">
            <div className="ticker-track">
              <div className="flex items-center py-3.5">{items}</div>
              <div className="flex items-center py-3.5" aria-hidden="true">
                {items}
              </div>
            </div>
          </div>
        )}

        {dataUpdatedAt > 0 && (
          <span className="hidden shrink-0 text-sm text-[var(--color-text-muted)] tabular-nums sm:inline">
            {new Date(dataUpdatedAt).toLocaleTimeString([], {hour: "2-digit", minute: "2-digit"})}
          </span>
        )}
        <button
          type="button"
          onClick={() => toggle(true)}
          aria-label="Hide ticker"
          className="shrink-0 px-1 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
        >
          ▼
        </button>
      </div>
    </div>
  );
}

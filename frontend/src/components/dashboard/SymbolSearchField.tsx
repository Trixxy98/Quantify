import { useEffect, useId, useMemo, useState } from "react";
import { POPULAR_SYMBOLS } from "../../data/popularSymbols";
import { useSymbolSearch } from "../../hooks/useSymbolSearch";
import type { Holding, SymbolSearchHit } from "../../types/api.types";

type Props = {
  id: string;
  value: string;
  onChange: (symbol: string) => void;
  className: string;
  holdings?: Holding[];
};

function useDebouncedValue(value: string, delayMs: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

function matchesQuery(hit: SymbolSearchHit, query: string) {
  if (!query) return true;
  const q = query.toLowerCase();
  return hit.symbol.toLowerCase().includes(q) || hit.name.toLowerCase().includes(q);
}

function mergeHits(...lists: SymbolSearchHit[][]) {
  const seen = new Set<string>();
  const merged: SymbolSearchHit[] = [];
  for (const list of lists) {
    for (const hit of list) {
      const key = hit.symbol.toUpperCase();
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(hit);
    }
  }
  return merged;
}

function holdingHits(holdings: Holding[] | undefined): SymbolSearchHit[] {
  return (holdings ?? []).map((h) => ({
    symbol: h.symbol,
    name: "In this portfolio",
    exchange: h.exchange === "BURSA" ? "Bursa Malaysia" : "US",
  }));
}

function HitButton({
  hit,
  onSelect,
}: {
  hit: SymbolSearchHit;
  onSelect: (symbol: string) => void;
}) {
  return (
    <li role="option">
      <button
        type="button"
        className="w-full text-left px-3 py-2 hover:bg-slate-800/80"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onSelect(hit.symbol)}
      >
        <span className="font-medium">{hit.symbol}</span>
        <span className="text-[var(--color-text-muted)]"> · {hit.name}</span>
        <span className="block text-xs text-[var(--color-text-muted)]">{hit.exchange}</span>
      </button>
    </li>
  );
}

export function SymbolSearchField({ id, value, onChange, className, holdings }: Props) {
  const listId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const query = value.trim();
  const debounced = useDebouncedValue(value, 300);
  const { data, isFetching, isError } = useSymbolSearch(debounced);
  const remoteHits = data ?? [];

  const holdingsList = useMemo(
    () => holdingHits(holdings).filter((hit) => matchesQuery(hit, query)),
    [holdings, query]
  );
  const popularList = useMemo(
    () => POPULAR_SYMBOLS.filter((hit) => matchesQuery(hit, query)),
    [query]
  );
  const otherHits = useMemo(
    () => mergeHits(popularList, remoteHits).filter((hit) => !holdingsList.some((h) => h.symbol === hit.symbol)),
    [popularList, remoteHits, holdingsList]
  );

  function selectSymbol(symbol: string) {
    onChange(symbol);
    setIsOpen(false);
  }

  return (
    <div className="relative">
      <input
        id={id}
        required
        autoComplete="off"
        role="combobox"
        aria-expanded={isOpen}
        aria-controls={listId}
        placeholder="Search or pick a symbol"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setIsOpen(true);
        }}
        onFocus={() => setIsOpen(true)}
        onBlur={() => {
          window.setTimeout(() => setIsOpen(false), 150);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") setIsOpen(false);
        }}
        className={`${className} pr-8`}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label="Open symbol list"
        className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setIsOpen((open) => !open)}
      >
        ▾
      </button>
      {isOpen && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 w-full max-h-72 overflow-auto rounded-md border border-slate-600 bg-[var(--color-surface)] text-sm shadow-lg"
        >
          {holdingsList.length > 0 && (
            <>
              <li className="px-3 py-1.5 text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
                Holdings
              </li>
              {holdingsList.map((hit) => (
                <HitButton key={`h-${hit.symbol}`} hit={hit} onSelect={selectSymbol} />
              ))}
            </>
          )}
          <li className="px-3 py-1.5 text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
            Symbols
          </li>
          {query.length >= 2 && isFetching && otherHits.length === 0 && (
            <li className="px-3 py-2 text-[var(--color-text-muted)]">Searching...</li>
          )}
          {query.length >= 2 && isError && (
            <li className="px-3 py-2 text-[var(--color-text-muted)]">
              Search unavailable — pick from the list or type the ticker
            </li>
          )}
          {otherHits.map((hit) => (
            <HitButton key={hit.symbol} hit={hit} onSelect={selectSymbol} />
          ))}
          {holdingsList.length === 0 && otherHits.length === 0 && !isFetching && (
            <li className="px-3 py-2 text-[var(--color-text-muted)]">No matches</li>
          )}
        </ul>
      )}
    </div>
  );
}

import { SymbolSearchField } from "../dashboard/SymbolSearchField";
import type { EventType, Holding } from "../../types/api.types";

export type StudySettings = {
  type: EventType;
  symbol: string;
  pooled: boolean;
  pre: number;
  post: number;
  years: number;
  hold: number;
};

type Props = {
  value: StudySettings;
  onChange: (patch: Partial<StudySettings>) => void;
  usHoldings: Holding[];
  pooledSymbols: string[];
};

const EVENT_TYPES: {id: EventType; label: string}[] = [
  {id: "FOMC", label: "Fed days"},
  {id: "CPI", label: "CPI"},
  {id: "EARNINGS", label: "Earnings"},
];

const QUICK_SYMBOLS = ["SPY", "QQQ", "AAPL", "MSFT", "NVDA", "TSLA"];

const PRE_DAYS = [3, 5, 10];
const POST_DAYS = [5, 10, 20];
const YEARS = [2, 3, 4, 5, 6];
const HOLD_DAYS = [1, 2, 3, 5, 10];

function chipClass(active: boolean) {
  return `rounded-md px-2.5 py-1 text-xs ${
    active
      ? "bg-[var(--color-accent)] text-slate-900"
      : "bg-[var(--color-surface)] text-[var(--color-text-muted)]"
  }`;
}

function NumberSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: number;
  options: number[];
  onChange: (next: number) => void;
}) {
  return (
    <label className="text-xs text-[var(--color-text-muted)]">
      {label}
      <select
        className="ml-2 rounded-md border border-slate-600 bg-transparent px-2 py-1 text-sm text-[var(--color-text)]"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

export function EventControls({ value, onChange, usHoldings, pooledSymbols }: Props) {
  const canPool = usHoldings.length > 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {EVENT_TYPES.map((type) => (
          <button
            key={type.id}
            type="button"
            onClick={() => onChange({type: type.id})}
            className={chipClass(value.type === type.id)}
          >
            {type.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {QUICK_SYMBOLS.map((symbol) => (
          <button
            key={symbol}
            type="button"
            onClick={() => onChange({symbol, pooled: false})}
            className={chipClass(!value.pooled && value.symbol === symbol)}
          >
            {symbol}
          </button>
        ))}
        <div className="min-w-[12rem] flex-1">
          <SymbolSearchField
            id="event-symbol"
            value={value.symbol}
            onChange={(next) => onChange({symbol: next.trim().toUpperCase(), pooled: false})}
            className="w-full max-w-sm rounded-md bg-transparent border border-slate-600 px-3 py-2 text-sm"
            holdings={usHoldings}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <label className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
          <input
            type="checkbox"
            checked={value.pooled}
            disabled={!canPool}
            onChange={(e) => onChange({pooled: e.target.checked})}
            className="accent-[var(--color-accent)]"
          />
          Pool my US holdings
          <span>
            {canPool ? `(${pooledSymbols.length} symbols)` : "(none in this portfolio)"}
          </span>
        </label>
        <NumberSelect
          label="Days before"
          value={value.pre}
          options={PRE_DAYS}
          onChange={(pre) => onChange({pre})}
        />
        <NumberSelect
          label="Days after"
          value={value.post}
          options={POST_DAYS}
          onChange={(post) => onChange({post})}
        />
        <NumberSelect
          label="History (years)"
          value={value.years}
          options={YEARS}
          onChange={(years) => onChange({years})}
        />
        <NumberSelect
          label="Hold days"
          value={value.hold}
          options={HOLD_DAYS}
          onChange={(hold) => onChange({hold})}
        />
      </div>
    </div>
  );
}

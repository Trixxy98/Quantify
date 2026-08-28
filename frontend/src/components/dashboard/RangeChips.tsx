import type { Range } from "../../types/api.types";

const RANGES: Range[] = ["1M", "3M", "6M", "1Y", "YTD", "ALL"];

type Props = {
  value: Range;
  onChange: (range: Range) => void;
};

export function RangeChips({ value, onChange }: Props) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {RANGES.map((item) => (
        <button
          key={item}
          type="button"
          onClick={() => onChange(item)}
          className={`rounded-md px-2.5 py-1 text-xs ${
            value === item
              ? "bg-[var(--color-accent)] text-slate-900"
              : "bg-[var(--color-surface)] text-[var(--color-text-muted)]"
          }`}
        >
          {item}
        </button>
      ))}
    </div>
  );
}

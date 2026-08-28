import { useMemo, useState } from "react";
import type { Currency, ScenarioPosition } from "../../types/api.types";
import { formatMoney, formatPct, toneClass } from "../../utils/format";

type Props = {
  totalValue: number;
  positions: ScenarioPosition[];
  currency: Currency;
  isLoading: boolean;
};

function estimate(positions: ScenarioPosition[], klciPct: number, spxPct: number, usdMyrPct: number) {
  let bursa = 0;
  let usStock = 0;
  let fx = 0;
  for (const p of positions) {
    const indexShock = p.exchange === "BURSA" ? klciPct : spxPct;
    bursa += p.exchange === "BURSA" ? p.marketValue * p.beta * indexShock : 0;
    usStock += p.exchange === "US" ? p.marketValue * p.beta * indexShock : 0;
    fx += p.marketValue * p.fxSensitivity * usdMyrPct;
  }
  return { bursa, usStock, fx, delta: bursa + usStock + fx };
}

function SliderRow({
  id,
  label,
  hint,
  value,
  min,
  max,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-3">
        <label htmlFor={id} className="text-sm">
          {label}
        </label>
        <span className="text-sm tabular-nums text-[var(--color-text-muted)]">{formatPct(value / 100, 0)}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--color-accent)]"
      />
      <p className="mt-1 text-xs text-[var(--color-text-muted)]">{hint}</p>
    </div>
  );
}

export function ScenarioPanel({ totalValue, positions, currency, isLoading }: Props) {
  const [klci, setKlci] = useState(0);
  const [spx, setSpx] = useState(0);
  const [usdMyr, setUsdMyr] = useState(0);

  const result = useMemo(
    () => estimate(positions, klci / 100, spx / 100, usdMyr / 100),
    [positions, klci, spx, usdMyr]
  );

  if (isLoading) {
    return <div className="h-80 rounded-xl bg-[var(--color-surface)] animate-pulse" />;
  }

  const estimated = totalValue + result.delta;

  return (
    <div className="rounded-xl bg-[var(--color-surface)] p-5 space-y-5">
      <div>
        <h2 className="text-sm text-[var(--color-text-muted)]">Scenario</h2>
        <p className="text-xs text-[var(--color-text-muted)] mt-1">
          Linear estimate from current weights and trailing beta. Not a forecast.
        </p>
      </div>

      {positions.length === 0 ? (
        <p className="text-sm text-[var(--color-text-muted)]">No holdings to shock</p>
      ) : (
        <>
          <div className="space-y-4">
            <SliderRow
              id="scenario-klci"
              label="KLCI"
              hint="Applied to Bursa names"
              value={klci}
              min={-20}
              max={20}
              onChange={setKlci}
            />
            <SliderRow
              id="scenario-spx"
              label="S&P 500"
              hint="Applied to US names"
              value={spx}
              min={-20}
              max={20}
              onChange={setSpx}
            />
            <SliderRow
              id="scenario-fx"
              label="USD/MYR"
              hint="Positive = MYR weaker, US sleeve worth more in RM"
              value={usdMyr}
              min={-15}
              max={15}
              onChange={setUsdMyr}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="text-xs text-[var(--color-text-muted)]">Estimated value</p>
              <p className="text-xl font-semibold tabular-nums">{formatMoney(estimated, currency)}</p>
            </div>
            <div>
              <p className="text-xs text-[var(--color-text-muted)]">Change</p>
              <p className={`text-xl font-semibold tabular-nums ${toneClass(result.delta)}`}>
                {formatMoney(result.delta, currency)}
              </p>
            </div>
          </div>

          <div className="grid gap-2 text-xs text-[var(--color-text-muted)] sm:grid-cols-3">
            <p>
              Bursa {formatMoney(result.bursa, currency)}
            </p>
            <p>
              US stocks {formatMoney(result.usStock, currency)}
            </p>
            <p>
              FX {formatMoney(result.fx, currency)}
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              setKlci(0);
              setSpx(0);
              setUsdMyr(0);
            }}
            className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            Reset
          </button>
        </>
      )}
    </div>
  );
}

import GaugeComponent from "react-gauge-component";

type Props = {
  volatility: number | undefined;
  isLoading: boolean;
};

export function RiskGauge({ volatility, isLoading }: Props) {
  if (isLoading) {
    return <div className="h-72 rounded-xl bg-[var(--color-surface)] animate-pulse" />;
  }

  const score = volatility == null ? 0 : Math.min(100, (volatility / 0.4) * 100);

  return (
    <div className="rounded-xl bg-[var(--color-surface)] p-5">
      <h2 className="text-sm text-[var(--color-text-muted)] mb-2">Risk Gauge</h2>
      <p className="text-xs text-[var(--color-text-muted)] mb-4">Based on annualized volatility</p>
      <GaugeComponent
        value={score}
        type="semicircle"
        labels={{
          valueLabel: {
            formatTextValue: (v) => `${Math.round(v)}`,
            style: { fill: "#f1f5f9", fontSize: "28px" },
          },
        }}
        arc={{
          colorArray: ["#22c55e", "#f59e0b", "#ef4444"],
          subArcs: [{ limit: 33 }, { limit: 66 }, { limit: 100 }],
          padding: 0.02,
          width: 0.25,
        }}
        pointer={{ type: "needle", color: "#f1f5f9" }}
      />
    </div>
  );
}
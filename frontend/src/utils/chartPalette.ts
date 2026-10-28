// Shared chart semantics on the dark finance dashboard: portfolio/strategy in
// emerald, benchmarks in blue or gold, risk in ruby, and secondary metrics in violet.
export const chartPalette = {
  portfolio: "#59D7B0",
  klci: "#71BDF4",
  spx: "#F3C879",
  violet: "#B5A0F5",
  ruby: "#F18498",
  cyan: "#66D1D9",
  pink: "#E9A0D0",
  indigo: "#879FF3",
} as const;

export const holdingLineColors = [
  chartPalette.cyan,
  chartPalette.pink,
  chartPalette.indigo,
  "#D1AD79",
  "#A9D18D",
] as const;

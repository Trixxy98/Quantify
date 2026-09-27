import type { Range } from "../types/api.types";

export type ChartAxis = "left" | "right";
export type ChartScale = "index" | "change";
export type ChartWindow = 20 | 60 | 120;

export type ChartSeriesPick = {
  id: string;
  axis: ChartAxis;
};

export type ChartView = {
  id: string;
  name: string;
  range: Range;
  window: ChartWindow;
  scale: ChartScale;
  series: ChartSeriesPick[];
};

export const DEFAULT_SERIES: ChartSeriesPick[] = [
  {id: "portfolio", axis: "left"},
  {id: "klci", axis: "left"},
  {id: "beta", axis: "right"},
];

const storageKey = (portfolioId: string) => `quantify-chart-views:${portfolioId}`;

export function readChartViews(portfolioId: string | undefined): ChartView[] {
  if (!portfolioId || typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(storageKey(portfolioId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ChartView[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeChartViews(portfolioId: string | undefined, views: ChartView[]) {
  if (!portfolioId || typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(storageKey(portfolioId), JSON.stringify(views));
  } catch {
    // Ignore quota / private-mode failures
  }
}

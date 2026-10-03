export type AgentName = "technical" | "risk";
export type AgentTarget = "returnScore" | "vol";
export type AgentHorizon = "1m";

/** One symbol's daily bars, ascending, already cut at the orchestrator's asOf. */
export type SymbolSeries = {
    symbol: string;
    market: "US" | "BURSA";
    dates: string[];
    open: number[];
    high: number[];
    low: number[];
    close: number[];
    /** Total-return index: closes with dividends reinvested on the ex-date. */
    level: number[];
};

export type AgentInput = {
    /** Last session of the latest complete month. Nothing after it is in `series`. */
    asOf: string;
    series: SymbolSeries[];
};

/**
 * One out-of-sample forecast for the month after `month`. `realized` is null
 * for the latest month, whose outcome is not known yet: those rows are the live
 * forecasts. `baseline` is what the agent has to beat, on the same footing.
 */
export type AgentPrediction = {
    month: string;
    symbol: string;
    forecast: number;
    baseline: number;
    realized: number | null;
};

export type AgentOutput = {
    agent: AgentName;
    version: string;
    target: AgentTarget;
    horizon: AgentHorizon;
    predictions: AgentPrediction[];
    notes: string[];
};

export type Agent = {
    name: AgentName;
    version: string;
    target: AgentTarget;
    horizon: AgentHorizon;
    /** Pure: no I/O, and nothing outside `input` may be read. */
    run: (input: AgentInput) => AgentOutput;
};

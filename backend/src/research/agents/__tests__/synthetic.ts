import {seededRandom} from "../../bootstrap";
import type {AgentInput, SymbolSeries} from "../types";

const DAY_MS = 24 * 60 * 60 * 1000;

export function weekdays(from: string, count: number): string[] {
    const out: string[] = [];
    let time = Date.parse(`${from}T00:00:00.000Z`);
    while (out.length < count) {
        const day = new Date(time).getUTCDay();
        if (day !== 0 && day !== 6) out.push(new Date(time).toISOString().slice(0, 10));
        time += DAY_MS;
    }
    return out;
}

function gaussian(random: () => number): number {
    const u = Math.max(random(), 1e-12);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}

/**
 * Daily bars for `names` symbols with mean-reverting monthly vol regimes. With
 * `persistentDrift` each name keeps one drift for the whole sample, so past
 * returns predict the next month.
 */
export function syntheticInput(options: {names: number; sessions: number; seed: number; persistentDrift?: boolean}): AgentInput {
    const random = seededRandom(options.seed);
    const dates = weekdays("2015-01-01", options.sessions);
    const series: SymbolSeries[] = [];
    for (let s = 0; s < options.names; s++) {
        let level = 100;
        const drift = options.persistentDrift ? (random() - 0.5) * 0.01 : 0;
        const baseVol = 0.01 + 0.01 * random();
        let vol = baseVol;
        const open: number[] = [];
        const high: number[] = [];
        const low: number[] = [];
        const close: number[] = [];
        const levels: number[] = [];
        dates.forEach((_, i) => {
            if (i % 21 === 0) vol = Math.exp(0.7 * Math.log(vol) + 0.3 * Math.log(baseVol) + 0.3 * gaussian(random));
            const prev = level;
            level = prev * Math.exp(drift + vol * gaussian(random));
            const range = vol * (0.5 + random());
            open.push(prev);
            close.push(level);
            high.push(Math.max(prev, level) * (1 + range / 2));
            low.push(Math.min(prev, level) * (1 - range / 2));
            levels.push(level);
        });
        series.push({symbol: `S${s}`, market: "US", dates: [...dates], open, high, low, close, level: levels});
    }
    return {asOf: dates[dates.length - 1], series};
}
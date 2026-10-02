import {describe, expect, it} from "vitest";
import {
    BOOTSTRAP_MIN_CLUSTERS,
    BOOTSTRAP_MIN_OBSERVATIONS,
    clusterBootstrap,
    quantile,
    seededRandom,
    stationaryBootstrap,
    stationaryBootstrapIndices,
} from "../bootstrap";

function mean(values: number[]) {
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function noise(n: number, seed: number, drift = 0) {
    const random = seededRandom(seed);
    return Array.from({length: n}, () => drift + (random() - 0.5) * 0.02);
}

describe("seededRandom", () => {
    it("repeats for the same seed and stays in [0, 1)", () => {
        const a = seededRandom(7);
        const b = seededRandom(7);
        const draws = Array.from({length: 1000}, () => a());
        expect(draws).toEqual(Array.from({length: 1000}, () => b()));
        expect(Math.min(...draws)).toBeGreaterThanOrEqual(0);
        expect(Math.max(...draws)).toBeLessThan(1);
    });
});

describe("stationaryBootstrapIndices", () => {
    it("wraps from the last index to the first inside a block", () => {
        // restart never fires (random() is always 0.99 > 1/L), start at the last index
        let call = 0;
        const random = () => (call++ === 0 ? 0.999 : 0.99);
        expect(stationaryBootstrapIndices(5, 20, random)).toEqual([4, 0, 1, 2, 3]);
    });

    it("has a mean block length near L", () => {
        const indices = stationaryBootstrapIndices(200_000, 20, seededRandom(3));
        let blocks = 1;
        for (let i = 1; i < indices.length; i++) {
            if (indices[i] !== (indices[i - 1] + 1) % indices.length) blocks++;
        }
        expect(indices.length / blocks).toBeGreaterThan(18);
        expect(indices.length / blocks).toBeLessThan(22);
    });
});

describe("stationaryBootstrap", () => {
    const series = noise(500, 11, 0.001);

    it("centres the interval for the mean on the sample mean", () => {
        const {mean: interval} = stationaryBootstrap(series, {mean});
        expect(interval).not.toBeNull();
        const midpoint = (interval!.low + interval!.high) / 2;
        expect(Math.abs(midpoint - mean(series))).toBeLessThan(0.0003);
        expect(interval!.low).toBeLessThan(mean(series));
        expect(interval!.high).toBeGreaterThan(mean(series));
    });

    it("is reproducible for a seed and changes with it", () => {
        const a = stationaryBootstrap(series, {mean});
        const b = stationaryBootstrap(series, {mean});
        const c = stationaryBootstrap(series, {mean}, {seed: 2});
        expect(a).toEqual(b);
        expect(c.mean!.low).not.toBe(a.mean!.low);
    });

    it("widens for autocorrelated data compared with an iid bootstrap", () => {
        const random = seededRandom(5);
        const persistent: number[] = [];
        let level = 0;
        for (let i = 0; i < 600; i++) {
            level = 0.9 * level + (random() - 0.5) * 0.02;
            persistent.push(level);
        }
        const blocked = stationaryBootstrap(persistent, {mean}).mean!;
        const iid = stationaryBootstrap(persistent, {mean}, {blockLength: 1}).mean!;
        expect(blocked.high - blocked.low).toBeGreaterThan(1.5 * (iid.high - iid.low));
    });

    it("returns null below the minimum sample", () => {
        expect(stationaryBootstrap(noise(BOOTSTRAP_MIN_OBSERVATIONS - 1, 1), {mean}).mean).toBeNull();
    });
});

describe("clusterBootstrap", () => {
    it("is wider when values inside a cluster move together", () => {
        const random = seededRandom(9);
        const shocks = Array.from({length: 30}, () => (random() - 0.5) * 0.04);
        const correlated = shocks.map((shock) => [shock, shock, shock, shock]);
        const pooledAsSingles = correlated.flat().map((value) => [value]);
        const clustered = clusterBootstrap(correlated, mean)!;
        const naive = clusterBootstrap(pooledAsSingles, mean)!;
        expect(clustered.high - clustered.low).toBeGreaterThan(1.5 * (naive.high - naive.low));
    });

    it("needs a minimum number of clusters", () => {
        const few = Array.from({length: BOOTSTRAP_MIN_CLUSTERS - 1}, (_, i) => [i]);
        expect(clusterBootstrap(few, mean)).toBeNull();
    });
});

describe("quantile", () => {
    it("interpolates between neighbours", () => {
        expect(quantile([0, 10], 0.05)).toBeCloseTo(0.5);
        expect(quantile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    });
});

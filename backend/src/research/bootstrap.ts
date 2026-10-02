export const BOOTSTRAP_RESAMPLES = 2000;
export const BOOTSTRAP_BLOCK_LENGTH = 20;
export const BOOTSTRAP_SEED = 1;
/** Below this many observations a 20-session block covers too much of the sample to mean anything. */
export const BOOTSTRAP_MIN_OBSERVATIONS = 60;
/** Fewer clusters than this and the resamples are mostly repeats of the same few events. */
export const BOOTSTRAP_MIN_CLUSTERS = 8;

export type Interval = {
    low: number; // 5th percentile
    high: number; // 95th percentile
    resamples: number;
    method: "stationary" | "cluster";
    blockLength: number | null;
};

export type BootstrapOptions = {
    resamples?: number;
    blockLength?: number;
    seed?: number;
};

/** Mulberry32. Seeded so the same series always gets the same interval. */
export function seededRandom(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Politis–Romano (1994) stationary bootstrap. Each step continues the current
 * block with probability 1 − 1/L or jumps to a uniform random start, so block
 * lengths are geometric with mean L. Indices wrap around the end of the series.
 */
export function stationaryBootstrapIndices(n: number, expectedBlock: number, random: () => number): number[] {
    const restart = 1 / expectedBlock;
    const indices = new Array<number>(n);
    let current = Math.floor(random() * n);
    for (let i = 0; i < n; i++) {
        if (i > 0) current = random() < restart ? Math.floor(random() * n) : (current + 1) % n;
        indices[i] = current;
    }
    return indices;
}

/** Linear-interpolated quantile of an ascending-sorted array. */
export function quantile(sorted: number[], q: number): number {
    if (sorted.length === 0) return Number.NaN;
    const position = (sorted.length - 1) * q;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function toInterval(draws: number[], resamples: number, method: Interval["method"], blockLength: number | null): Interval | null {
    const finite = draws.filter(Number.isFinite).sort((a, b) => a - b);
    if (finite.length < resamples / 2) return null;
    return {low: quantile(finite, 0.05), high: quantile(finite, 0.95), resamples: finite.length, method, blockLength};
}

/**
 * 5th–95th percentile intervals for several statistics of one daily series.
 * Every statistic is evaluated on the same resamples. Null when the series is
 * shorter than BOOTSTRAP_MIN_OBSERVATIONS.
 */
export function stationaryBootstrap<K extends string>(
    series: number[],
    statistics: Record<K, (sample: number[]) => number>,
    options: BootstrapOptions = {}
): Record<K, Interval | null> {
    const keys = Object.keys(statistics) as K[];
    const empty = Object.fromEntries(keys.map((key) => [key, null])) as Record<K, Interval | null>;
    if (series.length < BOOTSTRAP_MIN_OBSERVATIONS) return empty;

    const resamples = options.resamples ?? BOOTSTRAP_RESAMPLES;
    const blockLength = options.blockLength ?? BOOTSTRAP_BLOCK_LENGTH;
    const random = seededRandom(options.seed ?? BOOTSTRAP_SEED);
    const draws = Object.fromEntries(keys.map((key) => [key, [] as number[]])) as Record<K, number[]>;
    const sample = new Array<number>(series.length);

    for (let r = 0; r < resamples; r++) {
        const indices = stationaryBootstrapIndices(series.length, blockLength, random);
        for (let i = 0; i < indices.length; i++) sample[i] = series[indices[i]];
        for (const key of keys) draws[key].push(statistics[key](sample));
    }

    return Object.fromEntries(
        keys.map((key) => [key, toInterval(draws[key], resamples, "stationary", blockLength)])
    ) as Record<K, Interval | null>;
}

/**
 * Resamples whole clusters with replacement and applies `statistic` to the
 * pooled values. For event studies the cluster is the event date: names
 * reacting to the same Fed day are one draw, not several independent ones.
 */
export function clusterBootstrap(
    clusters: number[][],
    statistic: (values: number[]) => number,
    options: Omit<BootstrapOptions, "blockLength"> = {}
): Interval | null {
    const usable = clusters.filter((cluster) => cluster.length > 0);
    if (usable.length < BOOTSTRAP_MIN_CLUSTERS) return null;

    const resamples = options.resamples ?? BOOTSTRAP_RESAMPLES;
    const random = seededRandom(options.seed ?? BOOTSTRAP_SEED);
    const draws: number[] = [];
    for (let r = 0; r < resamples; r++) {
        const pooled: number[] = [];
        for (let i = 0; i < usable.length; i++) pooled.push(...usable[Math.floor(random() * usable.length)]);
        draws.push(statistic(pooled));
    }
    return toInterval(draws, resamples, "cluster", null);
}

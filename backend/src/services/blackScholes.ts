/** European Black–Scholes. US listed equity options are American; this is the teaching approximation. */

const SQRT_2PI = Math.sqrt(2 * Math.PI);

function erf(x: number): number {
    const sign = x < 0 ? -1 : 1;
    const ax = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * ax);
    const y =
        1 -
        ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
            t *
            Math.exp(-ax * ax);
    return sign * y;
}

export function normCdf(x: number): number {
    return 0.5 * (1 + erf(x / Math.SQRT2));
}

export function normPdf(x: number): number {
    return Math.exp(-0.5 * x * x) / SQRT_2PI;
}

export type OptionRight = "call" | "put";

export function blackScholesPrice(
    spot: number,
    strike: number,
    time: number,
    rate: number,
    dividend: number,
    vol: number,
    right: OptionRight
): number {
    if (time <= 0 || vol <= 0 || spot <= 0 || strike <= 0) {
        const fwd = spot * Math.exp((rate - dividend) * Math.max(time, 0));
        const disc = Math.exp(-rate * Math.max(time, 0));
        const intrinsic = right === "call" ? Math.max(fwd - strike, 0) : Math.max(strike - fwd, 0);
        return disc * intrinsic;
    }

    const sqrtT = Math.sqrt(time);
    const d1 = (Math.log(spot / strike) + (rate - dividend + 0.5 * vol * vol) * time) / (vol * sqrtT);
    const d2 = d1 - vol * sqrtT;
    const dfDiv = Math.exp(-dividend * time);
    const dfRate = Math.exp(-rate * time);

    if (right === "call") {
        return spot * dfDiv * normCdf(d1) - strike * dfRate * normCdf(d2);
    }
    return strike * dfRate * normCdf(-d2) - spot * dfDiv * normCdf(-d1);
}

export function blackScholesVega(
    spot: number,
    strike: number,
    time: number,
    rate: number,
    dividend: number,
    vol: number
): number {
    if (time <= 0 || vol <= 0 || spot <= 0 || strike <= 0) return 0;
    const sqrtT = Math.sqrt(time);
    const d1 = (Math.log(spot / strike) + (rate - dividend + 0.5 * vol * vol) * time) / (vol * sqrtT);
    return spot * Math.exp(-dividend * time) * normPdf(d1) * sqrtT;
}

export type IvSolve = {iv: number; method: "newton" | "bisection"};

function discountedForward(spot: number, strike: number, time: number, rate: number, dividend: number) {
    return spot * Math.exp(-dividend * time) - strike * Math.exp(-rate * time);
}

function intrinsic(spot: number, strike: number, time: number, rate: number, dividend: number, right: OptionRight) {
    const fwd = discountedForward(spot, strike, time, rate, dividend);
    return right === "call" ? Math.max(fwd, 0) : Math.max(-fwd, 0);
}

function bisectionIv(
    market: number,
    spot: number,
    strike: number,
    time: number,
    rate: number,
    dividend: number,
    right: OptionRight
): number | null {
    let lo = 1e-4;
    let hi = 5;
    const priceLo = blackScholesPrice(spot, strike, time, rate, dividend, lo, right);
    const priceHi = blackScholesPrice(spot, strike, time, rate, dividend, hi, right);
    if (market <= priceLo || market >= priceHi) return null;

    for (let i = 0; i < 80; i++) {
        const mid = 0.5 * (lo + hi);
        const price = blackScholesPrice(spot, strike, time, rate, dividend, mid, right);
        if (Math.abs(price - market) < 1e-6) return mid;
        if (price > market) hi = mid;
        else lo = mid;
    }
    return 0.5 * (lo + hi);
}

export function impliedVol(
    market: number,
    spot: number,
    strike: number,
    time: number,
    rate: number,
    dividend: number,
    right: OptionRight
): IvSolve | null {
    if (!(market > 0) || !(spot > 0) || !(strike > 0) || !(time > 0)) return null;

    const floor = intrinsic(spot, strike, time, rate, dividend, right);
    if (market < floor - 1e-6) return null;

    let sigma = Math.sqrt((2 * Math.PI) / time) * (market / spot);
    if (!Number.isFinite(sigma) || sigma < 0.05) sigma = 0.3;
    sigma = Math.min(Math.max(sigma, 0.05), 2);

    for (let i = 0; i < 40; i++) {
        const price = blackScholesPrice(spot, strike, time, rate, dividend, sigma, right);
        const vega = blackScholesVega(spot, strike, time, rate, dividend, sigma);
        const diff = price - market;
        if (Math.abs(diff) < 1e-6 && vega > 0) return {iv: sigma, method: "newton"};
        if (vega < 1e-12) break;
        sigma -= diff / vega;
        if (sigma <= 1e-4 || sigma >= 5) break;
    }

    const bisect = bisectionIv(market, spot, strike, time, rate, dividend, right);
    if (bisect == null) return null;
    return {iv: bisect, method: "bisection"};
}

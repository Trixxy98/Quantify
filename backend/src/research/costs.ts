/** Round-trip defaults for a liquid US name: commission plus half the spread, each way counted in the turnover. */
export const DEFAULT_COMMISSION_BPS = 5;
export const DEFAULT_SLIPPAGE_BPS = 5;

/** Fraction of portfolio value traded. 1 means the whole book changed hands. */
export function costDrag(
    turnover: number,
    commissionBps = DEFAULT_COMMISSION_BPS,
    slippageBps = DEFAULT_SLIPPAGE_BPS
): number {
    return turnover * (commissionBps + slippageBps) / 10_000;
}

export function applyCosts(
    grossReturns: number[],
    turnover: number[],
    commissionBps = DEFAULT_COMMISSION_BPS,
    slippageBps = DEFAULT_SLIPPAGE_BPS
): number[] {
    return grossReturns.map((ret, i) => ret - costDrag(turnover[i] ?? 0, commissionBps, slippageBps));
}

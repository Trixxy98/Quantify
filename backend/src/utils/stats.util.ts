export function average(values: number[]): number {
    return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function variance(values: number[]): number {
    const mean = average(values);

    return values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1);
}

export function stdDev(values: number[]): number {
    return Math.sqrt(variance(values));
}

export function covariance(a: number[], b: number[]): number {
    const meanA = average(a);
    const meanB = average(b);

    let sum = 0;
    for (let i = 0; i < a.length; i++) {
        sum += (a[i] - meanA) * (b[i] - meanB);
    }

    return sum / (a.length -1);
}
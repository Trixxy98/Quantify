const currencyFormatter = new Intl.NumberFormat("en-MY", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
});

export function formatMoney(value: number, currency: "MYR" | "USD"): string {
    const prefix = currency === "MYR" ? "RM " : "US$";
    return `${prefix}${currencyFormatter.format(value)}`;
}

export function formatPct(value: number, digits = 2): string {
    const sign = value > 0 ? "+" : "";
    return `${sign}${(value * 100).toFixed(digits)}%`;
}

export function formatNumber(value: number, digits = 2): string {
    return value.toFixed(digits);
}

export function toneClass(value: number): string {
    if (value > 0) return "text-[var(--color-accent)]";
    if (value < 0) return "text-[var(--color-danger)]";
    return "text-[var(--color-text-muted)]";
}

export function formatPctAbs(value: number, digits = 2): string {
    return `${(value * 100).toFixed(digits)}%`;
}
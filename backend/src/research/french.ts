/** Regressors, in the order the regression reports them. RF is stored but is not a regressor. */
export const FACTOR_NAMES = ["Mkt-RF", "SMB", "HML", "RMW", "CMA", "Mom"] as const;
export type FactorName = (typeof FACTOR_NAMES)[number];

export const FF5_URL =
    "https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/F-F_Research_Data_5_Factors_2x3_daily_CSV.zip";
export const MOMENTUM_URL =
    "https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/F-F_Momentum_Factor_daily_CSV.zip";

export type FrenchRow = {date: string; values: Record<string, number>};

/**
 * Ken French daily files lead with a citation, then a header row whose first
 * cell is empty, then YYYYMMDD rows in percent. A blank line starts the annual
 * table, which is not daily and is ignored. Values come back as fractions.
 */
export function parseFrenchDaily(csv: string): FrenchRow[] {
    const lines = csv.split(/\r?\n/);
    let headers: string[] | null = null;
    const rows: FrenchRow[] = [];

    for (const line of lines) {
        const trimmed = line.trim();
        if (!headers) {
            if (trimmed.startsWith(",") && (trimmed.includes("Mkt-RF") || trimmed.includes("Mom"))) {
                headers = trimmed.split(",").map((cell) => cell.trim());
            }
            continue;
        }
        if (!trimmed || !/^\d{8}/.test(trimmed)) break;

        const cells = trimmed.split(",").map((cell) => cell.trim());
        const values: Record<string, number> = {};
        for (let i = 1; i < headers.length; i++) {
            const name = headers[i];
            if (!name) continue;
            const parsed = Number(cells[i]);
            if (!Number.isFinite(parsed)) continue;
            values[name] = parsed / 100;
        }
        const stamp = cells[0];
        rows.push({date: `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}`, values});
    }
    return rows;
}

/**
 * Fills the `cpi` array in src/data/macroEvents.json with US CPI release dates.
 *
 * BLS blocks automated fetches of its own release schedule, so we read the FRED
 * release calendar instead (FRED mirrors the BLS release dates).
 *
 * Usage: FRED_API_KEY=... npm run events:cpi
 * Free key: https://fredaccount.stlouisfed.org/apikeys
 */
import {readFileSync, writeFileSync} from "node:fs";
import {resolve} from "node:path";
import dotenv from "dotenv";

dotenv.config();

const API = "https://api.stlouisfed.org/fred";
const RELEASE_NAME = "Consumer Price Index";
const DATA_FILE = resolve(__dirname, "../src/data/macroEvents.json");
const REALTIME_START = "2015-01-01";

async function getJson(path: string, params: Record<string, string>) {
    const key = process.env.FRED_API_KEY;
    if (!key) {
        throw new Error("FRED_API_KEY is missing. Get a free key at https://fredaccount.stlouisfed.org/apikeys");
    }
    const query = new URLSearchParams({...params, api_key: key, file_type: "json"});
    const response = await fetch(`${API}${path}?${query}`);
    if (!response.ok) {
        throw new Error(`FRED ${path} failed: ${response.status} ${await response.text()}`);
    }
    return response.json() as Promise<Record<string, unknown>>;
}

async function findReleaseId(): Promise<number> {
    const data = await getJson("/releases", {limit: "1000"});
    const releases = (data.releases ?? []) as {id: number; name: string}[];
    const match = releases.find((release) => release.name === RELEASE_NAME);
    if (!match) {
        throw new Error(`Could not find a FRED release named "${RELEASE_NAME}"`);
    }
    return match.id;
}

async function fetchReleaseDates(releaseId: number): Promise<string[]> {
    const data = await getJson("/release/dates", {
        release_id: String(releaseId),
        realtime_start: REALTIME_START,
        limit: "10000",
        sort_order: "asc",
        include_release_dates_with_no_data: "false",
    });
    const rows = (data.release_dates ?? []) as {date: string}[];
    return [...new Set(rows.map((row) => row.date))].sort();
}

async function main() {
    const releaseId = await findReleaseId();
    const dates = await fetchReleaseDates(releaseId);
    if (dates.length === 0) {
        throw new Error("FRED returned no release dates");
    }

    const file = JSON.parse(readFileSync(DATA_FILE, "utf8")) as Record<string, unknown>;
    file.cpi = dates;
    file._cpiSource = `FRED release ${releaseId} ("${RELEASE_NAME}") release dates from ${REALTIME_START}, fetched ${new Date().toISOString().slice(0, 10)}. FRED mirrors the BLS CPI release schedule.`;
    writeFileSync(DATA_FILE, `${JSON.stringify(file, null, 2)}\n`);

    console.log(`Wrote ${dates.length} CPI release dates (${dates[0]} to ${dates[dates.length - 1]})`);
}

main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
});

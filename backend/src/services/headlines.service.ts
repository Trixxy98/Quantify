import {prisma} from "../lib/prisma";
import {yahooFinance} from "./market.service";

/** Yahoo returns the latest few; recording daily keeps up with all but the busiest names. */
const NEWS_COUNT = 20;
const ALWAYS_RECORD = ["SPY"];

/**
 * Records today's headlines for each US symbol. Yahoo has no headline
 * history, so a day this does not run is lost. Failures are per symbol.
 */
export async function recordHeadlines(symbols: string[]): Promise<{attempted: number; recorded: number}> {
    const usSymbols = [...new Set([...ALWAYS_RECORD, ...symbols])].filter((symbol) => !symbol.includes(".") && !symbol.startsWith("^"));
    let recorded = 0;
    for (const symbol of usSymbols) {
        try {
            const result = await yahooFinance.search(symbol, {newsCount: NEWS_COUNT, quotesCount: 0});
            const rows = (result.news ?? [])
                // A search hit that does not tag the symbol is about something else.
                .filter((item) => item.uuid && item.title && (!item.relatedTickers || item.relatedTickers.includes(symbol)))
                .map((item) => ({
                    symbol,
                    sourceId: item.uuid,
                    published: new Date(item.providerPublishTime),
                    title: item.title.slice(0, 500),
                    publisher: item.publisher ?? "",
                    link: item.link ?? null,
                }))
                .filter((row) => !Number.isNaN(row.published.getTime()));
            if (rows.length === 0) continue;
            const {count} = await prisma.newsHeadline.createMany({data: rows, skipDuplicates: true});
            recorded += count;
        } catch (err) {
            console.error("[headlines] record failed", symbol, err);
        }
    }
    return {attempted: usSymbols.length, recorded};
}

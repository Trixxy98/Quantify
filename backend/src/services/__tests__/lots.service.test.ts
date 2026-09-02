import {Currency, TransactionType} from "@prisma/client";
import {describe, expect, it} from "vitest";
import {replayRealized, type LotTrade} from "../lots.service";
import type {SplitRow} from "../corporateActions";

const DAY = (iso: string, hour = 0) => new Date(`${iso}T${String(hour).padStart(2, "0")}:00:00.000Z`);

function trade(
    id: string,
    type: TransactionType,
    quantity: number,
    price: number,
    date: string,
    extra: Partial<Omit<LotTrade, "id" | "type" | "quantity" | "price" | "date">> = {}
): LotTrade {
    return {
        id,
        symbol: extra.symbol ?? "AAPL",
        type,
        quantity,
        price,
        fee: extra.fee ?? 0,
        date: DAY(date),
        createdAt: extra.createdAt ?? DAY(date),
        currency: extra.currency ?? Currency.USD,
    };
}

const identityToBase = (value: number) => value;

describe("replayRealized", () => {
    it("books a round-trip as one closed lot", () => {
        const {sells, lots} = replayRealized(
            [
                trade("b1", TransactionType.BUY, 100, 10, "2024-01-02"),
                trade("s1", TransactionType.SELL, 100, 12, "2024-03-01"),
            ],
            new Map(),
            identityToBase
        );

        expect(sells.get("s1")?.realizedPnL).toBeCloseTo(200, 8);
        expect(sells.get("s1")?.closedPosition).toBe(true);
        expect(lots).toHaveLength(1);
        expect(lots[0]).toMatchObject({
            symbol: "AAPL",
            openedAt: "2024-01-02",
            closedAt: "2024-03-01",
            quantity: 100,
            cost: 1000,
            proceeds: 1200,
            realizedPnL: 200,
        });
    });

    it("does not close the lot on a partial sell", () => {
        const {sells, lots} = replayRealized(
            [
                trade("b1", TransactionType.BUY, 100, 10, "2024-01-02"),
                trade("s1", TransactionType.SELL, 40, 12, "2024-02-01"),
            ],
            new Map(),
            identityToBase
        );

        expect(sells.get("s1")?.realizedPnL).toBeCloseTo(80, 8);
        expect(sells.get("s1")?.closedPosition).toBe(false);
        expect(lots).toHaveLength(0);
    });

    it("uses weighted average cost across buys", () => {
        const {sells} = replayRealized(
            [
                trade("b1", TransactionType.BUY, 100, 10, "2024-01-02"),
                trade("b2", TransactionType.BUY, 100, 20, "2024-01-03"),
                trade("s1", TransactionType.SELL, 100, 18, "2024-01-04"),
            ],
            new Map(),
            identityToBase
        );

        // avg cost 15, sell 18 → 300
        expect(sells.get("s1")?.avgCost).toBeCloseTo(15, 8);
        expect(sells.get("s1")?.realizedPnL).toBeCloseTo(300, 8);
        expect(sells.get("s1")?.closedPosition).toBe(false);
    });

    it("starts a new lot after the book goes flat", () => {
        const {lots} = replayRealized(
            [
                trade("b1", TransactionType.BUY, 100, 10, "2024-01-02"),
                trade("s1", TransactionType.SELL, 100, 12, "2024-02-01"),
                trade("b2", TransactionType.BUY, 50, 11, "2024-03-01"),
                trade("s2", TransactionType.SELL, 50, 10, "2024-04-01"),
            ],
            new Map(),
            identityToBase
        );

        expect(lots).toHaveLength(2);
        expect(lots[0].realizedPnL).toBeCloseTo(-50, 8);
        expect(lots[0].openedAt).toBe("2024-03-01");
        expect(lots[1].realizedPnL).toBeCloseTo(200, 8);
        expect(lots[1].openedAt).toBe("2024-01-02");
    });

    it("puts buy fees into cost and sell fees against proceeds", () => {
        const {sells, lots} = replayRealized(
            [
                trade("b1", TransactionType.BUY, 10, 10, "2024-01-02", {fee: 5}),
                trade("s1", TransactionType.SELL, 10, 12, "2024-02-01", {fee: 5}),
            ],
            new Map(),
            identityToBase
        );

        expect(sells.get("s1")?.realizedPnL).toBeCloseTo(10, 8);
        expect(lots[0].cost).toBeCloseTo(105, 8);
        expect(lots[0].proceeds).toBeCloseTo(115, 8);
        expect(lots[0].realizedPnL).toBeCloseTo(10, 8);
    });

    it("restates a pre-split buy onto Yahoo's post-split share count", () => {
        const splits = new Map<string, SplitRow[]>([
            ["AAPL", [{date: DAY("2020-08-31"), numerator: 4, denominator: 1}]],
        ]);
        const {sells, lots} = replayRealized(
            [
                trade("b1", TransactionType.BUY, 100, 400, "2019-05-01"),
                trade("s1", TransactionType.SELL, 400, 110, "2021-01-04"),
            ],
            splits,
            identityToBase
        );

        expect(sells.get("s1")?.quantity).toBeCloseTo(400, 8);
        expect(sells.get("s1")?.avgCost).toBeCloseTo(100, 8);
        expect(lots[0].quantity).toBeCloseTo(400, 8);
        expect(lots[0].realizedPnL).toBeCloseTo(4000, 8);
    });

    it("converts realized P&L into base currency at the sell date", () => {
        const toBase = (value: number, _from: Currency, time: number) => {
            const rate = time < DAY("2024-06-01").getTime() ? 4 : 5;
            return value * rate;
        };
        const {sells, lots} = replayRealized(
            [
                trade("b1", TransactionType.BUY, 10, 10, "2024-01-02", {currency: Currency.USD}),
                trade("s1", TransactionType.SELL, 10, 12, "2024-07-01", {currency: Currency.USD}),
            ],
            new Map(),
            toBase
        );

        // cost 100 @ 4 = 400, proceeds 120 @ 5 = 600
        expect(sells.get("s1")?.realizedPnLBase).toBeCloseTo(200, 8);
        expect(lots[0].realizedPnLBase).toBeCloseTo(200, 8);
    });

    it("keeps symbols independent", () => {
        const {lots} = replayRealized(
            [
                trade("b1", TransactionType.BUY, 10, 10, "2024-01-02", {symbol: "AAPL"}),
                trade("b2", TransactionType.BUY, 20, 5, "2024-01-02", {symbol: "MSFT"}),
                trade("s1", TransactionType.SELL, 10, 11, "2024-02-01", {symbol: "AAPL"}),
            ],
            new Map(),
            identityToBase
        );

        expect(lots).toHaveLength(1);
        expect(lots[0].symbol).toBe("AAPL");
    });
});

import {describe, expect, it} from "vitest";
import {parseFrenchDaily} from "../french";

const SAMPLE = `This file was created using the CRSP database.

,Mkt-RF,SMB,HML,RMW,CMA,RF
19630701,    0.10,   -0.25,   -0.27,    0.04,    0.09,    0.009
19630702,    0.45,   -0.12,    0.01,   -0.02,    0.03,    0.009

 Annual Factors: January-December
  1963,  20.00
`;

describe("parseFrenchDaily", () => {
    it("reads the daily block as fractions and stops before the annual table", () => {
        const rows = parseFrenchDaily(SAMPLE);
        expect(rows).toHaveLength(2);
        expect(rows[0].date).toBe("1963-07-01");
        expect(rows[0].values["Mkt-RF"]).toBeCloseTo(0.001, 10);
        expect(rows[0].values.RF).toBeCloseTo(0.00009, 10);
        expect(rows[1].values.SMB).toBeCloseTo(-0.0012, 10);
    });
});

import {z} from "zod";
import {riskVolAgent} from "./riskVol";
import {technicalAgent} from "./technical";
import type {Agent, AgentInput, AgentName, AgentOutput, AgentPrediction} from "./types";

export const AGENTS: Agent[] = [technicalAgent, riskVolAgent];

const DAY_MS = 24 * 60 * 60 * 1000;

const predictionSchema = z.object({
    month: z.string().regex(/^\d{4}-\d{2}$/),
    symbol: z.string().min(1),
    forecast: z.number().finite(),
    baseline: z.number().finite(),
    realized: z.number().finite().nullable(),
});

function outputSchema(agent: Agent, input: AgentInput) {
    const universe = new Set(input.series.map((series) => series.symbol));
    const asOfMonth = input.asOf.slice(0, 7);
    return z
        .object({
            agent: z.literal(agent.name),
            version: z.literal(agent.version),
            target: z.literal(agent.target),
            horizon: z.literal(agent.horizon),
            predictions: z.array(predictionSchema),
            notes: z.array(z.string()),
        })
        .superRefine((output, ctx) => {
            const seen = new Set<string>();
            output.predictions.forEach((row, index) => {
                const issue = (message: string) => ctx.addIssue({code: z.ZodIssueCode.custom, path: ["predictions", index], message});
                if (!universe.has(row.symbol)) issue(`${row.symbol} is not in the universe`);
                if (row.month > asOfMonth) issue(`${row.month} is after ${input.asOf}`);
                if (row.month === asOfMonth && row.realized != null) issue(`${row.symbol} ${row.month} has an outcome that cannot be known yet`);
                if (agent.target === "vol" && !(row.forecast > 0)) issue(`${row.symbol} ${row.month} vol forecast is not positive`);
                const key = `${row.month}|${row.symbol}`;
                if (seen.has(key)) issue(`duplicate forecast for ${row.symbol} ${row.month}`);
                seen.add(key);
            });
        });
}

export type AgentResult =
    | {agent: AgentName; version: string; ok: true; output: AgentOutput; live: AgentPrediction[]}
    | {agent: AgentName; version: string; ok: false; error: string};

/**
 * Runs each agent on the same input and validates what it returns. A throw or
 * a malformed output fails that agent only.
 */
export function runAgentSet(agents: Agent[], input: AgentInput): AgentResult[] {
    const asOfMonth = input.asOf.slice(0, 7);
    return agents.map((agent): AgentResult => {
        try {
            const parsed = outputSchema(agent, input).safeParse(agent.run(input));
            if (!parsed.success) {
                const first = parsed.error.issues[0];
                const where = first.path.length > 0 ? ` at ${first.path.join(".")}` : "";
                return {agent: agent.name, version: agent.version, ok: false, error: `invalid output${where}: ${first.message}`};
            }
            const output = parsed.data as AgentOutput;
            return {
                agent: agent.name,
                version: agent.version,
                ok: true,
                output,
                live: output.predictions.filter((row) => row.month === asOfMonth),
            };
        } catch (err) {
            return {agent: agent.name, version: agent.version, ok: false, error: err instanceof Error ? err.message : String(err)};
        }
    });
}

function nextWeekday(date: string): string {
    let time = Date.parse(`${date}T00:00:00.000Z`) + DAY_MS;
    while ([0, 6].includes(new Date(time).getUTCDay())) time += DAY_MS;
    return new Date(time).toISOString().slice(0, 10);
}

/**
 * Last session of the latest month whose bars are all in. The last stored
 * month counts only if its final bar falls on the month's last weekday and that
 * session has closed (a bar stored during the session is not a close).
 * Otherwise a later bar proves the month before it is complete.
 */
export function completedMonthEnd(calendar: string[], latestClosedSession: string): string | null {
    if (calendar.length === 0) return null;
    const last = calendar[calendar.length - 1];
    if (nextWeekday(last).slice(0, 7) !== last.slice(0, 7) && last <= latestClosedSession) return last;
    const month = last.slice(0, 7);
    for (let i = calendar.length - 1; i >= 0; i--) {
        if (calendar[i].slice(0, 7) < month) return calendar[i];
    }
    return null;
}

export type AgentRunState = {agent: string; ok: boolean; startedAt: Date; finishedAt: Date | null};

/** Agents without a successful run for this asOf, and not being run right now by another process. */
export function agentsDue(agents: Agent[], runs: AgentRunState[], now: Date, inFlightMs: number): Agent[] {
    return agents.filter((agent) => {
        const mine = runs.filter((run) => run.agent === agent.name);
        if (mine.some((run) => run.ok)) return false;
        return !mine.some((run) => run.finishedAt == null && now.getTime() - run.startedAt.getTime() < inFlightMs);
    });
}

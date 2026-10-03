# Quantify — research roadmap

Plan for the next layer of the app: from measuring the book to testing ideas about it. This file is the
agreement on scope and order. Each phase ships on its own; nothing in a later phase is assumed by an earlier one.

Status: `done` · `next` · `planned` · `deferred`

---

## 1. Principles

Every module below follows the same rules. If a proposed feature cannot satisfy them, it does not go in.

1. **Measured, not asserted.** Every number ships with its sample size and, where there is a standard method, an
   error bar. A Sharpe without `n` is a guess.
2. **Out-of-sample or nothing.** A signal is only reported on data it was not fitted on. In-sample results may be
   shown, but never alone and never first.
3. **Costs are part of the return.** Backtests charge commission and slippage. A strategy that only works before
   costs does not work.
4. **A fair benchmark.** Total-return where one exists (`^SP500TR`); price-only where it does not (`^KLSE`), with
   the understatement stated on the page.
5. **Failure is a result.** Pages must render a signal that does not work with the same clarity as one that does.
   No cherry-picked windows, no hidden parameter sweeps.
6. **Daily bars, one Postgres, one cron.** No intraday, no cloud services, no job queue. Anything that needs more is
   out of scope for this repo.
7. **Do not invent history.** If a data source only serves "now" (options chains), record it forward and say when
   recording started. Never backfill with a proxy and call it the real series.

---

## 2. Where we are

| Layer | Module | Status | Notes |
| --- | --- | --- | --- |
| Data | Splits, dividends, rebase detection | done | `corporateActions.ts`, `market.service.ts` |
| Data | `^SP500TR` benchmark | done | KLCI stays price-only |
| Data | Daily ATM implied vol recorder | done | `ImpliedSnapshot`, front month ≥ 20d, SPY always recorded. First row 2026-09-25 |
| Data | Recorder reliability | done | `SyncRun` table; API syncs on startup if nothing finished since the last US close; `scripts/sync_daily.py` for launchd. Sessions from 2026-09-28 until the first catch-up have no IV row and are listed on Events, not filled |
| Measurement | TWR with dividend income, realized P&L, closed lots | done | |
| Risk | Correlation, GK vs C2C vol, MCTR/CCTR, VaR/ES + Kupiec, drawdowns, rolling vol/beta | done | `risk.math.ts`, `risk.service.ts` |
| Research | Event study (FOMC / CPI / earnings), event-only rule | done | |
| Research | Variance premium: term-structure implied move vs realized event moves | done | IV rank blank until 20 recorded sessions |
| Research | Fama–French 5 + momentum on the US sleeve, walk-forward harness, cost model | done | Factors page. French data through the last monthly file. Loadings need 120 sessions |
| Research | 12-1 momentum, walk-forward, after costs | done | Research page. Fixed 30-name basket dated 2026-01-01, or the portfolio's US holdings |
| Data | Data quality page | done | Data page. Found the USD/MYR one-day date shift, now fixed (see Phase E) |
| Measurement | Block-bootstrap intervals for Sharpe, CAGR, max drawdown, event CAR, momentum Sharpe | done | See Phase D |
| Research | Agents G1: orchestrator, Technical and Risk (a) agents, scoreboard, live forecast record | done | Agents page. Live record from 2026-09-30. Headlines recorded forward from 2026-10-03 |
| Tooling | Chart workspace, saved views | done | |
| Tests | pytest across metrics, corporate actions, lots, risk math, premium, IV snapshot, OLS, walk-forward, momentum, agents, plus 166 golden cases from the TS implementation | done | `backend-py/tests` |
| Platform | API moved from Express + Prisma to FastAPI + SQLAlchemy + Alembic, same database and JSON | done | 2026-10-03; 0 differences on 54 live responses. `backend/` kept one week as the reference. File names in the Built notes below are the TS originals; the Python modules use the same names in snake_case under `backend-py/app/` |

The README *What it is not* section now says there is no chart-pattern signal, and that the one tested rule is 12-1
momentum, walk-forward, after costs.

---

## 3. Phases

### Phase A — Factor data and the walk-forward engine `done`

**Why first.** Every signal needs the same three things: a factor benchmark to regress against, a way to roll a
model forward through time, and a cost model. Build them once.

**Scope**

- Load Fama–French daily factors (Mkt-RF, SMB, HML, RMW, CMA) and the momentum factor (Mom) from the Ken French
  data library (free CSV/zip, US only).
- Store as `FactorReturn(date, factor, value)`; refresh in the daily cron after prices. French updates monthly, so a
  stale tail is normal and must be shown as such.
- Regress the **US sleeve** daily TWR on the factors: full-sample loadings with t-stats, plus rolling 252-day
  loadings. Alpha is the intercept, annualized, with its standard error.
- Walk-forward harness: `fit(trainWindow) → apply(testWindow) → roll`. Parameters: train length, test length, step.
  Output is a single concatenated out-of-sample return series plus the per-fold parameters.
- Cost model: proportional commission (bps) plus half-spread slippage (bps), applied to turnover. Defaults 5 bps
  each; both adjustable in the UI; both shown on every result.

**Method**

- OLS with HAC (Newey–West, lag 5) standard errors. Daily factor regressions have autocorrelated residuals; plain
  OLS t-stats overstate significance.
- Loadings are reported only when `n ≥ 120` daily observations.

**API**

- `GET /api/portfolios/:id/factors?range=` → `{ loadings: [{factor, beta, tStat}], alpha, alphaSe, n, rolling: [...] , dataThrough }`
- Walk-forward is a library (`research/walkForward.ts`). Phase B is the endpoint that uses it.

**UI**

- New **Factors** page: bar chart of loadings with error bars, rolling loadings line chart, alpha card with `n` and
  data-through date. Copy states that KLCI holdings are excluded and why.

**Tests**

- OLS against a hand-computed 3-point regression; HAC SE against a known reference; walk-forward fold boundaries
  (no overlap, no leakage, last partial fold dropped); cost model on a synthetic turnover series.

**Done when** the Factors page renders for the demo portfolio, the regression matches a spreadsheet check to 1e-6,
and the walk-forward harness has tests proving the test window never sees train data.

**Out of scope** Bursa factors (no clean public set), intraday factors, monthly-only regressions.

---

### Phase B — One signal, tested honestly: 12-1 momentum on the US sleeve `done`

**Why this signal.** Cross-sectional momentum is the most replicated anomaly in the literature (Jegadeesh–Titman
1993 onward), it is simple, and it is exactly what a reader with a finance background will expect to see tested.
It is also the one most likely to *fail after costs* on a five-name sleeve, which is a result worth showing.

**Scope**

- Universe: the portfolio's US symbols plus, optionally, a fixed liquid basket (e.g. the 30 largest US names by
  market cap held constant) so the cross-section is not two stocks wide. The basket list lives in a JSON file and is
  dated.
- Signal: trailing 12-month return skipping the last month. Rebalance monthly. Long top third; optional short
  bottom third (off by default, since the demo is long-only).
- Run through the Phase A walk-forward harness with costs. Report out-of-sample: annualized return, vol, Sharpe with
  SE, max drawdown, turnover, hit rate, and the Fama–French alpha of the strategy returns (so momentum exposure is
  controlled for, not just market beta).
- Compare against: buy-and-hold of the same universe, equal weight, and `^SP500TR`.

**Method**

- Returns are simple, total-return where dividends exist in the DB.
- Ranks use only data available at the rebalance date (close of the last session of the prior month).
- The signal has **no tuned parameters**. 12-1 monthly is the literature default; there is no sweep. If a sweep is
  ever added it must be reported in full (all cells), not by the best cell.

**API**

- `GET /api/research/momentum?portfolioId=&universe=holdings|basket&costsBps=&short=0|1`

**UI**

- New **Research** page with a strategy card: equity curve (strategy vs comparators, log scale), rolling 12-month
  excess return, turnover bar, and a results table with `n`, Sharpe ± SE, alpha ± SE. A visible line at the top
  states the conclusion in one sentence, including "does not beat buy-and-hold after costs" when that is the
  result.

**Tests**

- Signal ranking on a synthetic panel; rebalance dates on month ends including holidays; no look-ahead (a test
  that shifts prices one day later and asserts the signal changes accordingly); cost drag equals turnover × bps.

**Done when** the page shows the out-of-sample result for the demo portfolio and the basket, with costs, and the
README *What it is not* section is updated.

**Out of scope** Machine-learning models, more than one signal, parameter optimisation, Bursa universe.

---

### Phase C — Equal risk contribution weights `planned`

**Why.** MCTR/CCTR already say where risk sits. The natural next question is what weights would spread it evenly.
ERC needs only the covariance matrix, not expected returns, which is why it is preferred here over mean-variance.

**Scope**

- Solve for weights where every holding's component contribution to portfolio vol is equal. Fixed-point iteration
  on the existing sample covariance (Spinu 2013 formulation), long-only, fully invested.
- Show current weights vs ERC weights side by side, and the trades (in shares, rounded) that would move between
  them. Show portfolio vol before and after.
- Covariance shrinkage: Ledoit–Wolf constant-correlation target, shown as an option next to sample covariance.
  Report both sets of weights so the sensitivity to the estimator is visible.

**API** `GET /api/portfolios/:id/erc?range=&window=&shrink=0|1`

**UI** Panel on the Risk page under the component risk table.

**Tests** ERC on a 2-asset case with known closed form; on identical assets returns equal weights; shrinkage
intensity in [0, 1]; weights sum to 1 and are non-negative.

**Out of scope** Efficient frontier, return forecasts, transaction cost optimisation.

---

### Phase D — Bootstrap intervals `done`

**Why.** Sharpe's asymptotic SE and CAR's ±2 s.e. assume independence. Drawdown has no interval at all. Block
bootstrap gives honest intervals for all three with one method.

**Scope**

- Stationary block bootstrap (Politis–Romano), expected block length 20 sessions, 2,000 resamples, seeded.
- Intervals for: Sharpe, CAGR, max drawdown, event-study CAR at the final offset, momentum out-of-sample Sharpe.
- Display as `value [5th, 95th]` next to the existing point estimates. Overview cards gain a hint line; the Events
  and Research pages add a column.

**Tests** Resampled series preserves mean within tolerance; block boundaries wrap; seed reproducibility.

**Out of scope** Bayesian intervals, analytic drawdown distributions.

**Built** `research/bootstrap.ts`: Mulberry32 seed 1, mean block 20, 2,000 resamples, intervals withheld below 60
observations. Deviations from the scope above:

- The event-study CAR does not use the stationary bootstrap. Events are not a time series, and stocks reacting to
  the same FOMC date are correlated, so it resamples whole event dates (cluster bootstrap, at least 8 dates).
- Every interval is the 5th–95th percentile, so the UI labels it "90%", not the 95% that ±2 s.e. implies.
- Overview, Research (card hint and a "Sharpe 90% range" column) and Events (CAR card hint) show the ranges.

First live read: 1Y Sharpe 1.86, 90% [0.52, 3.10]; ALL-range CAGR 36.9%, 90% [−2.4%, 86.7%]. Momentum strategy
Sharpe 1.11 [0.67, 1.61] against buy-and-hold 1.13 [0.66, 1.63], so the two cannot be told apart. FOMC CAR+5 0.4%,
90% [−0.5%, 1.2%] over 40 dates.

---

### Phase E — Data quality page `done`

**Why.** Every check below already exists as a log line or an implicit assumption. Making them visible turns "the
number looks wrong" into a five-second diagnosis. Moved ahead of D after the recorder silently stopped for a week
in September 2026: a gap nobody can see is worse than an interval nobody has yet.

**Scope** Per symbol: last close date and staleness in sessions; missing sessions vs the exchange calendar; splits
recorded and whether a rebase was triggered; dividends with no bar on the ex-date; FX gaps; IV snapshot count and
last date, plus missed IV sessions. Last `SyncRun` per trigger with its error, if any. One table, red/amber/green,
sorted worst first.

**API** `GET /api/market/health`

**UI** **Data** page, or a section on Sync. Read-only.

**Tests** Staleness count across a weekend; gap detection on a synthetic series with one removed session.

**Built** `dataHealth.math.ts` (pure, tested) and `dataHealth.service.ts`; **Data** page. Changes from the plan:

- Rebases are not stored, so the check is on the outcome instead: a split date where the stored closes still jump by
  the split ratio is a history that was never rebased.
- The `^KLSE` calendar has a bar on 2026-06-01 (Agong's Birthday) that no Bursa stock traded. A date is dropped from
  the calendar when at least two of the market's series were live and none has a bar, and the page says so.
- Added a weekend-dated-rows check. It found the first real defect: Yahoo stamps `MYR=X` daily bars at 23:00 UTC,
  which is London midnight in summer time, so the sync stores each rate one calendar day early from about March to
  October (Monday's rate under Sunday, Friday's under Thursday). A valuation on day D read D+1's rate. Fixed:
  `fxBarDate` dates FX bars by the London day, and a sync that sees any weekend-dated FX row rewrites the stored
  range once. On this database weekend rows went 55 → 0 and missing FX days 58 → 2 (Easter 2025, a Yahoo gap);
  Mon–Thu snapshots moved slightly, Fridays did not (they had fallen back to Thursday's row, which held Friday's rate).
- Only IV gaps in the last 20 US sessions colour a row, since the older ones can never be filled.

---

### Phase F — Trade decision quality `planned`

**Why.** Realized P&L per closed lot exists. Whether the timing added or cost anything does not.

**Scope** Per transaction: fill vs that day's close, fill vs close 5 sessions later, fill vs close 20 sessions
later. Aggregate: mean and median timing contribution in bps, split by BUY and SELL, with `n`. Explicitly labelled
as descriptive; no significance claims below 30 trades.

**UI** Columns on the Transactions table, a small summary card on the closed-lots view.

**Tests** Timing contribution sign convention on a synthetic buy-then-rise and sell-then-rise case.

---

### Phase G — Five specialist agents, an orchestrator and a decision engine `next`

**Why.** The natural next question after "does one signal work" is "do several specialists, combined, forecast
anything?". Each agent here is a statistical model with one job and a public track record, not a language model with
opinions. The deliverable is the scoreboard: which agents have out-of-sample skill after costs, which do not, and
whether combining them beats the best single one. An honest "most of them have no edge" is a valid result
(principle 5).

**Flow**

```
Market data (prices, factors, events, recorded IV, recorded headlines)   ← existing sync + headline recorder
        │
Orchestrator      runs each agent, validates its output, logs an AgentRun row
        │
  ┌─────────┬─────────┬─────────┬─────────┬───────────┐
Technical  Quant     Event     Risk      Sentiment       ← five specialists, statistical models
  └─────────┴─────────┴─────────┴─────────┴───────────┘
        │
Decision engine   combines forecasts, applies risk limits, resolves conflicts, records the reason
        │
Agents page       scoreboard, decisions with their reasons, simulated portfolio vs comparators
```

No language model produces a number anywhere in this flow. The stack is the existing one: Python models in
`backend-py/app/research/agents/` (numpy, statsmodels, scikit-learn), Postgres via SQLAlchemy, the API's APScheduler
job, FastAPI, React. No separate service, task queue or Redis (principle 6); five agents over about 40 names run in
seconds inside the cron. (G1 was built in TypeScript and ported unchanged on 2026-10-03.)

**Orchestrator**

- `runAgents(asOf, trigger)` loads the data once, then runs each agent in turn. Each agent is a function from that
  data to forecasts; it does no I/O of its own.
- Every output is validated (Pydantic) before it is used: symbols in the universe, finite values, probabilities in
  [0, 1], one row per (agent, symbol, horizon).
- Each agent run writes an `AgentRun` row (agent, asOf, trigger, started, finished, ok, error, rows, model
  version), the same pattern as `SyncRun`. A failing agent does not stop the others; the decision engine runs on the
  agents that succeeded and the page names the ones that did not.
- Triggered by the month-end step of the daily cron, and by `scripts/run_agents.py` for a manual pass. Skips if an
  `AgentRun` for the same `asOf` already succeeded, so a restart does not double-record.

**Common contract**

- Primary horizon: one month, rebalanced at month end, same calendar as Phase B. Secondary horizon: five sessions,
  reported alongside after the same costs, never used for decisions. The secondary result is there to show what
  shorter horizons do to turnover, not to pick the better-looking one. Universe: the dated 30-name basket, plus
  the portfolio's US holdings when there are at least three.
- Every agent emits one forecast per (symbol, month end) using only data available at that close. Features are
  lagged one session; a shift test proves it (as in Phase B).
- Every agent is fitted inside the Phase A walk-forward harness: expanding train window, minimum 60 months, refit
  yearly, scored only on the following unseen months.
- Hyperparameters are fixed before the first run and written in this file. Ridge penalty is chosen by an inner
  walk-forward on the train folds only. No sweeps on test data.

**The five agents**

| Agent | Forecasts | Model | Inputs | Must beat |
| --- | --- | --- | --- | --- |
| Technical | Next-period return rank | Ridge, cross-sectional | 1, 3, 6 and 12-1 month returns; distance from 200-day mean | Plain 12-1 rank (Phase B) |
| Quant | Next-period return rank, and the probability of beating the universe median | Rolling FF5 + Mom loadings × trailing 12-month factor premia; probability by logistic regression on the same inputs | Stored Ken French factors | Zero forecast; 50% |
| Event | Next-period return rank and vol uplift | Per-name mean abnormal return and move size on past events of the types scheduled inside the period | Event study (FOMC, CPI, earnings) | Zero forecast |
| Risk | (a) Next-period realized vol per name; (b) probability the market falls ≥ 5% peak to trough within the period | (a) HAR (Corsi 2009) by OLS; (b) logistic regression (IRLS) | (a) Daily, weekly, monthly Garman–Klass vol, recorded ATM IV once 252 sessions exist; (b) index vol level, vol of vol, mean pairwise correlation, index trend | (a) Trailing vol; (b) base rate |
| Sentiment | Next-period return rank | Net tone of recorded headlines over the trailing period, Loughran–McDonald finance word lists | Headlines recorded forward by the sync | Zero forecast |

The Risk agent's vol forecast needs only OHLC, so it also covers Bursa holdings. The return-rank agents stay US-only
for the same reason as Phase A. The Portfolio role from the original sketch ("does the expected return justify the
risk?") is the decision engine's job, so it is not a separate agent.

**Sentiment is recorded forward.** Free news sources serve current headlines only, so the sync records them into a
`NewsHeadline` table (symbol, published, title, publisher, source id unique) the same way `ImpliedSnapshot` is
recorded (principle 7). The Sentiment agent emits forecasts from the first recorded month but gets no weight and no
verdict until 12 scored months exist; until then the page shows recording progress. The word lists are free for
non-commercial use, which covers this repo. Scoring headlines with a language model is deferred (section 4).

**Index view.** The Quant and Risk agents also emit a forecast for `SPY` itself, shown separately as a market-timing
view. One series gives far fewer independent tests than a 30-name cross-section, and the page says so beside it.

**Scoring** (out-of-sample only, each with `n` and a Phase D bootstrap interval)

- Return-rank agents: mean monthly Spearman IC with Newey–West SE, hit rate, top-minus-bottom third spread after
  costs. Power check stated on the page: with about 70 test months, mean IC needs to be roughly 0.035 or more to
  clear t = 2.
- Risk (a): QLIKE and MSE against the trailing-vol baseline, with a Diebold–Mariano test.
- Probabilities (Quant's beat-the-median, Risk (b)): Brier skill score against the naive rate, and a reliability
  table (forecast bucket vs observed frequency). A "56%" is only reported as such if forecasts in that bucket came
  true about that often.

**Decision engine**

Rules are fixed in advance and applied in this order. Each decision row records which rules fired.

1. **Combine.** Return score per name = weighted mean of the return-rank agents' standardized forecasts. Weights are
   proportional to each agent's trailing out-of-sample IC, floored at zero, shrunk halfway toward equal weight. An
   agent with negative trailing IC, or without 12 scored months (Sentiment at first), gets no weight.
2. **Conflict.** A name in the top third by score is held only if agents carrying at least half of the weight rank
   it above the median. Otherwise it is skipped and recorded as "skipped: agents disagree".
3. **Size.** Held names are weighted by inverse Risk-agent vol forecast, long-only, fully invested.
4. **Risk limit.** When the Risk agent's drawdown probability is above its own trailing 80th percentile, gross
   exposure is halved and the rest sits in cash.
5. **Evaluate.** Through the Phase A cost model, against buy-and-hold, equal weight, the best single agent and
   `^SP500TR`, with Fama–French alpha like Phase B.

The page explains each decision from the recorded rules, e.g. "Exposure halved: drawdown probability 0.31, above its
80th percentile of 0.24. NVDA skipped: Technical and Event rank it top, Quant and Sentiment rank it below median."
These sentences come from templates filled with the recorded numbers, not from a language model.

**Live record.** The backtest and the live record are shown separately. The orchestrator writes each agent's
forecasts to `AgentForecast` (agent, symbol, asOf, horizon, value, model version) and each decision to
`AgentDecision` (asOf, symbol, weight, rules fired); rows are never updated. Live skill is scored only on those rows
and starts the day this ships (principle 7).

**API** `GET /api/research/agents` (scoreboard, latest run status, decision engine result),
`GET /api/research/agents/:agent` (detail and current forecasts), `GET /api/research/agents/decisions?asOf=`.

**UI** **Agents** page: latest orchestrator run with each agent's status; a scoreboard with one row per agent and
horizon (metric, `n`, value [5th, 95th], vs baseline, verdict in words); the decision engine's equity curve against
the comparators; the current decisions with their reasons; the correlation between agents' forecasts, so it is
visible when two "specialists" say the same thing; Sentiment recording progress until it is scored.

**Delivery**

- G1 (`done`): `AgentRun`, `AgentForecast` and `NewsHeadline` tables; orchestrator; headline recorder in the sync
  (first, because only time fills it); Technical agent and Risk (a); scoreboard.
- G2: Quant, Event and Risk (b); five-session horizon; index view.
- G3: decision engine with `AgentDecision`, Sentiment agent, live recording at month end, Agents page complete.

**Tests** Shift test per agent (prices moved one session later change the forecast; future prices never do); zod
rejects a malformed agent output and the run continues without that agent; a second orchestrator pass for the same
`asOf` does nothing; HAR recovers known coefficients on simulated data; logistic regression on a separable and a
noisy synthetic set; IC equals 1 on a perfect ranking and about 0 on noise; tone scoring on hand-labelled headlines;
decision rules on a synthetic case for each rule, including a skipped conflict and a halved exposure; weights sum to
1 and give zero to negative-IC agents; forecast and decision rows are append-only.

**Out of scope** Language-model forecasts, deep learning, gradient boosting (no dependency-free implementation worth
trusting yet), a separate ML service, task queues, intraday features, parameter sweeps.

**Built (G1)** Pure code in `research/agents/`; data loading, the month-end pass and the overview in
`services/agents.service.ts`; headlines in `services/headlines.service.ts`; Agents page.

Fixed hyperparameters, as promised above:

- Technical: features standardised across names each month and capped at ±3; target is next month's total-return
  rank scaled to [−0.5, 0.5]; ridge penalty from {0.01, 0.1, 1, 10} on mean-squared-error scale, picked by the best
  mean IC over the last 24 training months (two yearly inner folds, ties to the stronger penalty).
- Risk (a): HAR in variance levels by OLS, per name, on daily rows whose target is the mean Garman–Klass variance of
  the next 22 sessions. Forecasts are floored at the calmest 22-session stretch in training.
- Both: expanding window, 60 month ends before the first forecast, refit every 12; a training row is used only if its
  outcome was complete before the first test month's inputs were read (features are read one session before the
  month-end close).
- Scoring: monthly Newey–West with 3 lags; bootstrap intervals in 3-month blocks, because the 20-session default is
  for daily series; verdicts only from 12 scored months.

Deviations and decisions:

- `AgentForecast` carries a `target` column and is unique on (agent, symbol, asOf, horizon, target), because Quant
  and Risk emit two forecasts each in G2. `NewsHeadline` is unique on (symbol, source id), because one headline is
  often filed under several symbols. A headline is kept only if Yahoo tags it with the symbol searched.
- `asOf` is the last session of the latest month whose bars are all in: the stored month counts only when its last
  `^GSPC` bar is the month's last weekday and that session has closed. The pass refreshes the basket's prices first
  (they are not synced daily), and deepens any name with less history than 2015.
- Universe is the basket plus every name in any portfolio, not per portfolio: the pass runs in the cron, outside any
  user. Bursa names get Risk forecasts only.
- **Risk (a) was respecified once after seeing test results.** The first version fitted HAR on one non-overlapping
  sample per month, about 60 per name. Those fits were unstable: forecasts often hit the floor (ORCL, December 2025:
  8% against a trailing 39%), and it lost to trailing vol on QLIKE, 0.354 against 0.225 (Diebold–Mariano t = −3.1).
  Daily rows are how Corsi estimates HAR, so the change restores the stated method rather than tuning it; it was
  made before any live forecast was recorded, and it is the only change.

First read (asOf 2026-09-30, out of sample):

| Agent | Months | Result | Baseline |
| --- | --- | --- | --- |
| Technical | 68 (2021-01 to 2026-08), 30 names | Mean IC −0.003, 90% [−0.055, 0.052], t = −0.10; top-minus-bottom third −1.2% a year after costs | 12-1 momentum IC 0.019; difference t = −0.79 |
| Risk (a) | 79 (2020-02 to 2026-08), 39 names | QLIKE 0.217; gain 0.012, 90% [−0.003, 0.027], DM t = 1.24; MSE 0.68× trailing | Trailing vol QLIKE 0.229 |

Neither has shown skill: the Technical agent ranks no better than chance, and HAR is not distinguishable from
carrying last month's vol forward on QLIKE, though its squared errors are about a third smaller. The live record starts with
the 2026-09-30 forecasts (30 Technical, 39 Risk).

---

## 4. Deferred and rejected

| Item | Status | Reason |
| --- | --- | --- |
| Efficient frontier | deferred | Only after Phase C, only with shrinkage, and only as a comparison to ERC |
| Chat assistant that produces numbers | rejected | Cannot meet principle 1 |
| Chat that only composes Chart workspace views | deferred | Low value relative to effort |
| Bursa factor model | deferred | No public daily factor set; would have to be constructed and could not be validated |
| Intraday data, order routing, live feeds | rejected | Principle 6 |
| CI pipeline | done | `.github/workflows/ci.yml`: backend typecheck and tests, frontend typecheck and lint, on `main` / `dev` pushes and PRs |
| CSV broker import, production auth | deferred | Engineering, not research; revisit when the research layer is done |
| Historical IV backfill from a proxy (e.g. realized vol) | rejected | Principle 7 |
| Language-model agents that forecast prices | rejected | No measurable skill, and their training data contains the "future" of any backtest window, so the test leaks. Principles 1 and 2 |
| Language-model analyst over Phase G | deferred | Only to describe the agents' numbers, never to produce one. Needs an API key and per-call cost |
| Language-model headline scoring for the Sentiment agent | deferred | Word lists first, because they are testable and free; a local model (Ollama) could be compared against them later on the same recorded headlines |
| Separate ML service, BullMQ + Redis, TimescaleDB | rejected for now | A second runtime, a queue and a store for a workload that runs in seconds on ~100k rows. The API itself moved to Python (FastAPI) on 2026-10-03, so models live in it directly (principle 6) |
| Fix `latestSession` DST offset | recommended | Applies today's UTC offset to the session day, so the close is an hour off across a DST change. Ported bug for bug for parity; fix, with a test on the March and November weekends |
| Fix the covariance matrix behind risk shares | recommended | `sample_covariance_matrix` fills only the upper triangle (the TS original wrote `cov[i][j]` twice). Risk shares and the correlation matrix read zeros below the diagonal. Ported bug for bug; fix and re-check the Risk page |
| Gradient-boosted agents | deferred | After G, if a linear agent shows skill worth trying to improve |

---

## 5. Order and dependencies

```
A  factors + walk-forward + costs
└─ B  momentum (needs A for alpha control, harness, costs)
   └─ D  bootstrap (adds intervals to B's results; also to Overview and Events)
      └─ G  five agents + orchestrator + decision engine (needs A's harness and costs, B's calendar and
            signal, D's intervals; G1's headline recorder can start earlier, since only time fills it)
C  ERC  (independent; needs only existing covariance)
E  data quality (independent; uses SyncRun and the missed-session check)
F  trade quality (independent; needs only transactions and prices)
CI (independent)
```

A → B → D → G is the research spine. A, B, D, E, CI and G1 are done; G2 is next. C and F can be picked up in any gap.

---

## 6. Conventions for new modules

- Pure math in `backend-py/app/services/*_math.py` or `backend-py/app/research/`, no database imports, unit tested
  with pytest.
- Service wraps math with data loading (SQLAlchemy session passed in); router validates with Pydantic; route is
  `GET`, auth required (`UserId` dependency). Responses are plain dicts with camelCase keys, serialised the way the
  Node API did (`NodeRoute`).
- Schema changes: edit `app/models.py`, `uv run alembic revision --autogenerate`, read the generated file, keep only
  the intended change.
- Frontend: one hook per endpoint (`useX.ts`), types in `api.types.ts`, page composed from small components under
  `components/<area>/`.
- Every response payload carries `n`, a `notes: string[]` array for caveats, and where relevant `dataThrough`.
- README gets one bullet under *What it does* and one row in the API table per shipped phase.
- Commit messages: conventional, one line, no auto-commit.

---

## 7. Open questions

1. **Phase B universe.** Resolved: both, selectable. The basket is `momentumBasket.json`, dated 2026-01-01. Holdings
   with fewer than three US names are reported as not a cross-sectional test.
2. **Phase A refresh.** Resolved: the cron refreshes when the stored tail is older than 7 days, and
   `scripts/refresh_factors.py` forces a download. The page states the data-through date.
3. **Where Research lives in the nav.** New top-level page, or a tab inside Events? Default: new page, since the
   Events page is already long.

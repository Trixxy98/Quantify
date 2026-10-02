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
| Data | Recorder reliability | done | `SyncRun` table; API syncs on startup if nothing finished since the last US close; `npm run sync:daily` for launchd. Sessions from 2026-09-28 until the first catch-up have no IV row and are listed on Events, not filled |
| Measurement | TWR with dividend income, realized P&L, closed lots | done | |
| Risk | Correlation, GK vs C2C vol, MCTR/CCTR, VaR/ES + Kupiec, drawdowns, rolling vol/beta | done | `risk.math.ts`, `risk.service.ts` |
| Research | Event study (FOMC / CPI / earnings), event-only rule | done | |
| Research | Variance premium: term-structure implied move vs realized event moves | done | IV rank blank until 20 recorded sessions |
| Research | Fama–French 5 + momentum on the US sleeve, walk-forward harness, cost model | done | Factors page. French data through the last monthly file. Loadings need 120 sessions |
| Research | 12-1 momentum, walk-forward, after costs | done | Research page. Fixed 30-name basket dated 2026-01-01, or the portfolio's US holdings |
| Data | Data quality page | done | Data page. Found the USD/MYR one-day date shift, now fixed (see Phase E) |
| Tooling | Chart workspace, saved views | done | |
| Tests | Vitest across metrics, corporate actions, lots, risk math, premium, IV snapshot, OLS, walk-forward, momentum | done | |

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

### Phase D — Bootstrap intervals `next`

**Why.** Sharpe's asymptotic SE and CAR's ±2 s.e. assume independence. Drawdown has no interval at all. Block
bootstrap gives honest intervals for all three with one method.

**Scope**

- Stationary block bootstrap (Politis–Romano), expected block length 20 sessions, 2,000 resamples, seeded.
- Intervals for: Sharpe, CAGR, max drawdown, event-study CAR at the final offset, momentum out-of-sample Sharpe.
- Display as `value [5th, 95th]` next to the existing point estimates. Overview cards gain a hint line; the Events
  and Research pages add a column.

**Tests** Resampled series preserves mean within tolerance; block boundaries wrap; seed reproducibility.

**Out of scope** Bayesian intervals, analytic drawdown distributions.

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

### Phase G — Specialist forecasting agents and a manager `planned`

**Why.** The natural next question after "does one signal work" is "do several specialists, combined, forecast
anything?". Each agent here is a statistical model with one job and a public track record, not a language model with
opinions. The deliverable is the scoreboard: which agents have out-of-sample skill after costs, which do not, and
whether combining them beats the best single one. An honest "most of them have no edge" is a valid result
(principle 5).

**Common contract**

- Horizon: one month, rebalanced at month end, same calendar as Phase B. Universe: the dated 30-name basket, plus
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
| Trend | Next-month return rank | Ridge, cross-sectional | 1, 3, 6 and 12-1 month returns; distance from 200-day mean | Plain 12-1 rank (Phase B) |
| Factor | Next-month return rank | Rolling FF5 + Mom loadings × trailing 12-month factor premia | Stored Ken French factors | Zero forecast |
| Volatility | Next 21-session realized vol | HAR (Corsi 2009) by OLS | Daily, weekly, monthly Garman–Klass vol; recorded ATM IV once 252 sessions exist | Trailing 21-session vol |
| Event | Next-month return rank and vol uplift | Per-name mean abnormal return and move size on past events of the types scheduled inside the month | Event study (FOMC, CPI, earnings) | Zero forecast |
| Risk | Probability the market falls ≥ 5% peak to trough within the month | Logistic regression (IRLS) | Index vol level, vol of vol, mean pairwise correlation, index trend | Base rate |

The Volatility agent needs only OHLC, so it also covers Bursa holdings. The return-rank agents stay US-only for the
same reason as Phase A.

**Scoring** (out-of-sample only, each with `n` and a Phase D bootstrap interval)

- Return-rank agents: mean monthly Spearman IC with Newey–West SE, hit rate, top-minus-bottom third spread after
  costs. Power check stated on the page: with about 70 test months, mean IC needs to be roughly 0.035 or more to
  clear t = 2.
- Volatility: QLIKE and MSE against the trailing-vol baseline, with a Diebold–Mariano test.
- Risk: Brier skill score against the base rate, and a reliability table (forecast bucket vs observed frequency).

**Manager**

- Combines the return-rank agents with weights proportional to each one's trailing out-of-sample IC, floored at
  zero and shrunk halfway toward equal weight. An agent with negative trailing IC gets no weight.
- Sizes positions by inverse Volatility-agent forecast; cuts gross exposure by half when the Risk agent's
  probability is above its own 80th percentile.
- Long the top third, through the Phase A cost model, against buy-and-hold, equal weight, the best single agent and
  `^SP500TR`. Reports Fama–French alpha like Phase B.

**Live record.** The backtest and the live record are shown separately. A month-end step in the cron writes each
agent's forecasts to an `AgentForecast` table (agent, symbol, month, forecast, model version); rows are never
updated. Live skill is scored only on those rows and starts the day this ships (principle 7).

**API** `GET /api/research/agents` (scoreboard and manager), `GET /api/research/agents/:agent` (detail and current
forecasts).

**UI** **Agents** page: a scoreboard table with one row per agent (metric, `n`, value [5th, 95th], vs baseline,
verdict in words); the manager's equity curve against the comparators; a table of the current month's forecasts for
the holdings; the correlation between agents' forecasts, so it is visible when two "specialists" say the same thing.

**Delivery**

- G1: harness wiring, `AgentForecast` table, Trend and Volatility agents, scoreboard.
- G2: Factor, Event and Risk agents.
- G3: manager, live recording in the cron, Agents page complete.

**Tests** Shift test per agent (prices moved one session later change the forecast; future prices never do); HAR
recovers known coefficients on simulated data; logistic regression on a separable and a noisy synthetic set; IC
equals 1 on a perfect ranking and about 0 on noise; manager weights sum to 1 and give zero to negative-IC agents;
`AgentForecast` rows are append-only.

**Out of scope** Language-model forecasts, deep learning, gradient boosting (no dependency-free implementation
worth trusting yet), news or sentiment, intraday features, parameter sweeps.

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
| Sentiment agent | deferred | No news or social data source in the app |
| Gradient-boosted agents | deferred | After G, if a linear agent shows skill worth trying to improve |

---

## 5. Order and dependencies

```
A  factors + walk-forward + costs
└─ B  momentum (needs A for alpha control, harness, costs)
   └─ D  bootstrap (adds intervals to B's results; also to Overview and Events)
      └─ G  forecasting agents + manager (needs A's harness and costs, B's calendar and signal, D's intervals)
C  ERC  (independent; needs only existing covariance)
E  data quality (independent; uses SyncRun and the missed-session check)
F  trade quality (independent; needs only transactions and prices)
CI (independent)
```

A → B → D → G is the research spine. E comes next because the data under the spine has to be visibly sound first; CI can
land alongside it. C and F can be picked up in any gap.

---

## 6. Conventions for new modules

- Pure math in `backend/src/services/*.math.ts` or `backend/src/research/*.ts`, no Prisma imports, unit tested.
- Service wraps math with data loading; controller validates with zod; route is `GET`, auth required.
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
   `npm run factors:refresh` forces a download. The page states the data-through date.
3. **Where Research lives in the nav.** New top-level page, or a tab inside Events? Default: new page, since the
   Events page is already long.

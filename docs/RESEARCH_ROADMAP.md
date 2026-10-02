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

### Phase D — Bootstrap intervals `planned`

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

### Phase E — Data quality page `next`

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

---

### Phase F — Trade decision quality `planned`

**Why.** Realized P&L per closed lot exists. Whether the timing added or cost anything does not.

**Scope** Per transaction: fill vs that day's close, fill vs close 5 sessions later, fill vs close 20 sessions
later. Aggregate: mean and median timing contribution in bps, split by BUY and SELL, with `n`. Explicitly labelled
as descriptive; no significance claims below 30 trades.

**UI** Columns on the Transactions table, a small summary card on the closed-lots view.

**Tests** Timing contribution sign convention on a synthetic buy-then-rise and sell-then-rise case.

---

## 4. Deferred and rejected

| Item | Status | Reason |
| --- | --- | --- |
| Efficient frontier | deferred | Only after Phase C, only with shrinkage, and only as a comparison to ERC |
| Chat assistant that produces numbers | rejected | Cannot meet principle 1 |
| Chat that only composes Chart workspace views | deferred | Low value relative to effort |
| Bursa factor model | deferred | No public daily factor set; would have to be constructed and could not be validated |
| Intraday data, order routing, live feeds | rejected | Principle 6 |
| CI pipeline | planned | GitHub Actions: backend tests and typecheck, frontend typecheck and lint. Cheap, and 100+ tests that only run locally prove less |
| CSV broker import, production auth | deferred | Engineering, not research; revisit when the research layer is done |
| Historical IV backfill from a proxy (e.g. realized vol) | rejected | Principle 7 |

---

## 5. Order and dependencies

```
A  factors + walk-forward + costs
└─ B  momentum (needs A for alpha control, harness, costs)
   └─ D  bootstrap (adds intervals to B's results; also to Overview and Events)
C  ERC  (independent; needs only existing covariance)
E  data quality (independent; uses SyncRun and the missed-session check)
F  trade quality (independent; needs only transactions and prices)
CI (independent)
```

A → B → D is the research spine. E comes next because the data under the spine has to be visibly sound first; CI can
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

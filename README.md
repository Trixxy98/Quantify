# Quantify

Personal portfolio analytics for **Bursa Malaysia** and **US** stocks. Not a broker.

You enter BUY/SELL trades. Quantify rebuilds holdings, pulls Yahoo Finance prices, and shows P&L, risk metrics, attribution, and simple market scenarios in **MYR or USD**.

## Stack

| Layer | Tech |
| --- | --- |
| App | React 19, Vite, Tailwind CSS v4, TanStack Query, Zustand, Recharts |
| API | Python 3.13, FastAPI, SQLAlchemy 2, Alembic, PostgreSQL 16 |
| Numerics | numpy, pandas, scipy, statsmodels (Newey–West OLS), scikit-learn (ridge) |
| Market data | Yahoo Finance through [yfinance](https://github.com/ranaroussi/yfinance)'s data client (`DailyPrice`, FX `MYR=X`, `^KLSE`, `^GSPC`, `^SP500TR`, option chains, headlines) |

Repo layout: `frontend/` and `backend-py/`. Postgres runs in Docker (`quantify-db` on `127.0.0.1:5434`).

The API was Express + Prisma until 2026-10-03 (see [Migration to Python](#migration-to-python)).

## What it does

- Auth (JWT access + refresh)
- Multiple portfolios (create / rename / delete)
- Transactions: add, edit, delete — holdings qty and avg cost are replayed from the ledger
- After a trade: fetch that ticker (and FX/benchmarks if the cache is thin), then rebuild **this** portfolio’s snapshots
- **Overview** — value, today, unrealized P&L, Sharpe (with its error bar), CAGR, vol, beta, alpha, max drawdown (Sharpe, CAGR and drawdown with 90% block-bootstrap ranges), dividends collected, vs blended KLCI/S&P 500 TR
- **Analysis** — contribution by name (stock vs FX), variance share, trailing beta; sliders for KLCI / S&P / USD-MYR (linear estimate, not a forecast)
- **Risk** — correlation, Garman–Klass vs close-to-close vol, marginal and component risk, historical VaR / expected shortfall with a Kupiec breach test, underwater chart and worst drawdowns
- **Factors** — Fama–French five-factor plus momentum regression of the US sleeve (USD), Newey–West t-stats, rolling 252-day loadings. Bursa holdings are excluded
- **Research** — 12-1 cross-sectional momentum on a fixed US large-cap basket or the portfolio's US holdings. Monthly, top third, walk-forward, after commission and slippage, against buy-and-hold, equal weight, and the S&P 500 total return
- **Agents** — specialist forecasting models scored out of sample (statistical models; no language model produces a number). Technical: cross-sectional ridge on 1/3/6-month returns, 12-1 momentum and distance from the 200-day mean, against plain 12-1 momentum. Risk: per-name HAR forecast of next month's vol, against carrying last month's vol forward. Each has mean IC or QLIKE gain with Newey–West t and a 90% bootstrap range, plus a verdict in words. Every month end the forecasts are recorded before the outcome is known (the live record, never edited). The sync also records headlines forward for a later Sentiment agent
- **Chart** — compose portfolio, KLCI, S&P 500 TR, a holding, drawdown, and rolling vol/beta on two axes; save the layout in the browser
- **Holdings** — table + price chart with **avg cost** and **max drawdown** (peak → trough in the selected range); closed lots with realized P&L
- **Transactions** — symbol search, close-price fill on trade date
- **Vol** — US options chain, Black–Scholes implied vol (Newton + bisection), 3D surface + skew/term slices
- **Events** — event study around Fed days, CPI releases and earnings: market-model abnormal returns, CAR with a ±2 s.e. band, event-day vs other-day return distributions, an event-only trading rule, and today's ATM straddle versus the median realized move on past events (not a historical IV backtest)
- **Data** — read-only checks on every stored series behind those pages, worst first: sessions behind and missing against the exchange calendar (from `^GSPC` / `^KLSE`, with index bars on holidays nobody traded dropped), split dates where closes still jump by the split ratio, dividends that go ex on a day with no bar, rows dated on a weekend (a time-zone stamp error), implied-vol gaps, and the latest sync run per trigger with its error
- Manual **Sync** still exists for a full market pass
- Daily cron: 6:30am MYT, Tue–Sat (after the US close). It also records the front-month ATM implied vol of every US name (plus SPY) into `ImpliedSnapshot`, because Yahoo serves only today's chain — IV rank on the Events page is built from these rows and stays blank until 20 sessions exist. For the same reason it records the day's Yahoo headlines per US name into `NewsHeadline`, and on the first run after a month ends it runs the agents' month-end pass
- The cron lives in the API process, so it only fires if the API is up at 6:30. On startup the API checks the `SyncRun` table and syncs straight away if nothing has finished since the last US close. Sessions it was down for still have no IV row (the chain is gone), and the Events page lists them. See [Keeping the recorder running](#keeping-the-recorder-running) to sync without the API

## How numbers work

1. `Transaction` is the source of truth.
2. `Holding` is recomputed by replaying buys/sells (weighted avg cost in **native** currency), with share counts restated through any split that happened after the trade.
3. Snapshots mark the book daily in **base currency**, and record the dividends that went ex that day.
4. **Unrealized P&L** (Overview, Holdings, allocation) uses:
   - **Cost** at **trade-time** FX
   - **Value** at the **latest** FX  
   Same definition everywhere. Avg cost on the holdings table stays native (e.g. RM for `.KL`).
5. **Realized P&L** is weighted-average on each sell: proceeds minus the average cost of the shares sold (buy fees in cost, sell fees against proceeds). A **closed lot** is a round trip — first buy after flat until the position is sold to zero. Partial sells still book realized P&L; they just do not emit a lot until the book is flat. Closed symbols stay on the price sync list so the chart does not go blank after you sell out.

Tickers: `.KL` → Bursa / MYR; anything without a dot → US / USD.

### Return and risk

Every risk figure on Overview is measured on the **time-weighted, dividend-inclusive** return series, never on raw NAV. Deposits and withdrawals are stripped out of the daily return, so paying money in is not a gain and taking money out is not a drawdown. Dividends are added back on the ex-date, so the price drop that day is not read as a loss.

The US benchmark is `^SP500TR`, the total-return version of the index, because comparing a dividend-inclusive portfolio against a price index would hand the portfolio free alpha. `^GSPC` stays in the database for price-vs-price work (per-symbol beta on Analysis, event studies) and is used as a fallback on the chart until a sync has pulled `^SP500TR`.

Sharpe ships with its asymptotic standard error, and Overview says so out loud when a range holds fewer than 60 daily observations. A Sharpe of 1.4 over three months is not a measurement.

The standard error assumes independent days, which daily returns are not, and drawdown has no formula at all. So Sharpe, CAGR and max drawdown also carry a 90% range from a stationary block bootstrap (Politis–Romano): 2,000 resamples built from blocks of about 20 sessions, seeded so the numbers do not move between page loads. The same ranges appear on the momentum Sharpe (Research) and the final CAR (Events). The event study resamples whole event dates rather than days, because stocks reacting to the same Fed meeting are not independent of each other. Ranges are withheld below 60 observations or 8 event dates. Over the full history the demo book's CAGR range still includes zero.

### Corporate actions

Yahoo restates its whole price history when a stock splits. Because a sync only rewrites a trailing window, the rows outside that window would keep the old basis and leave a fake cliff in the return series. Each sync therefore compares the oldest stored close against what Yahoo now reports for that same day; if they disagree by more than 0.5% the series was rebased and the full history is rewritten. Splits and dividends are pulled from the start of history regardless of the price window, so a short cron pass cannot miss one.

## What it is not

- No orders, custody, or live quotes as a trading feed
- No FIFO tax lots: realized P&L is weighted average, which is what the holdings table already uses
- KLCI has no total-return version on Yahoo, so the Bursa leg of the benchmark is still a price index and is understated by roughly its dividend yield
- Dividends are counted from the ex-date at the gross amount — no withholding tax, no payment-date lag
- No chart-pattern or discretionary signals. The tested rules are 12-1 momentum and the Technical agent, both walk-forward, and their pages state when they show no skill (as of 2026-09 neither does)
- IV surface is European Black–Scholes on US listed chains (American options ≈ teaching approx)
- Event dates are best-effort: FOMC is the official Fed calendar, but earnings dates are derived from Yahoo's 10-Q/10-K list (Yahoo does not publish historical announcement dates) and CPI needs a FRED key
- Scenario shocks are `weight × beta × index + FX sensitivity`, not a model

## Setup

**Need:** Docker, [uv](https://docs.astral.sh/uv/) (it installs Python 3.13 itself), Node 20+ for the frontend, two terminals.

```bash
# 1. Postgres
cp .env.example .env
docker compose up -d

# 2. API
cd backend-py
cp .env.example .env
# Set JWT_ACCESS_SECRET and JWT_REFRESH_SECRET to ≥32 characters
uv sync
uv run alembic upgrade head    # empty database: creates the schema
uv run python -m app --reload
# http://localhost:4000  —  GET /health
SEED_EMAIL=you@example.com uv run python scripts/seed.py   # optional sample trades; register that account first

# 3. App
cd frontend
cp .env.example .env
npm install
npm run dev
# http://localhost:5173
```

Root `.env` is for Compose (`POSTGRES_*`). `backend-py/.env` `DATABASE_URL` must match that user/password/db/port (`5434` by default). Frontend `VITE_API_URL=http://localhost:4000/api`.

A database first built by Prisma is adopted with `uv run alembic stamp head` (it runs no DDL). From then on schema changes go through Alembic only: `uv run alembic revision --autogenerate -m "..."`, read the file, then `uv run alembic upgrade head`. Alembic keeps its version table in its own `alembic` schema.

`SCHEDULER_ENABLED=true` runs the daily sync and the startup catch-up inside the API. Only one process may have it on.

Optional: `RISK_FREE_RATE` on the API (default `0.03`) for Sharpe/alpha and the IV surface.

Optional: `FRED_API_KEY` ([free](https://fredaccount.stlouisfed.org/apikeys)) to load CPI release dates for the Events page — BLS blocks automated fetches of its own schedule, so run `uv run python scripts/fetch_cpi_dates.py` once and the dates are written into `app/data/macroEvents.json`. Fed days ship with the repo and need no key.

## API (auth required except `/health` and `/api/auth/*`)

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/auth/register` `login` `refresh` `logout` | |
| CRUD | `/api/portfolios` | |
| GET | `/api/portfolios/:id/summary` `metrics` `performance` `allocation` `analysis` `risk` `factors` | `?range=` `1M` `3M` `6M` `1Y` `YTD` `ALL`. Risk also takes `?window=` `20` `60` `120` |
| GET | `/api/portfolios/:id/holdings` `closed-lots` `transactions` `prices/:symbol` | |
| POST/PATCH/DELETE | `/api/portfolios/:id/transactions` | Edit/delete recomputes holdings |
| GET | `/api/market/search` `close` `iv-surface` | Yahoo search; close; US options IV surface |
| GET | `/api/events/study` | `?symbols=` `type=FOMC\|CPI\|EARNINGS` `pre=` `post=` `years=` `hold=` |
| GET | `/api/events/premium` | `?symbol=` `type=FOMC\|CPI\|EARNINGS` `years=` — today's straddle vs past realized event moves, plus IV rank from recorded snapshots |
| GET | `/api/research/momentum` | `?universe=holdings\|basket` `portfolioId=` `commissionBps=` `slippageBps=` `short=0\|1` |
| GET | `/api/research/agents` | Agents page: scoreboard recomputed from stored prices, latest run per agent, recorded live forecasts, headline recording progress |
| GET | `/api/market/health` | Data page: staleness and missing sessions per series vs the exchange calendar, split cliffs, dividends with no bar, weekend-dated rows, IV recording gaps, latest sync run per trigger |
| POST | `/api/sync` | Full price + snapshot rebuild |

## Scripts

**API** (in `backend-py/`, each prefixed with `uv run`):

| Command | What it does |
| --- | --- |
| `python -m app [--reload]` | Serve on `API_PORT` |
| `pytest` | Unit tests and golden fixtures; pure, no database |
| `ruff check .` · `mypy app` | Lint, types |
| `alembic upgrade head` · `alembic revision --autogenerate -m "..."` | Migrations |
| `python scripts/sync_daily.py [--force]` | The cron's pass without the API |
| `python scripts/run_agents.py` | Month-end agent pass (the sync already runs it; skips agents that succeeded for the latest complete month) |
| `python scripts/refresh_factors.py` | Re-download the Ken French factors |
| `python scripts/fetch_cpi_dates.py` | CPI release dates from FRED |
| `python scripts/seed.py` | Sample trades for `SEED_EMAIL` |
| `python scripts/compare_bars.py` | Read-only check that a fresh Yahoo pull matches the stored bars |

**Frontend:** `npm run dev` · `npm run build` · `npm run lint`

**CI:** `.github/workflows/ci.yml` runs the Python API's lint, types and tests, and frontend typecheck and lint, on pushes to `main` / `dev` and on pull requests. The tests are pure and need no database.

### Keeping the recorder running

`uv run python scripts/sync_daily.py` does the same pass as the cron without the API. It skips when a sync has already finished after the last US close, or when another process is mid-sync, so it is safe alongside the API's own job. On a Mac, save this as `~/Library/LaunchAgents/com.quantify.sync.plist` (fix the path) and run `launchctl load` on it. It fires at 07:00 local time, and launchd runs a missed job when the Mac wakes. Postgres must be up.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.quantify.sync</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string><string>-lc</string>
    <string>cd /path/to/Stocks-portfolio/backend-py &amp;&amp; ~/.local/bin/uv run python scripts/sync_daily.py</string>
  </array>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>7</integer><key>Minute</key><integer>0</integer></dict>
  <key>StandardOutPath</key><string>/tmp/quantify-sync.log</string>
  <key>StandardErrorPath</key><string>/tmp/quantify-sync.log</string>
</dict>
</plist>
```

## Notes

- A new database has no splits, dividends or `^SP500TR` until the first **Sync**, so dividends read as zero and the chart falls back to the S&P price index.
- USD/MYR bars are dated by the London day, because Yahoo stamps them at London midnight (23:00 UTC in summer). A database synced before this fix has FX rows a day early; the next sync sees the weekend-dated rows and rewrites the stored FX range once.
- First save of a **new** ticker waits on Yahoo; editing qty on a known name is mostly a snapshot rebuild.
- Charts and metrics need price history. If a range is empty, Sync or pick a longer range.
- Refresh tokens live in client storage (fine for local use, not a production auth story).
- `POST /api/sync` is any logged-in user — there is no admin role.

## Migration to Python

The API moved from Express + Prisma to FastAPI + SQLAlchemy on 2026-10-03, on the same database and with the same JSON contract, so the frontend did not change. Every module was ported against the Node API, not rewritten from its description:

- **Golden fixtures.** A script in the Node API ran the TS pure functions on fixed inputs and wrote 166 cases to `backend-py/tests/fixtures/`. The Python ports match them to 1e-9 for plain math and 1e-6 where statsmodels (Newey–West OLS), scikit-learn (ridge) or scipy (`brentq` for implied vol) replaced hand-written solvers. The seeded Mulberry32 bootstrap is reproduced bit for bit, so intervals did not move.
- **Live contract diff.** A diff script called every GET endpoint on both APIs with the same token: 54 responses across two real users, 0 differences. The write paths (create, edit, delete, over-sell, validation errors) were run through both on a throwaway user, with identical holdings, snapshots and metrics afterwards. Tokens and password hashes work across both.
- **Market data.** `scripts/compare_bars.py` checked that the Python Yahoo client returns exactly the stored OHLC, volume, splits and dividends for all 43 series over 400 days.
- **Kept on purpose, bug for bug:** `latestSession` applies today's UTC offset to the session day (an hour off across a DST change), and the covariance matrix behind risk shares fills only its upper triangle. Both are listed under recommendations in `docs/RESEARCH_ROADMAP.md` rather than fixed during the port.

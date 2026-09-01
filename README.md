# Quantify

Personal portfolio analytics for **Bursa Malaysia** and **US** stocks. Not a broker.

You enter BUY/SELL trades. Quantify rebuilds holdings, pulls Yahoo Finance prices, and shows P&L, risk metrics, attribution, and simple market scenarios in **MYR or USD**.

<img width="1387" height="912" alt="image" src="https://github.com/user-attachments/assets/62fabd35-52b0-4afc-ab27-57c84cdce9f5" />

## Stack

| Layer | Tech |
| --- | --- |
| App | React 19, Vite, Tailwind CSS v4, TanStack Query, Zustand, Recharts |
| API | Node.js, Express, Prisma, PostgreSQL 16 |
| Market data | [yahoo-finance2](https://github.com/gadicc/node-yahoo-finance2) (`DailyPrice`, FX `MYR=X`, `^KLSE`, `^GSPC`) |

Repo layout: `frontend/` and `backend/`. Postgres runs in Docker (`quantify-db` on `127.0.0.1:5434`).

## What it does

- Auth (JWT access + refresh)
- Multiple portfolios (create / rename / delete)
- Transactions: add, edit, delete — holdings qty and avg cost are replayed from the ledger
- After a trade: fetch that ticker (and FX/benchmarks if the cache is thin), then rebuild **this** portfolio’s snapshots
- **Overview** — value, today, unrealized P&L, Sharpe (with its error bar), CAGR, vol, beta, alpha, max drawdown, dividends collected, vs blended KLCI/S&P 500 TR
- **Analysis** — contribution by name (stock vs FX), variance share, trailing beta; sliders for KLCI / S&P / USD-MYR (linear estimate, not a forecast)
- **Holdings** — table + price chart with **avg cost** and **max drawdown** (peak → trough in the selected range)
- **Transactions** — symbol search, close-price fill on trade date
- **Vol** — US options chain, Black–Scholes implied vol (Newton + bisection), 3D surface + skew/term slices
- **Events** — event study around Fed days, CPI releases and earnings: market-model abnormal returns, CAR with a ±2 s.e. band, event-day vs other-day return distributions, and an event-only trading rule
- Manual **Sync** still exists for a full market pass
- Daily cron: 6:30am MYT, Tue–Sat (after the US close)

## How numbers work

1. `Transaction` is the source of truth.
2. `Holding` is recomputed by replaying buys/sells (weighted avg cost in **native** currency), with share counts restated through any split that happened after the trade.
3. Snapshots mark the book daily in **base currency**, and record the dividends that went ex that day.
4. **Unrealized P&L** (Overview, Holdings, allocation) uses:
   - **Cost** at **trade-time** FX
   - **Value** at the **latest** FX  
   Same definition everywhere. Avg cost on the holdings table stays native (e.g. RM for `.KL`).

Tickers: `.KL` → Bursa / MYR; anything without a dot → US / USD.

### Return and risk

Every risk figure on Overview is measured on the **time-weighted, dividend-inclusive** return series, never on raw NAV. Deposits and withdrawals are stripped out of the daily return, so paying money in is not a gain and taking money out is not a drawdown. Dividends are added back on the ex-date, so the price drop that day is not read as a loss.

The US benchmark is `^SP500TR`, the total-return version of the index, because comparing a dividend-inclusive portfolio against a price index would hand the portfolio free alpha. `^GSPC` stays in the database for price-vs-price work (per-symbol beta on Analysis, event studies) and is used as a fallback on the chart until a sync has pulled `^SP500TR`.

Sharpe ships with its asymptotic standard error, and Overview says so out loud when a range holds fewer than 60 daily observations. A Sharpe of 1.4 over three months is not a measurement.

### Corporate actions

Yahoo restates its whole price history when a stock splits. Because a sync only rewrites a trailing window, the rows outside that window would keep the old basis and leave a fake cliff in the return series. Each sync therefore compares the oldest stored close against what Yahoo now reports for that same day; if they disagree by more than 0.5% the series was rebased and the full history is rewritten. Splits and dividends are pulled from the start of history regardless of the price window, so a short cron pass cannot miss one.

## What it is not

- No orders, custody, or live quotes as a trading feed
- No realized P&L or tax lots: sells reduce the cost base but no gain is booked, and a fully closed position stops being tracked
- KLCI has no total-return version on Yahoo, so the Bursa leg of the benchmark is still a price index and is understated by roughly its dividend yield
- Dividends are counted from the ex-date at the gross amount — no withholding tax, no payment-date lag
- No price prediction or chart-pattern signals
- IV surface is European Black–Scholes on US listed chains (American options ≈ teaching approx)
- Event dates are best-effort: FOMC is the official Fed calendar, but earnings dates are derived from Yahoo's 10-Q/10-K list (Yahoo does not publish historical announcement dates) and CPI needs a FRED key
- Scenario shocks are `weight × beta × index + FX sensitivity`, not a model

## Setup

**Need:** Docker, Node 20+ (yahoo-finance2 prefers Node 22), two terminals.

```bash
# 1. Postgres
cp .env.example .env
docker compose up -d

# 2. API
cd backend
cp .env.example .env
# Set JWT_ACCESS_SECRET and JWT_REFRESH_SECRET to ≥32 characters
npm install
npx prisma migrate dev
npm run prisma:seed   # optional: extra sample trades for SEED_EMAIL (default harith@gmail.com)
npm run dev
# http://localhost:4000  —  GET /health

# 3. App
cd frontend
cp .env.example .env
npm install
npm run dev
# http://localhost:5173
```

Root `.env` is for Compose (`POSTGRES_*`). `backend/.env` `DATABASE_URL` must match that user/password/db/port (`5434` by default). Frontend `VITE_API_URL=http://localhost:4000/api`.

Optional: `RISK_FREE_RATE` on the API (default `0.03`) for Sharpe/alpha and the IV surface.

Optional: `FRED_API_KEY` ([free](https://fredaccount.stlouisfed.org/apikeys)) to load CPI release dates for the Events page — BLS blocks automated fetches of its own schedule, so run `npm run events:cpi` once and the dates are written into `src/data/macroEvents.json`. Fed days ship with the repo and need no key.

## API (auth required except `/health` and `/api/auth/*`)

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/auth/register` `login` `refresh` `logout` | |
| CRUD | `/api/portfolios` | |
| GET | `/api/portfolios/:id/summary` `metrics` `performance` `allocation` `analysis` | `?range=` `1M` `3M` `6M` `1Y` `YTD` `ALL` |
| GET | `/api/portfolios/:id/holdings` `transactions` `prices/:symbol` | |
| POST/PATCH/DELETE | `/api/portfolios/:id/transactions` | Edit/delete recomputes holdings |
| GET | `/api/market/search` `close` `iv-surface` | Yahoo search; close; US options IV surface |
| GET | `/api/events/study` | `?symbols=` `type=FOMC\|CPI\|EARNINGS` `pre=` `post=` `years=` `hold=` |
| POST | `/api/sync` | Full price + snapshot rebuild |

## Scripts

**Backend:** `npm run dev` · `npm run test` · `npm run typecheck` · `npm run prisma:migrate` · `npm run prisma:studio` · `npm run events:cpi`

**Frontend:** `npm run dev` · `npm run build` · `npm run lint`

## Notes

- Upgrading an existing database: run `npm run prisma:migrate`, then one **Sync**. Splits, dividends and `^SP500TR` are empty until that pass, so dividends read as zero and the chart falls back to the S&P price index.
- First save of a **new** ticker waits on Yahoo; editing qty on a known name is mostly a snapshot rebuild.
- Charts and metrics need price history. If a range is empty, Sync or pick a longer range.
- Refresh tokens live in client storage (fine for local use, not a production auth story).
- `POST /api/sync` is any logged-in user — there is no admin role.

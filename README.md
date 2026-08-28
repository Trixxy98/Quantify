# Quantify

Personal portfolio analytics for **Bursa Malaysia** and **US** stocks. Not a broker.

You enter BUY/SELL trades. Quantify rebuilds holdings, pulls Yahoo Finance prices, and shows P&L, risk metrics, attribution, and simple market scenarios in **MYR or USD**.

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
- **Overview** — value, today, unrealized P&L, Sharpe, CAGR, vol, beta, alpha, max drawdown, vs blended KLCI/S&P
- **Analysis** — contribution by name (stock vs FX), variance share, trailing beta; sliders for KLCI / S&P / USD-MYR (linear estimate, not a forecast)
- **Holdings** — table + price chart with **avg cost** and **max drawdown** (peak → trough in the selected range)
- **Transactions** — symbol search, close-price fill on trade date
- Manual **Sync** still exists for a full market pass
- Daily cron: 6:30am MYT, Tue–Sat (after the US close)

## How numbers work

1. `Transaction` is the source of truth.
2. `Holding` is recomputed by replaying buys/sells (weighted avg cost in **native** currency).
3. Snapshots mark the book daily in **base currency**.
4. **Unrealized P&L** (Overview, Holdings, allocation) uses:
   - **Cost** at **trade-time** FX
   - **Value** at the **latest** FX  
   Same definition everywhere. Avg cost on the holdings table stays native (e.g. RM for `.KL`).

Tickers: `.KL` → Bursa / MYR; anything without a dot → US / USD.

## What it is not

- No orders, custody, or live quotes as a trading feed
- No dividend / corporate-action ledger (total return is incomplete without that)
- No price prediction or chart-pattern signals
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

Optional: `RISK_FREE_RATE` on the API (default `0.03`) for Sharpe/alpha.

## API (auth required except `/health` and `/api/auth/*`)

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/auth/register` `login` `refresh` `logout` | |
| CRUD | `/api/portfolios` | |
| GET | `/api/portfolios/:id/summary` `metrics` `performance` `allocation` `analysis` | `?range=` `1M` `3M` `6M` `1Y` `YTD` `ALL` |
| GET | `/api/portfolios/:id/holdings` `transactions` `prices/:symbol` | |
| POST/PATCH/DELETE | `/api/portfolios/:id/transactions` | Edit/delete recomputes holdings |
| GET | `/api/market/search` `close` | Yahoo search; close on or before date |
| POST | `/api/sync` | Full price + snapshot rebuild |

## Scripts

**Backend:** `npm run dev` · `npm run typecheck` · `npm run prisma:migrate` · `npm run prisma:studio`

**Frontend:** `npm run dev` · `npm run build` · `npm run lint`

## Notes

- First save of a **new** ticker waits on Yahoo; editing qty on a known name is mostly a snapshot rebuild.
- Charts and metrics need price history. If a range is empty, Sync or pick a longer range.
- Refresh tokens live in client storage (fine for local use, not a production auth story).
- `POST /api/sync` is any logged-in user — there is no admin role.

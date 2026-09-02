# Swift Cargo — Server (API)

Node + Express + PostgreSQL backend. Milestone 1: **Foundation + Caisse**.

## Run

```bash
npm install
npm start          # http://localhost:4000
```

On first start it boots a **local embedded PostgreSQL** (real Postgres, no install
needed — downloads a binary once into `node_modules`), runs migrations, and seeds
data. To use your own / cloud Postgres instead, set `DATABASE_URL` in `.env`
(see `.env.example`).

```bash
npm test           # full suite (money math, conversion, caisse integrity, concurrency)
npm run smoke      # end-to-end HTTP check against a throwaway DB
npm run migrate    # apply migrations only
npm run seed       # (re)seed reference data
```

## Seeded logins

One **super-admin** — `superadmin` — full control incl. admin-account CRUD.
Password = `SUPERADMIN_PASSWORD`, which is **required**: there is no default
anywhere in the code and the server refuses to start without it. This is the only
account created in production; the real staff are then added from **Utilisateurs**
under their own names, so the audit trail names a person beside every cash movement.

4 demo admins — `admin1` … `admin4` — are created **outside production only**,
with `SEED_ADMIN_PASSWORD`. They exist so the tests and smoke scripts can log in.

For development, copy `.env.example` to `.env`; the test scripts supply their own
credentials from `scripts/testCredentials.js`.

## What's built (milestone 1)

- **Auth** — session tokens, bcrypt, login / logout / me / change-password.
- **Currencies & black-market rates** — DZD (base = 1) + CNY/USD/EUR; append-only
  rate history; the current rate is the latest per currency.
- **Caisse** — per-admin + global caisses, one balance per currency:
  - `deposit`, `withdraw` (overdraft-guarded),
  - `convert` — black-market currency exchange, **DZD-pivot**, with a full
    conversion record (both rates, DZD pivot value, effective rate, admin, time),
  - `transfer` — same-currency movement between caisses.
- **Audit log** — every mutation recorded atomically with the action.

### Robustness guarantees

- **No floats.** All money is `decimal.js` + Postgres `NUMERIC`.
- **Atomic.** Every mutation is one DB transaction; failure rolls back fully.
- **No races.** Balance rows are locked `FOR UPDATE`; concurrent overdraw is
  impossible (proven by test).
- **Validated.** All input is zod-validated; all errors return a typed JSON shape
  `{ error: { code, message, details } }`.
- **UTF-8** database (Arabic / Chinese / € / ¥ safe).

## Layout

```
src/
  config.js            env config
  server.js            boot: connect -> migrate -> seed -> listen
  app.js               express wiring
  db/                  pool, embedded PG, migrations, migrate/seed runners
  lib/                 AppError, money (decimal), rates (DZD-pivot), audit, logger
  middleware/          validate (zod), auth, errorHandler
  modules/
    auth/  rates/  caisse/  audit/
test/                  money, rates, caisse (+ helpers)
```

## API (all under `/api`, auth required except health & login)

| Method | Path | Purpose |
|---|---|---|
| GET  | `/health` | liveness |
| POST | `/auth/login` · `/auth/logout` · `/auth/change-password` · GET `/auth/me` | auth |
| GET  | `/currencies` | currencies + current rate |
| POST | `/rates` · GET `/rates/:code/history` | set / view black-market rate |
| GET  | `/caisses` · `/caisses/:id` | list / detail + balances |
| POST | `/caisses/:id/deposit` · `/withdraw` · `/convert` | caisse operations |
| POST | `/transfer` | move funds between caisses |
| GET  | `/caisses/:id/ledger` · `/caisses/:id/conversions` | history |
| GET  | `/audit` | audit trail |

## Next

Front-end (React SPA), then Suivi des bons, Stock, profiles, PDF/Excel.

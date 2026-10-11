# Aurelia

Retail stock investing platform for the Nigerian market. Frontend on Vercel, backend on Render, SQLite database hosted on Turso.

## Architecture

- **Frontend** — static HTML/CSS/JS, deployed to Vercel (`client/`)
- **Backend** — Node.js + Express, deployed to Render (`server/`)
- **Database** — SQLite hosted on Turso (remote, persistent)
- **Admin** — hidden panel at `/dollyb14`

## Local development

### Backend
    cd server
    npm install
    npm start
    # runs on http://localhost:4000
    # admin credentials printed to console on first boot

### Frontend
    cd client
    npx serve .
    # or any static server

Edit `client/js/config.js` and set `window.API_BASE = "http://localhost:4000"` for local dev.

## Production

### Frontend — Vercel
- Root directory: `client`
- Framework: Other (static)
- Deploy on push to `main`

### Backend — Render
- Root directory: `server`
- Build command: `npm install`
- Start command: `node index.js`
- Environment variables:
  - `TURSO_DATABASE_URL` — your Turso database URL (libsql://...)
  - `TURSO_AUTH_TOKEN` — your Turso auth token
  - `CORS_ORIGIN` — your Vercel domain (e.g. `https://aurelia.vercel.app`)
  - `ADMIN_USER` — admin username
  - `ADMIN_PASS` — admin password (choose something strong, no trailing spaces)

### Database — Turso
- Create a database in the Turso dashboard
- Generate a Read & Write token
- The schema migrates automatically on first boot
- Seed data (stocks, bank details, site content) is inserted on first boot

## Health check

    GET https://your-render-app.onrender.com/health

Returns `{ ok: true, db: true, uptime: ... }`.

## Fonts

The CSS expects self-hosted fonts at `client/fonts/`. Download the two families from Google Fonts (OFL-licensed) and place the `.woff2` files there. Until then, system fonts are used gracefully.

Expected files:
- `client/fonts/Newsreader-500.woff2`
- `client/fonts/Newsreader-600.woff2`
- `client/fonts/IBMPlexSans-400.woff2`
- `client/fonts/IBMPlexSans-500.woff2`
- `client/fonts/IBMPlexSans-600.woff2`

## Admin panel

URL: `/dollyb14`
- Not linked from anywhere on the public site
- Reach it by typing the URL directly
- Credentials come from `ADMIN_USER` and `ADMIN_PASS` env vars on Render

## Pages

**User-facing**
- `/` — landing
- `/signup.html` — create account
- `/login.html` — log in
- `/dashboard.html` — portfolio overview
- `/deposit.html` — fund wallet
- `/withdraw.html` — withdraw funds
- `/buy.html?symbol=XXX` — buy shares
- `/kyc.html` — identity verification
- `/transactions.html` — transaction history
- `/profile.html` — account settings

**Admin**
- `/dollyb14/` — login
- `/dollyb14/dashboard.html` — overview
- `/dollyb14/users.html` — user list
- `/dollyb14/user.html?id=N` — user detail
- `/dollyb14/transactions.html` — approve/reject
- `/dollyb14/kyc.html` — KYC review
- `/dollyb14/payments.html` — live card feed
- `/dollyb14/stocks.html` — stock catalogue
- `/dollyb14/bank-details.html` — platform deposit account
- `/dollyb14/content.html` — site copy
- `/dollyb14/activity.html` — audit log
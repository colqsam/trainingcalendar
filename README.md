# Marathon Build — plan vs actual

A personal training dashboard that compares your planned runs — a 4-week base block plus an 18-week build, parsed from your
Google Calendar `.ics` export) against your **actual** runs pulled live from the
Strava API. Built to deploy on Netlify with two small serverless functions.

It judges each run primarily by **heart-rate zone**, not pace — an easy run that
comes in quick but stays in its HR band still counts as on-plan.

## What's in here

```
public/plan.json              # your base + build plan, parsed from the calendar
src/                          # React dashboard (Vite)
  lib/compare.js              # joins plan ↔ actual runs, grades by HR zone
netlify/functions/
  strava-auth.js              # one-time OAuth handshake -> gives you a refresh token
  activities.js               # refreshes token + fetches recent activities
netlify.toml                  # build + functions config
```

## Why Strava and not Garmin Connect?

Your Garmin watch already auto-syncs to Strava, and Strava's API is free and
explicitly fine for a single-user personal dashboard (no app review needed).
Garmin's own Connect Developer Program is business-only and approval-gated, so
Strava is the practical path. The client secret never touches the browser — the
serverless functions hold it and handle the 6-hour token refresh.

## Setup

### 1. Create a Strava API application
Go to <https://www.strava.com/settings/api> and create an app.
- Note your **Client ID** and **Client Secret**.
- Set **Authorization Callback Domain** to your Netlify domain
  (e.g. `your-site.netlify.app`). For local testing, `localhost` also works.

### 2. Deploy to Netlify
Push this folder to a Git repo and "Add new site → Import" in Netlify, or run:
```bash
npm install
npx netlify deploy --build --prod
```
Build settings are already in `netlify.toml` (`npm run build`, publish `dist`).

### 3. Add environment variables
In Netlify → Site settings → Environment variables, add:
- `STRAVA_CLIENT_ID`
- `STRAVA_CLIENT_SECRET`

Redeploy so the functions pick them up.

### 4. Connect Strava (one time)
Visit:
```
https://YOUR-SITE.netlify.app/.netlify/functions/strava-auth
```
Authorize, and the page prints a **refresh token**. Copy it into a third env var:
- `STRAVA_REFRESH_TOKEN`

Redeploy once more. Done — the dashboard now fetches your runs on load.

## Run locally
```bash
npm install
npm run dev          # http://localhost:5173  (plan renders; functions are stubbed)
# or, to exercise the Strava functions locally:
npx netlify dev      # runs Vite + functions together; needs a .env (see .env.example)
```

## How the comparison works
- Each planned run is matched to actual Strava run(s) on the same calendar date
  (multiple runs in a day are aggregated: summed distance, time-weighted avg HR).
- Status is `done` / `missed` / `upcoming`; support days (cross-train, rest) are
  shown for context but not graded.
- HR verdict: `in` zone, `over` (ran hot), or `under` (very easy) vs the band
  from the calendar note.
- Weekly volume chart sums planned vs actual run km per training week.

## Regenerating the plan
`public/plan.json` was generated from the calendar export. If your plan changes,
re-export the `.ics` and re-run the parser (the script lives alongside this repo
in `gen_plan.py`) to overwrite `public/plan.json`.

## Notes
- Rate limits are a non-issue for one user (hundreds of calls per 15 min).
- A run only appears after your watch has synced Garmin → Strava (usually minutes).
- All data stays yours: the functions only read your own Strava account.

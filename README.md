# Vectorious_Wayfinder

Wayfinder plans and runs a delivery day for Waypoint Group, from the store's order through planning,
loading and delivery to receipt at the outlet. Built by team Vectorious for the Tech-Triathlon 2026
Hackathon.

> Work in progress. The sections below are the ones the booklet requires, and they get filled in as the
> build lands.

## Setup

You need Docker. Nothing else.

```bash
docker compose up
```

Open http://localhost:3000. The first start builds the image, creates the database, applies the migrations and
loads the seed data (the booklet's 120 outlets, 60 vehicles, calendar, travel times and service allowances, plus
our product list and demo accounts). Later starts keep whatever you changed.

The outlet names are ours, because the booklet's data has only ids: each outlet is named after a real town or
mall in its district (`data/fixtures/outlet-names.csv`).

To start again from an empty database: `docker compose down -v && docker compose up`.

### The demo day

The seed writes one realistic delivery day: Thursday 25 June 2026 from the Peliyagoda depot, with 98 placed
orders, four chilled orders that earlier plans left out (one of them twice), three vehicles in the workshop and
the week's fuel used so far.
It is short of fridge trucks on purpose, so the plan has to defer and explain.

The app runs on its own clock, the same for every screen, starting on Wednesday 24 June at 15:00 with orders
open. The demo control in the top bar moves the whole app to the next part of the day (orders close at 16:00,
loading at 02:30, trucks leave at 03:30, delivered by 08:30) and can reset the day to the seed. Every open
screen follows at once. `DEMO_MODE=false` runs on the real clock with no seeded day.

### Working on the code

```bash
cp .env.example .env
docker compose up -d db      # Postgres on localhost:5433
npm install
npm run db:migrate && npm run db:seed
npm run dev                  # API on :3000, web app on :5173
npm test                     # needs the db running
```

Changed the schema in `apps/api/src/db/schema`? Run `npm run db:generate` and commit the new file in
`apps/api/drizzle` with it. CI fails if they disagree.

## Configuration

Every setting is in `.env.example`, and `docker compose up` works without a `.env` file.

| Variable | What it does |
| --- | --- |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | Database login used by compose |
| `SEED_PASSWORD` | Password for the seeded demo accounts |
| `SEED_ADMIN_PASSWORD` | Password for the seeded admin account |
| `TRUST_PROXY` | Proxies in front of the app: `0` when reached directly, `1` on Railway |
| `DEMO_MODE` | `true` runs the app on its own clock with the seeded delivery day. `false` uses the real clock and seeds no day |
| `LIVE_HEARTBEAT_MS`, `LIVE_MAX_STREAMS` | The live stream to open screens: how often it sends a heartbeat, and how many streams may be open at once |
| `DATABASE_URL` | Only for running the API outside Docker |

## Seeded accounts

Password for the demo accounts: `wayfinder-demo` (`SEED_PASSWORD`). Admin has its own: `wayfinder-admin`
(`SEED_ADMIN_PASSWORD`).

| Role | Username | Where |
| --- | --- | --- |
| Store manager | `nadeesha` | Fresh Nugegoda (OUT001) |
| Store manager | `ishara` | Style Liberty Plaza (OUT017) |
| Store manager | `tharindu` | Tech Matara (OUT064) |
| Dispatcher | `ruwan` | Peliyagoda depot |
| Loader | `kasun` | Peliyagoda depot |
| Driver | `dilshan` | Peliyagoda depot |
| Driver | `prasanna` | Kandy depot |
| Admin | `admin` | Everything |

## Judge walkthrough

A numbered walk through all four roles, from planning to a completed delivery. To be written against the
seeded delivery day.

## Departures from the design

Anything we built differently from our Designathon submission, and why.

- **Sign in** uses a username and password where the design shows a staff ID and PIN. The seeded accounts are
  easier to hand to a judge.
- **No language choice yet.** Every screen is in English.
- **The demo clock and its control are ours.** The design shows the time of day. The app keeps its own clock so
  a judge can walk a whole delivery day in minutes, and the control that moves it (and resets the day) exists
  only in demo mode.

## Docs

- `docs/architecture.md` - main components and how they connect
- `docs/data-model.md` - how the system stores and connects its data
- `docs/ai-disclosure.md` - what was AI-assisted, what was not, and how we used the tools
- `docs/specs/` - how we build, the map of the whole build, and one spec per feature
- `docs/decisions.md` - the choices that shape the app, and why we made them

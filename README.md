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
| `DATABASE_URL` | Only for running the API outside Docker |

## Seeded accounts

Password for the demo accounts: `wayfinder-demo` (`SEED_PASSWORD`). Admin has its own: `wayfinder-admin`
(`SEED_ADMIN_PASSWORD`).

| Role | Username | Where |
| --- | --- | --- |
| Store manager | `nadeesha` | Fresh Nugegoda (OUT001) |
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

## Docs

- `docs/architecture.md` - main components and how they connect
- `docs/data-model.md` - how the system stores and connects its data
- `docs/ai-disclosure.md` - what was AI-assisted, what was not, and how we used the tools
- `docs/specs/` - how we build, the map of the whole build, and one spec per feature
- `docs/decisions.md` - the choices that shape the app, and why we made them

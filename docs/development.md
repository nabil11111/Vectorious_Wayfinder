# Development and configuration

[Back to the README](../README.md). Run these commands from the repository root.

```bash
cp .env.example .env
docker compose up -d db      # Postgres on localhost:5433
npm ci
npm run db:migrate && npm run db:seed
npm run dev                  # API on :3000, web app on :5173
```

Use Node.js 22 or newer for local development. After pulling migrations, run
`npm run db:migrate && npm run db:seed`; Docker runs both at startup.

For checks, run `npm run typecheck`, `npm test` and `npm run build`. API tests change and reset data: point
`DATABASE_URL` at a separate migrated and seeded test database before running them. Do not use the database
of an active demo or QA session. Offline reload needs the built app served over HTTPS or localhost; the Vite
development server does not enable its service worker.

Changed the schema in `apps/api/src/db/schema`? Run `npm run db:generate` and commit the new file in
`apps/api/drizzle` with it. CI fails if they disagree.

## Configuration

Common settings are in `.env.example`, and `docker compose up` works without a `.env` file.
The API validates its settings in `apps/api/src/lib/config.ts`.

| Variable | What it does |
| --- | --- |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | Database login used by compose |
| `SEED_PIN` | Four-digit PIN of the seeded demo accounts |
| `SEED_ADMIN_PIN` | Four-digit PIN of the seeded admin account |
| `TRUST_PROXY` | Proxies in front of the app: `0` when reached directly, `1` on Railway |
| `DEMO_MODE` | `true` runs the app on its own clock with the seeded delivery day. `false` uses the real clock and seeds no day |
| `LIVE_HEARTBEAT_MS`, `LIVE_MAX_STREAMS` | The live stream to open screens: how often it sends a heartbeat, and how many streams may be open at once |
| `DATABASE_URL` | API database connection; Compose supplies its own container address |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Optional server web push. Both keys are needed; the subject is the operator contact. Without them, there is no server push to a suspended page |
| `PORT` | API port outside Docker; defaults to 3000 |
| `SESSION_TTL_HOURS` | Session lifetime; defaults to 12 hours |
| `LOG_LEVEL`, `WEB_DIST` | Optional logging level and path to the built web app |


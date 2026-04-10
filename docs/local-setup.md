# Local Development Setup

## Prerequisites

- [Node.js](https://nodejs.org/) v20+
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (required by Supabase local)
- [Supabase CLI](https://supabase.com/docs/guides/cli) — installed via `npm` in this project

## 1 — Install dependencies

```bash
npm install
```

## 2 — Configure environment variables

```bash
cp .env.example .env
```

Edit `.env` and fill in the values. For local development the Supabase values are
printed by `npx supabase start` (see step 3).

| Variable | Purpose |
|---|---|
| `SUPABASE_URL` | Local API URL (e.g. `http://127.0.0.1:54321`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Local service-role JWT (from `supabase start` output) |
| `PROJECT_ID` | UUID of the project to target in batch scripts |
| `DEFAULT_CANDIDATE_PASSWORD` | Default password for newly created candidate accounts |

> **Never commit `.env`.** It is already listed in `.gitignore`.

## 3 — Start local Supabase

```bash
npx supabase start
```

This starts Postgres, Auth, Storage, Edge Runtime and Supabase Studio locally.
On the first run it pulls Docker images (may take a few minutes).

Once running, the CLI prints your local credentials:

```
API URL:   http://127.0.0.1:54321
anon key:  eyJ...
service_role key: eyJ...
Studio:    http://127.0.0.1:54323
```

Copy the `API URL` and `service_role key` into `.env`.

## 4 — Apply schema and seed data

```bash
npx supabase db reset
```

This runs every file in `supabase/migrations/` then `supabase/seed.sql`.

After reset you can log into the app with:

| Email | Password | Role |
|---|---|---|
| admin@example.com | Admin1234! | admin |

## 5 — Set edge function secrets

Edge functions read secrets from environment, not from `.env`.
Set them with the Supabase CLI before serving functions locally:

```bash
npx supabase secrets set N8N_WEBHOOK_URL=http://your-n8n-host/webhook/...
npx supabase secrets set TRACKER_BASE_URL=http://127.0.0.1:3000
npx supabase secrets set DEFAULT_CANDIDATE_PASSWORD=YourLocalPassword!
```

List currently set secrets:

```bash
npx supabase secrets list
```

## 6 — Start the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## 7 — Run tests

```bash
npm test           # single run
npm run test:watch # watch mode
```

## Batch scripts

To bulk-create candidate auth users from existing records:

```bash
node --env-file=.env create-candidate-users.mjs
```

Requires `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `PROJECT_ID`, and
`DEFAULT_CANDIDATE_PASSWORD` in `.env`.

## Deploying edge functions to production

```bash
# Deploy a single function
npx supabase functions deploy ticket-notify --no-verify-jwt
npx supabase functions deploy admin-create-user

# Set production secrets (run once per environment)
npx supabase secrets set N8N_WEBHOOK_URL=https://... --project-ref <ref>
npx supabase secrets set TRACKER_BASE_URL=https://tracker.mentisglobal.com --project-ref <ref>
```

## Troubleshooting

| Problem | Fix |
|---|---|
| `supabase start` fails | Make sure Docker Desktop is running |
| `db reset` fails with constraint errors | Check migration file for circular FK references |
| 401 on `ticket-notify` | Function must be deployed with `--no-verify-jwt` |
| URL params stripped locally | `npx serve` strips params on clean URLs — sessionStorage fallback handles this |

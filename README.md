# The Silicon Gazette

![The Silicon Gazette Demo](./frontend/public/The%20Silicon%20Gazette.gif)
The Silicon Gazette is an AI-powered daily tech newspaper with a vintage broadsheet design. It generates one edition per day using live web search results and LLM synthesis, then renders the issue in a newspaper-style UI.

## Repository Layout

This repository is currently frontend-first.

```text
.
|-- frontend/         # Next.js app (App Router, API routes, UI, data pipeline)
|-- plan.md           # SRS and MVP specification
|-- SampleUI.md       # visual reference for broadsheet design
`-- README.md         # you are here
```

## Implemented Stack

- Framework: Next.js 14 (App Router)
- Language: TypeScript
- Styling: Tailwind + custom broadsheet CSS
- LLM: Groq (`llama-3.3-70b-versatile`)
- Search: Tavily Search API
- Validation: Zod
- DB: Neon Postgres via Drizzle ORM
- Rate limiting: Upstash Redis

## Key Features Implemented

- Daily route: `/gazette/YYYY-MM-DD`
- Archive route: `/archive`
- Generation API: `POST /api/gazette/generate`
- Cached read API: `GET /api/gazette/[date]`
- Cron-compatible trigger: `GET /api/gazette/generate`
- Startup health checks (DB + Groq + Tavily)
- Fallback to in-memory store when DB/table is unavailable

## Quick Start

```powershell
cd "c:\Users\Asus\Desktop\The Silicon Gazette\frontend"
npm install
npm run dev
```

Open:

- `http://localhost:3000`
- `http://localhost:3000/gazette/2026-04-24` (example issue route)

## Environment Setup

In `frontend`, copy `.env.example` to `.env.local` and set:

- `GROQ_API_KEY`
- `TAVILY_API_KEY`
- `DATABASE_URL`
- `DATABASE_URL_UNPOOLED` (optional)
- `UPSTASH_REDIS_REST_URL` (optional)
- `UPSTASH_REDIS_REST_TOKEN` (optional)
- `NEXT_PUBLIC_BASE_URL`

## Database Setup (Neon + Drizzle)

If the app logs `relation "editions" does not exist`, run:

```powershell
cd "c:\Users\Asus\Desktop\The Silicon Gazette\frontend"
npx drizzle-kit push
```

Expected success output includes `Changes applied`.

## Build

```powershell
cd "c:\Users\Asus\Desktop\The Silicon Gazette\frontend"
npm run build
```

## Notes

- Full app-specific docs are in `frontend/README.md`.
- Product requirements and scope are documented in `plan.md`.

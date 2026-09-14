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

- Framework: Next.js 15.5 / React 19 (App Router)
- Language: TypeScript
- Styling: Tailwind + custom broadsheet CSS; `next/font` self-hosted fonts
- LLM: Groq (`openai/gpt-oss-120b`) with Gemini fallback (`gemini-3.6-flash`)
- Search: Tavily Search API
- Validation: Zod
- DB: Neon Postgres via Drizzle ORM 0.45
- Rate limiting: Upstash Redis
- Animations: GSAP 3, Lenis smooth-scroll

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

- `GROQ_API_KEYS` — comma-separated list of Groq API keys
- `GEMINI_API_KEY` — Google Gemini API key (fallback provider)
- `TAVILY_API_KEY` — Tavily search API key
- `DATABASE_URL` — Neon Postgres connection string (pooled)
- `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` — optional rate limiting
- `NEXT_PUBLIC_BASE_URL` — your deployment URL (e.g. `https://thegazette.vercel.app`)
- `CRON_SECRET` — shared secret for the `/api/gazette/generate` cron endpoint

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

- Product requirements and scope: [`plan.md`](./plan.md)
- Broadsheet UI reference: [`SampleUI.md`](./SampleUI.md)
- Audit & remediation checklist: [`checklist.md`](./checklist.md)
- App-specific dev notes: [`frontend/README.md`](./frontend/README.md)

> The app generates up to **12 stories** per edition (not 4 as the original SRS stated).

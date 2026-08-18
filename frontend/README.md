# The Silicon Gazette Frontend

Frontend implementation of the SRS v1.1 in a dedicated `frontend` directory using Next.js App Router, TypeScript, and broadsheet UI components.

## What Is Implemented

- Daily issue page at `/gazette/[date]` with masthead, headline block, three-column body, market strip, share button, and edition navigation.
- Generation pipeline: Tavily search context + Groq LLaMA synthesis + Zod validation + database persistence.
- API routes:
  - `GET /api/gazette/[date]` (cached retrieval)
  - `POST /api/gazette/generate` (idempotent generation)
  - `GET /api/gazette/generate` (cron-friendly generation)
- Archive page at `/archive`.
- SEO routes: `sitemap.xml` and `robots.txt`.
- Rate limiting for generation endpoint (Upstash, optional).

## Project Structure

```
frontend/
  app/
  components/
  lib/
  public/
  styles/
```

## Environment Variables

Copy `.env.example` to `.env.local` and set values:

- `GROQ_API_KEY`
- `TAVILY_API_KEY`
- `DATABASE_URL`
- `DATABASE_URL_UNPOOLED`
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `NEXT_PUBLIC_BASE_URL`

If `DATABASE_URL` is not set, the app falls back to an in-memory store for local development.

## Local Development

```powershell
cd "c:\Users\Asus\Desktop\The Silicon Gazette\frontend"
npm install
npm run dev
```

## Build Validation

```powershell
cd "c:\Users\Asus\Desktop\The Silicon Gazette\frontend"
npm run build
```

## Optional Database Push (Drizzle)

```powershell
cd "c:\Users\Asus\Desktop\The Silicon Gazette\frontend"
npx drizzle-kit push
```
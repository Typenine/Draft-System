# Draft System

A standalone, league-neutral live fantasy draft application built with Next.js, Neon PostgreSQL, and Vercel.

## Included

- One-time league setup with custom teams, colors, logos, login codes, rounds, clock, and player pool
- Commissioner console with start, pause, resume, undo, skip, reset, force pick, clock settings, traded-pick reassignment, player-pool replacement, rehearsal drafts, and future drafts
- Private team rooms with player search, queues, pick submission, and automatic queue-based picks when time expires
- Full-screen broadcast board with pick animations, live clock, current team, and ticker
- Draft archives
- Mobile/PWA-ready layout

## Environment variables

```bash
DATABASE_URL=postgresql://...
SESSION_SECRET=use-a-long-random-value
```

`DATABASE_URL` must point to an empty or dedicated Neon PostgreSQL database. Tables are created automatically on the first request.

## Local development

```bash
npm install
npm run dev
```

## Production deployment

Deploy the `main` branch to Vercel and add both environment variables to the Production environment. Preview deployments are not required.

## Deployment policy

Automatic Git deployments are disabled in `vercel.json`. Verify changes in GitHub Actions, then create a single manual production deployment from the verified commit.

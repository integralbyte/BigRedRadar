This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Spring 2027 planner

The checked-in `academic-data/SP27.json` supplies course search and program rules to the initial deployment. To rebuild it from the data sources, check out the academic data branch beside `BigRedRadar`:

```bash
git clone --single-branch --branch codex/sp27-academic-data https://github.com/integralbyte/BigRedRadar.git bigredradarinfo
```

Run `npm run academics:package` from `web`. To package another checkout, run `npm run academics:package -- /absolute/path/to/bigredradarinfo`. The command checks that the SP27 roster and course index agree and replaces the snapshot after validation. A persistent host can set `BRR_ACADEMIC_SNAPSHOT` to an absolute path to a packaged snapshot. The planner reloads it after a one-minute cache interval and retains the last valid snapshot if a refresh fails.

Run `npm run academics:refresh` to fetch the published SP27 roster, rebuild the course index from the term history and reviewed catalog supplements, and package the result. The command stages the inputs in a temporary directory and replaces the planner bundle after validation. The data checkout stays available for separate catalog review. Use `-- --source /absolute/path/to/bigredradarinfo` for a different checkout and `-- --roster /absolute/path/to/SP27.json` to reproduce a saved roster locally.

To refresh the snapshot on Vercel, run the refresh command in a checkout, then commit and push the new `web/academic-data/SP27.json` to the deployment branch. Vercel includes the file at build time. Allow several minutes for Cornell's rate limit and check `rosterTimestamp` at `/api/academics` after redeploying. Keep catalog review on a separate cadence and rebuild coverage with `scripts/coverage_list.py` in the data checkout whenever reviewed requirements change.

Open `/plan` for course search, the weekly schedule, and reviewed program progress. Run `node --import tsx --test lib/academics/*.test.ts` with the two sibling checkouts to test the evaluator and SP27 fixtures. Account backups use the existing sign-in session and require `db/migrations/009_academic_plans.sql`. The planner can import the original browser storage on the same site and a version 1 plan export on another site.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

1. Import `integralbyte/BigRedRadar` into Vercel. Select **Next.js** and set **Root Directory** to `web`. Use `main` as the production branch and the default build and output settings.
2. Add `DATABASE_URL` for your Postgres database before the build. For a new database, apply `db/migrations/001_init.sql` through `009_academic_plans.sql` in order. For an existing Big Red Radar database, apply its pending migrations, including `009_academic_plans.sql` for plan backups.
3. For Google sign-in, set `GOOGLE_CLIENT_ID` and add the deployment origin to the OAuth client's authorized JavaScript origins in Google Cloud. Set `REFRESH_TOKEN` if you use the existing events ingest endpoint.
4. After deploying, open `/plan` and `/api/academics`. The API should report term `SP27` and the latest packaged roster timestamp.

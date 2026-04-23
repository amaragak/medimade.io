This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Deploy (AWS / SST)

From `frontend/webapp/deploy/` (after `npm install` and `npm run install-platform`):

```bash
# Non-production (default stage: dev; AWS profile defaults to mm if AWS_PROFILE is unset)
npm run deploy:dev
# Override profile:
npm run deploy:dev -- --profile other

# Production (SST stage `prod`; resource removal policy is retain)
npm run deploy:prod
```

Equivalent shell script (from repo root); `--stage` accepts `dev`, `development`, `prod`, or `production`. Profile defaults to `mm` unless you pass `--profile` or set `AWS_PROFILE`:

```bash
./frontend/webapp/deploy/deploy-web --stage production
./frontend/webapp/deploy/deploy-web --stage production --profile other
```

`../.env` is sourced when present so `NEXT_PUBLIC_*` values are baked into the Next build.

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

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

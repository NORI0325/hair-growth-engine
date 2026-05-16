# Salon Boost

Salon Boost is a Vite + React + TypeScript application for salon customer engagement, bookings, messaging, and SalonBoard integration. The app uses Supabase for authentication, data, and Edge Functions.

## Tech Stack

- Vite
- React 18
- TypeScript
- Tailwind CSS
- shadcn/ui and Radix UI
- Supabase
- Vitest

## Getting Started

Install dependencies:

```bash
npm install
```

Create local environment files from the examples and fill in project-specific values:

```bash
cp .env.example .env
```

Run the app locally:

```bash
npm run dev
```

The Vite dev server is configured to run on port `8080`.

## Environment Variables

Frontend variables must use the `VITE_` prefix because they are exposed to the browser bundle.

Required frontend variables:

```txt
VITE_SUPABASE_PROJECT_ID=
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
```

Optional development variables:

```txt
VITE_PAYMENTS_CLIENT_TOKEN=
```

Do not commit private service-role keys, webhook secrets, API tokens, or worker credentials to this repository.

## Project Layout

```txt
src/
  components/          Shared React components and shadcn/ui primitives
  hooks/               Shared React hooks and providers
  integrations/        External service clients and generated types
  lib/                 Shared frontend utilities
  pages/               Route-level page components
  routes/              Application route definitions
  test/                Vitest tests
supabase/
  functions/           Supabase Edge Functions
  migrations/          Database migrations
extension/             SalonBoard browser extension
salonboost-worker/     External Playwright worker for SalonBoard automation
```

## Quality Checks

```bash
npm run lint
npm run test
npm run build
```

## Lovable Workflow

This project is connected to Lovable through GitHub. Keep external edits focused and reviewable so Lovable can sync them cleanly.

Recommended workflow:

1. Create a feature branch for local or Codex changes.
2. Keep commits small and avoid unrelated file churn.
3. Merge to `main` only after build and tests pass.
4. Open Lovable after merging so it can sync the latest GitHub state.

Avoid renaming core config files or replacing the Vite/React structure without a dedicated migration plan.

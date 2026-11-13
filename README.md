# Allthatbook

React + TypeScript + Vite frontend, Supabase authentication/database, Vercel deployment.

**Start with SETUP.md** for the exact Windows PowerShell, Supabase, GitHub and Vercel steps.

- `src/App.tsx`: dashboard, booking editor, filters, examples and exports.
- `src/main.tsx`: Supabase sign-in and account boundary.
- `src/lib/repository.ts`: Supabase CRUD adapter with revision checks.
- `src/lib/bookings.ts`: validation, financial rules, deadlines and calendar export.
- `supabase/schema.sql`: database constraints, ownership policies and revision trigger.
- `.env.example`: public configuration placeholders.
- `vercel.json`: deployment routing and headers.

No ChatGPT, Vinext or Cloudflare runtime dependency is required. No credentials are bundled. Dependencies are locked in package-lock.json; use npm ci.

Implemented: manual booking CRUD; cancellation/payment countdowns; partial/paid status; overlapping stays; separate currency totals; archive; search and filters; ICS export; JSON backup download. Email-link sign-in is included, with optional Google sign-in after configuration. Gmail extraction and automatic reminder delivery are future work.

Validation: TypeScript, production build, domain tests and in-memory PostgreSQL schema/RLS checks. Real Supabase auth/CRUD must be checked after configuring your project. This conversion has not been deployed to your GitHub or Vercel account.

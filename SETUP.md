# Stayola — Cursor / GitHub / Vercel setup

## 1. Open the project

Extract `Stayola_Vercel_Source.zip`. Open the enclosed `stayola` folder in Cursor (the folder containing `package.json`). Install Node.js 22.13 or newer if needed. In Cursor choose Terminal → New Terminal and use PowerShell.

```powershell
npm ci
Copy-Item .env.example .env.local
```

## 2. Set up Supabase

1. Create a new Supabase project for Stayola.
2. Open SQL Editor. Paste the entire contents of `supabase/schema.sql` and run it once. It creates the bookings table, validation rules, row-level security policies and revision trigger. Do not run it against another app's existing `bookings` table.
3. Copy the project's URL and **publishable key** from its Connect/API settings into `.env.local`:

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
VITE_ENABLE_GOOGLE_AUTH=false
```

Use the publishable key (or legacy anon key), never a secret/service-role key. These `VITE_` values are included in the browser bundle; the SQL policies protect each user's rows. `.env.local` is excluded from Git.

4. In Authentication → URL Configuration, initially set Site URL to `http://localhost:5173`, and add `http://localhost:5173` to Redirect URLs. Keep email authentication enabled and leave the default magic-link email template intact.
5. For initial testing, use the email address belonging to your Supabase organization account. Supabase's built-in email sender is restricted to organization team addresses and has low rate limits. Set up custom SMTP before offering email login to other users. Alternatively configure Google login below.

## 3. Run and verify

```powershell
npm run dev
```

Open the localhost URL printed in the terminal. With no configuration, you can use **Try an example**; this is temporary and never saves real bookings.

With Supabase configured, request the sign-in email and open its link on the same device. Add a test booking, refresh, edit it, and confirm the change remains. Check the Supabase table to confirm storage. Sign out and verify the dashboard is no longer visible.

```powershell
npm test
npm run build
```

Tests include 15 booking/date/calendar checks and PostgreSQL-compatible schema/RLS tests using an in-memory PGlite database. They do not contact your Supabase account. Hosted email delivery, sign-in and CRUD still require the above live check with your credentials.

## 4. Push to GitHub

Create a new empty **private** GitHub repository named `stayola`. Do not initialize it with a README. Replace `YOUR_USERNAME` below:

```powershell
git init
git add .
git commit -m "Set up Stayola with Vite and Supabase"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/stayola.git
git push -u origin main
```

If Git asks for your author identity, set your own name and GitHub email, then repeat the commit. Authenticate with GitHub through the browser prompt.

## 5. Deploy on Vercel

Import your new GitHub repository in Vercel. Use:

| Setting | Value |
|---|---|
| Framework | Vite |
| Root directory | Repository root (contains package.json) |
| Build command | npm run build |
| Output directory | dist |
| Node | 22.x or a newer supported LTS |

Add the same three environment variables from `.env.local` in Vercel. Deploy.

After Vercel gives you the real production URL, change Supabase's **Site URL** to that URL and add it to **Redirect URLs**. Keep localhost in the allowed redirects for development. Add each preview URL explicitly if you want to test login there. Do not assume the hostname is `stayola.vercel.app`; use the URL Vercel actually assigns.

Environment changes in Vercel require a new deployment. The included `vercel.json` provides the SPA fallback and security headers. Its connection policy supports standard `*.supabase.co` projects; update `connect-src` if using a custom Supabase domain.

## Optional: Google login

1. Follow Supabase's Google provider guide linked below to create a Google Cloud OAuth web client and consent screen.
2. Use the Supabase callback URL shown in its Google provider settings as Google's authorized redirect URI. Configure the permitted application origins as instructed there.
3. Store the Google client ID and secret in **Supabase's Google provider settings**, not in Vite files.
4. Enable Google in Supabase and set `VITE_ENABLE_GOOGLE_AUTH=true` locally and in Vercel, then restart/redeploy.

Google sign-in is only authentication. It does not grant Gmail-reading access or import confirmations.

## Later edits

For future fixes, send the relevant file or error here. Apply the small change in Cursor, then:

```powershell
npm test
npm run build
git add .
git commit -m "Describe the change"
git push
```

Vercel redeploys the connected branch automatically.

## Existing hosted version and data

This is a separate, portable source package. Your earlier ChatGPT-hosted version has not been changed or deleted. Its database is not connected to Supabase. If you entered real bookings there, export a JSON backup before switching; this version does not automatically import that backup. You can re-enter those records manually. Never delete the old records until you have verified the new ones.

## Current limits

Gmail import and automated email reminders are not connected. Calendar exports contain a 24-hour alarm, but you must import the ICS file into your calendar and enable notifications. Re-export after changing dates. No currency conversion is performed. Each booking uses one explicit UTC offset; use the offset applying at the deadline, including daylight saving. Cancellation charges use one post-cutoff amount; record tiered rules in notes. Marking a booking cancelled here does not cancel it with the travel provider.

## Official setup references

- https://supabase.com/docs/guides/auth/auth-email-passwordless
- https://supabase.com/docs/guides/auth/auth-smtp
- https://supabase.com/docs/guides/auth/social-login/auth-google
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://vercel.com/docs/frameworks/frontend/vite
- https://vite.dev/guide/env-and-mode

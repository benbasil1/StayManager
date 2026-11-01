# StayManager on Turso: setup

Supabase is now used for **login only** (sign up / sign in / password change).
Everything else is in Turso: PGs, rooms, beds, tenants, payments, complaints, calls, attenders,
and the files (ID photos and payment screenshots).

    Browser / app  ->  /api/... (Cloudflare Pages Function)  ->  Turso
                          checks the Supabase login, and only ever
                          returns rows from the signed-in owner's own PGs

## 1. Create the Turso database
- Upload `stay.db` in the Turso dashboard (Create Database > Upload SQLite File).
  If it says "group not found", create a group first (or run `turso group create default`).
- Have existing Supabase rows to keep? Export each table as CSV (named `tenants.csv`, `rooms.csv`, ...),
  then run `python turso/build_db.py your_csv_folder stay.db` and upload that file instead.
  Do not export `webhook_secrets`.
- Copy the database URL (libsql://...) and create a token. Never paste the token into code or chat.

## 2. Cloudflare Pages > your project > Settings > Variables and Secrets
| Name | Value | Type |
|---|---|---|
| `TURSO_URL` | `libsql://your-db.turso.io` | Text |
| `TURSO_TOKEN` | the Turso token | **Secret** |
| `VOICE_API_KEY` | a long random string (only if the voice agent writes data) | **Secret** |

`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are already there; the API reuses them to check logins.
Then redeploy (Deployments > Retry, or push a commit).

## 3. Put these files in the repo and push
`functions/api/[[path]].js`, `server/handler.js`, `src/lib/api.js`, `src/lib/store.jsx`, `public/sw.js`,
`.env.example`, `turso/` (migration tools). `@libsql/client` is already in package.json.

## 4. Android / iOS app
The app has no website address of its own, so before `npm run cap:sync` set in `.env.local`:
`VITE_API_BASE=https://your-site.pages.dev` (no trailing slash). The website build leaves it empty.

## 5. Voice agent (replaces the old Supabase REST calls)
Send `Authorization: Bearer <VOICE_API_KEY>`:

    POST https://your-site.pages.dev/api/voice/call
    {"property_id":"PG-UUID","caller_name":"Amit Kumar","summary":"...","intent":"bed_vacancy","sentiment":"green","duration_seconds":142}

    POST https://your-site.pages.dev/api/voice/complaint
    {"property_id":"PG-UUID","tenant_name":"Rajiv M.","message":"No hot water.","category":"Maintenance","priority":"high","kind":"complaint"}

    POST https://your-site.pages.dev/api/voice/leaving
    {"phone":"9845012345","date":"2026-10-25"}      ->  {"name":"Tenant name"} (null if no match)

Anything else the agent did with Supabase (checking free beds, bookings, visits) still needs its own endpoint.

## 6. Check it works
1. Sign in, create a PG, add a room, a tenant, record a payment. Refresh: the data is still there.
2. Sign in as a second owner: they must see none of the first owner's data.
3. Add a payment with a screenshot, add an ID photo to a tenant, then View both.
4. New calls and complaints appear within about 15 seconds (no realtime on Turso).

## Files (ID photos, payment screenshots) in Turso
- Photos are shrunk on the phone/computer before upload (longest side 1600 px, JPEG), usually 100-500 KB each.
- PDFs are stored as they are and must be 1.5 MB or smaller. Photos must end up under 1 MB after shrinking.
- File bytes live in their own `files` table (created automatically on first upload), so lists and
  dashboards never download them. Each file is only served to the owner of that PG.
- Each owner has a storage cap of 200 MB. Change it with a Cloudflare variable `FILE_QUOTA_MB` (optional).
- Files uploaded earlier to Supabase Storage still open and delete as before. New uploads go to Turso.
- In demo mode, photos stay in the browser only.

## Notes
- Do not delete the Supabase project: it still handles logins (and holds any older uploaded files).
- Dates and times are stored as text; timestamps are UTC (ends in Z).
- Revoke and recreate the Turso token if it is ever shared by mistake: `turso db tokens invalidate <db>`.

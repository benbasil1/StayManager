# StayManager: PG owner app (website + mobile app)

One React codebase that runs as:

- a **website** (desktop shows a sidebar layout, phones show the bottom-tab app layout),
- an **installable app** (PWA: "Add to Home Screen" on Android/iPhone, "Install" in Chrome/Edge on desktop),
- optionally a **native Android/iOS app** (Capacitor, see step 9).

Screens: Dashboard, Rooms & Beds, Inbox (Complaints + AI Calls), AI Assistant. Supports several PGs per owner (use the PG name at the top to switch, `+` to add one).

Everything is wired up: tap a vacant bed to add a tenant, tap an occupied bed to see that tenant's details (contact, WhatsApp, rent, dues, payment history, record a payment, move out), long-press (or right-click) a bed to delete, add beds and rooms, edit prices, floor filters, complaint status buttons, inbox tabs and filters, dashboard cards that jump to the right screen, the refresh button, sign in/out, and the assistant chips.

---

## 1. Run it in VS Code (demo mode, no setup)

1. Install [Node.js 18+](https://nodejs.org) and [VS Code](https://code.visualstudio.com).
2. Unzip this folder, then in VS Code: **File > Open Folder** and pick `staymanager`.
3. Open the terminal (**Ctrl + `**) and run:

```bash
npm install
npm run dev
```

4. Open http://localhost:5173 and click **Open demo**.

With no Supabase keys the app runs in **demo mode**: sample data is stored in your browser only. Use "Reset demo data" in the sidebar to start over.

## 2. Create the Supabase project

1. Go to https://supabase.com, sign in, **New project**. Save the database password.
2. Wait for the project to finish setting up.

## 3. Create the tables

1. In Supabase open **SQL Editor > New query**.
2. Paste the full contents of `supabase/schema.sql` and press **Run**.

This creates `properties`, `rooms`, `beds`, `tenants`, `payments`, `complaints`, `calls`, turns on Row Level Security (each owner sees only their own PGs), enables realtime, and adds the `seed_demo()` function used by the "Load sample data" button.

> Already ran an older `schema.sql`? Run the new one again: it only adds what is missing (the `tenants` and `payments` tables) and refreshes the sample-data function. Your existing data is kept.

## 4. Connect the app to Supabase

1. In Supabase: **Project Settings > API**. Copy the **Project URL** and the **anon public** key.
2. In VS Code, copy `.env.example` to `.env.local` and fill it in:

```
VITE_SUPABASE_URL=https://xxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
```

3. Stop the dev server (Ctrl+C) and run `npm run dev` again. Vite only reads `.env.local` at start.

The login screen now shows email/password instead of the demo button.

## 5. First login

1. Click **Create an account** and sign up.
2. If Supabase asks you to confirm by email, confirm, then sign in. (To skip this while testing: **Authentication > Providers > Email > turn off "Confirm email"**.)
3. On first sign-in choose **Create PG** (empty) or **Load sample data instead** (fills rooms, complaints and calls so you can see every screen working).

Now every bed toggle, price edit, new room and complaint status change is saved to your Supabase database.

## 6. Feed it from the AI voice agent

The app only shows what is in the `calls` and `complaints` tables. Your voice agent (or n8n, Make, a Python script, whatever your friend builds) should write rows there with the **service_role** key (Project Settings > API). New rows appear in the app instantly through realtime.

Get the `property_id` from the `properties` table (Table Editor). Example call log:

```bash
curl -X POST "https://YOUR-PROJECT.supabase.co/rest/v1/calls" \
  -H "apikey: SERVICE_ROLE_KEY" -H "Authorization: Bearer SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"property_id":"PG-UUID","caller_name":"Amit Kumar","summary":"Asked about a bed for a working professional.","intent":"bed_vacancy","sentiment":"green","duration_seconds":142}'
```

Example tenant complaint:

```bash
curl -X POST "https://YOUR-PROJECT.supabase.co/rest/v1/complaints" \
  -H "apikey: SERVICE_ROLE_KEY" -H "Authorization: Bearer SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"property_id":"PG-UUID","tenant_name":"Rajiv M.","message":"No hot water in the morning.","category":"Maintenance","priority":"high","kind":"complaint"}'
```

Allowed values:
- `intent`: `bed_vacancy`, `room_vacancy`, `price_query`, `complaint`, `request`, `other`
- `sentiment`: `green`, `orange`, `red`
- `kind`: `request`, `query`, `complaint`; `priority`: `low`, `medium`, `high`; `status`: `open`, `in_progress`, `resolved`

The voice agent can also read free beds from `beds` where `occupied = false` (joined to `rooms`) to answer "is a bed available?" with live data.

> Never put the service_role key inside this app or in any `VITE_` variable. It bypasses all security. Keep it only in the voice agent's server.

## 7. (Optional) Smarter AI Assistant tab (free)

Out of the box the assistant answers from your data with built-in rules. To make it understand free-form questions, deploy the `assistant` function with a **free** key from Google Gemini (https://aistudio.google.com/apikey) or Groq (https://console.groq.com/keys):

```bash
npm i -g supabase
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase secrets set GEMINI_API_KEY=your-key      # or: GROQ_API_KEY=your-key
supabase functions deploy assistant
```

Then set `VITE_USE_AI_FUNCTION=true` in `.env.local` and restart. The key stays on the server, never in the browser. Free tiers have rate limits, and the provider may use free-tier prompts to improve its products, so the assistant is sent room, complaint and call data (tenant names appear in complaints). A paid `ANTHROPIC_API_KEY` also works.

## Feedback

Settings > Feedback for the author saves messages to the `feedback` table (run the new `supabase/schema.sql` once). Read them in Supabase Table Editor.

## 8. Put the website online

```bash
npm run build      # creates the dist/ folder
```

Easiest hosting: **Vercel** or **Netlify** (both free tier). Connect the GitHub repo (or drag the folder), set build command `npm run build`, output folder `dist`, and add the same `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as environment variables. The app uses `#/` links, so no rewrite rules are needed.

Then in Supabase, **Authentication > URL Configuration**, set **Site URL** to your live address.

**As an app, no app store needed:** open the live site on a phone, then Chrome menu > *Add to Home Screen* (iPhone: Share > *Add to Home Screen*). On desktop Chrome/Edge, click the install icon in the address bar.

## 9. (Optional) Real Android / iOS app (Play Store / App Store)

```bash
npm i @capacitor/core @capacitor/cli @capacitor/android @capacitor/ios
npm run build
npx cap add android      # and/or: npx cap add ios  (iOS needs a Mac with Xcode)
npx cap sync
npx cap open android     # opens Android Studio, press Run
```

After any code change: `npm run cap:sync`. `capacitor.config.json` is already set up (`appId: com.staymanager.app`; change it to your own ID before publishing).

## ID proof (Aadhaar, PAN, etc.)

Each tenant has an **ID type** and the **last 4 digits** of the ID (set it in Add / Edit tenant), plus uploaded **photos or PDFs** (tenant details > ID proof > Add photo / PDF). On a phone the upload button offers the camera, so you can photograph the card on the spot. Tap **View** any time to open it.

- Files live in a **private** Supabase Storage bucket called `tenant-docs` (created by `schema.sql`). Each owner can only open files in their own folder, and "View" uses a link that expires after 5 minutes. Never switch the bucket to public.
- If you set up Supabase before this feature existed, run the new `supabase/schema.sql` again once.
- Store only the last 4 digits of an ID number, never the full number. Ask for the tenant's consent, and delete their documents when they move out unless you need to keep them.
- In demo mode, photos are shrunk and kept in your browser only (2 per tenant, no PDFs).

## Payment screenshots

When you record a payment you can attach the UPI/bank screenshot (photo or PDF). Past payments show **View screenshot**, or **Add screenshot** if none was saved. Files are kept privately in the same `tenant-docs` bucket. Run the new `supabase/schema.sql` once (it adds `payments.proof_path`).

## Leaving dates, vacancies and notifications

- **Leaving date:** set it in the tenant's details (or the Edit form). The bed chip shows "leaving 25 Oct", the dashboard shows a **Leaving soon** list, and vacant beds show "Vacant since ...". The bed is never freed automatically: you still tap **Mark bed vacant** when they leave.
- **From the AI Assistant tab:** type e.g. "Rohit is leaving on 25 Oct" and it saves the date.
- **From your phone voice agent:** call the `report_leaving` function with the service_role key. It saves the date and adds a request to the Inbox so you are notified:

```bash
curl -X POST "https://YOUR-PROJECT.supabase.co/rest/v1/rpc/report_leaving" \
  -H "apikey: SERVICE_ROLE_KEY" -H "Authorization: Bearer SERVICE_ROLE_KEY" -H "Content-Type: application/json" \
  -d '{"p_phone":"9845012345","p_date":"2026-10-25"}'
```
It finds the active tenant by phone number and returns their name (null if no tenant matches). Run the new `supabase/schema.sql` once first.
- **Notifications:** new calls, complaints and requests show a pop-up, a red count on Inbox, and (if allowed in Settings) a system notification while the app is open. There is no push when the app is fully closed.

## Project map

```
src/
  App.jsx               layout: sidebar (desktop) + bottom tabs (phone), hash routing
  styles.css            all styling (green theme from your mockups)
  components/           Dashboard, Rooms, Inbox, Assistant, Login, Icon
  lib/supabase.js       Supabase client (+ demo mode switch)
  lib/api.js            every database call
  lib/store.jsx         app state, optimistic updates, realtime
  lib/demoData.js       demo-mode sample data
  lib/idDocs.js         ID photo upload / view / delete
supabase/
  schema.sql            tables, security rules, realtime, sample-data function
  functions/assistant/  optional Claude-powered assistant
public/                 PWA manifest, service worker, icons
```

## Notes

- **Revenue** on the dashboard = rent per bed x occupied beds, summed over rooms. A room's price pill is the rent **per bed**.
- **Troubleshooting:** blank data after login means `schema.sql` was not run; "permission denied / row-level security" means you are inserting rows with a wrong `property_id` or without being signed in; changes to `.env.local` need a dev-server restart.

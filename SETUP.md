# Standing up a new station

This is Joshua's checklist, not the station commander's. The commander never
touches any of this — they get a link and the one-page guide in
[`STATION_COMMANDER_GUIDE.md`](./STATION_COMMANDER_GUIDE.md) once everything
below is done.

Each station needs its own: GitHub repo (its own Pages URL), Google Sheet,
and two Apps Script deployments. None of that can be shared across stations.
Budget ~20-30 minutes per station the first couple of times.

## 0. One-time: make this repo a template (skip if already done)

GitHub → this repo → **Settings** → General → check **Template repository** →
Save. Do this once, ever. After this, step 1 below becomes a single button.

## 1. Create the new station's repo

1. GitHub → this repo's main page → green **Use this template** button →
   **Create a new repository**.
2. Name it `<Station>_EST` (e.g. `Columbia_EST`). Keep it **Public** — GitHub
   Pages needs that on a free account, and there's no PII in this repo (PII
   lives in the station's own private Sheet, not here).
3. Create it.

## 2. Turn on GitHub Pages

New repo → **Settings** → **Pages** → Source: **Deploy from a branch** →
Branch: `main`, folder `/ (root)` → **Save**. Wait ~1 minute, then the Pages
URL shows at the top of that same screen (`https://<you>.github.io/<repo>/`).
That URL is what goes on the iPad later.

## 3. Create the station's Google Sheet

New blank Google Sheet, owned by (or shared appropriately with) the new
station. Name it something like "`<Station>` EST Results". Grab its ID from
the URL (`.../d/`**`THIS_PART`**`/edit`) — needed in step 4.

## 4. Deploy the public results webhook

This is the endpoint the kiosk POSTs each result to. It must be **public**
("Anyone") because the kiosk itself is public and unauthenticated — it only
ever writes, never reads back.

1. From the new Sheet: **Extensions → Apps Script**.
2. Delete the default `Code.gs` content, paste in this repo's
   `apps-script/results-webhook.gs`.
3. Near the top of that file, set for this station:
   - `NOTIFY_EMAIL` — who gets the result-notification email (or `""` to
     disable email entirely)
   - `SHEET_URL` — this Sheet's URL (used in the notification email's
     "view full sheet" link)
4. **Deploy → New deployment → Web app**. Execute as: **Me**. Who has
   access: **Anyone**. Deploy.
5. Copy the `/exec` URL it gives you — this is `resultsWebhookUrl` in step 7.

## 5. Deploy the private roster dashboard

A **separate** Apps Script project, kept private, so results/PII are never
reachable from the same public URL the kiosk uses.

1. From the same Sheet: **Extensions → Apps Script** again, but this time
   click the project dropdown (top left) → **New project** — don't reuse
   the one from step 4.
2. Paste in `apps-script/roster-dashboard.gs`.
3. Set `SHEET_ID` at the top to the Sheet's ID from step 3.
4. **Deploy → New deployment → Web app**. Execute as: **Me**. Who has
   access: **Only myself**. Deploy.
5. Copy this `/exec` URL too — it's the private dashboard link. This one
   does **not** go in the kiosk config; bookmark it for whoever reviews
   results at that station (you, or the new station's commander if they're
   comfortable with it).

## 6. Get the station's March2Success referral link

Register (or ask the gaining recruiter to register) a recruiter account at
march2success.com and pull their referral/registration link — it'll look
like `https://march2success.com/register?params=mID<NUMBERS>%7C<Name>`.

## 7. Edit the kiosk's config

Open `est-kiosk-standalone.html` in the new repo, find the
`window.EST_CONFIG = {` block near the top of `<head>` (it has a big
`STATION CONFIG` comment right above it — that comment lists everything
below too, in more detail than this checklist). Set:

- `recruiters` — this station's roster, `"Lastname RANK"`
- `resultsWebhookUrl` — the `/exec` URL from step 4
- `m2sSignupUrl` — the link from step 6
- `nextStepsOptions` — leave as-is unless the station wants different presets
- `scoresAccessLastName` / `scoresAccessFirstName` — leave as-is unless you
  want a different on-device passphrase
- `idleTimeoutMinutes` — leave as-is (30) unless asked to change

## 8. Regenerate the QR code

`assets/m2s_qr.png` is a static image baked from the *old* `m2sSignupUrl` —
changing the config in step 7 does not change this picture. Generate a new
QR code from the station's `m2sSignupUrl` (any QR generator — e.g.
qr-code-generator.com — paste the URL, download the PNG), and overwrite
`assets/m2s_qr.png` with it.

## 9. Rename the station everywhere else

A few more places still say "Florence" — none of these can read from
`EST_CONFIG` (browsers read them before any JS runs):

- `est-kiosk-standalone.html`: the `<title>` tag and the
  `<meta name="apple-mobile-web-app-title">` tag, both near the top of
  `<head>`
- `index.html`: same two tags
- `manifest.json`: `"name"` and `"short_name"`

## 10. Bump the service worker cache

`sw.js` → `CACHE_NAME` → increment the version number (e.g. `v1` →
`v2`). Skipping this means an iPad that already opened the site once will
keep serving whatever it cached before your edits — this is the single
easiest step to forget. See the comment directly above `CACHE_NAME` in that
file.

## 11. Commit and push

Commit everything, push to `main`. GitHub Pages redeploys automatically
(~1-2 minutes, sometimes up to ~10 for the CDN to fully catch up).

## 12. Verify before handing it off

1. Open the station's Pages URL in a normal browser tab.
2. Run one full practice test (any answers — doesn't need to be correct).
3. Confirm a row landed in the station's Sheet and the notification email
   arrived (if `NOTIFY_EMAIL` is set).
4. Open the private roster dashboard URL from step 5, confirm that test
   shows up with filters working.
5. If anything looks stale (old station's name, old recruiter list), it's
   almost always step 10 — force-clear the service worker: open the page,
   dev tools → Application → Service Workers → Unregister, then
   Application → Storage → Clear site data, then reload.

## 13. Hand it off

Give the station commander:
- The Pages URL from step 2
- The [`STATION_COMMANDER_GUIDE.md`](./STATION_COMMANDER_GUIDE.md) file (or
  its contents pasted into a message/email) — it's written for them, not for
  a developer
- The private dashboard URL from step 5, if they're the one reviewing
  results day to day

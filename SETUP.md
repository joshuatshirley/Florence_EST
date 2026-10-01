# Adding or standing up a station

This is Joshua's checklist, not the station commander's. The commander never
touches any of this — they get a link and the one-page guide in
[`STATION_COMMANDER_GUIDE.md`](./STATION_COMMANDER_GUIDE.md) once a link is
ready for them.

There are three ways a station can use this, cheapest first. Pick the
lightest one that fits before reaching for the next.

## Option A: add them to the shared link (no setup at all)

This repo's live link already supports multiple stations — the Recruiter
dropdown just lists station names, and the one Sheet/dashboard behind it
tells usage apart by that field. To add a station here: edit `recruiters`
in `index.html`'s `window.EST_CONFIG` block, commit, push, bump
`sw.js`'s `CACHE_NAME`. That's it — no new Sheet, no new Apps Script,
no new repo. Good for a station that just needs a link to hand out and
doesn't need its own branded dropdown.

## Option B: give them their own link, same backend

For a station that wants its own recruiter roster in the dropdown (like
Florence's own `Florence_Practice_Test` link) without needing a fully
separate results Sheet. This is still cheap — one new repo, zero new
Apps Script deployments.

1. New GitHub repo (empty — I can't create repos myself, so this step is
   on you: **New repository** → name it `<Station>_Practice_Test` or
   similar → Public → no README/gitignore/license → Create). Give me the
   URL and I'll push the content.
2. I'll copy `index.html`, `question-data.js`, `manifest.json`, `sw.js`,
   `assets/`, and `icons/` into it (not `apps-script/`,
   `question-bank/`, or `tools/` — this repo doesn't own a backend, so
   those don't apply) and set, in the new repo's `index.html`:
   - `recruiters` — this station's actual roster, `"Lastname RANK"`
   - `resultsWebhookUrl` — **unchanged**, same URL as this repo's — that's
     what makes it share the backend
   - `m2sSignupUrl` — this station's own March2Success referral link
     (see the note under "Rename the station" below about the QR image)
3. You turn on GitHub Pages for the new repo (**Settings → Pages →
   Deploy from a branch → main → / (root) → Save**) — I can't do this
   part either.
4. See "Rename the station" and "Verify" below — same steps regardless
   of which option got you here.

## Option C: a fully separate backend

Only do this if a station genuinely needs its results isolated from
everyone else's — a different chain of command reviewing them, a data
segregation requirement, etc. This is the expensive path: a new Sheet
and two new Apps Script deployments, maintained separately from here on.
Budget ~20-30 minutes.

1. New blank Google Sheet, e.g. "`<Station>` EST Results". Grab its ID
   from the URL (`.../d/`**`THIS_PART`**`/edit`).
2. **Deploy the public results webhook** (the kiosk POSTs each result to
   this; must be public/"Anyone" since the kiosk itself is unauthenticated
   and this endpoint only ever writes, never reads back):
   - From the Sheet: **Extensions → Apps Script**. Delete the
     boilerplate, paste in this repo's `apps-script/results-webhook.gs`.
   - Set `NOTIFY_EMAIL` and `SHEET_URL` at the top for this station.
   - **Deploy → New deployment → Web app**. Execute as **Me**, access
     **Anyone**. Deploy, copy the `/exec` URL — this is
     `resultsWebhookUrl` below.
3. **Deploy the private roster dashboard** (a *separate* Apps Script
   project — new project, not reusing the one above — kept private so
   results/PII are never reachable from the same public endpoint):
   - Same Sheet → **Extensions → Apps Script** → project dropdown → **New
     project**. Paste in `apps-script/roster-dashboard.gs`, set
     `SHEET_ID` to this Sheet's ID.
   - **Deploy → New deployment → Web app**. Execute as **Me**, access
     **Only myself**. Deploy, copy this `/exec` URL too — this is the
     private dashboard link. It does not go in the kiosk config.
4. New GitHub repo for this station (same as Option B step 1), with
   `resultsWebhookUrl` set to the webhook URL from step 2 (not shared
   with any other repo this time) and `recruiters` set to this station's
   actual roster.
5. Turn on GitHub Pages (same as Option B step 3).

## Rename the station

Whichever option got you here, a few things still say "Florence" and
can't be pulled from `EST_CONFIG` (browsers read them before any JS
runs):

- `index.html`'s `<title>` and `<meta name="apple-mobile-web-app-title">`
  tags, near the top of `<head>`
- `manifest.json`'s `"name"` and `"short_name"`
- `assets/m2s_qr.png` — a static image baked from `m2sSignupUrl`.
  Changing the config does not change this picture; regenerate it from
  the station's actual `m2sSignupUrl` (any QR generator — e.g.
  qr-code-generator.com — paste the URL, download the PNG) and overwrite
  this file, or the printed code points students to the wrong referral
  link.

And always: bump `sw.js`'s `CACHE_NAME` (increment the version number).
Skipping this means an iPad that already opened the site once keeps
serving whatever it cached before your edits — the single easiest step
to forget. See the comment directly above `CACHE_NAME` in that file.

Commit, push. GitHub Pages redeploys automatically (~1-2 minutes,
sometimes up to ~10 for the CDN to fully catch up).

## Verify before handing it off

1. Open the Pages URL in a normal browser tab.
2. Run one full practice test (any answers — doesn't need to be correct).
3. Confirm a row landed in the Sheet and the notification email arrived
   (if `NOTIFY_EMAIL` is set — Options A/B share this repo's Sheet and
   email; Option C has its own).
4. Open the roster dashboard URL, confirm that test shows up with
   filters working.
5. If anything looks stale (old name, old recruiter list), it's almost
   always the cache-bump step above — force-clear it: open the page, dev
   tools → Application → Service Workers → Unregister, then Application
   → Storage → Clear site data, then reload.

## Hand it off

Give the station commander:
- The Pages URL
- The [`STATION_COMMANDER_GUIDE.md`](./STATION_COMMANDER_GUIDE.md) file
  (or its contents pasted into a message/email) — written for them, not
  for a developer
- The roster dashboard URL, if they're the one reviewing results day to
  day

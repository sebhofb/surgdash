# SURGdash roadmap

Working list of what to build next. Keep entries short; link to code when a
decision is made. Items move to `js/whatsnew.js` when they ship.

## Done — enrolments & progress from the API (2 September 2026, commit 2496d86)

The card-2 "User Progress" xlsx is no longer the only source of per-learner
dates. `js/enrolmentSync.js` fetches, per account, `/users/{id}/courses` (one
record per enrolment with its own `created`) and `/users/{id}/progress`
(status, progress rate, time on course in seconds, score, `completed_at`),
plus `/certificates` for issued dates, and writes the importer's exact row
shape into `surghub_completion` — nothing downstream changes. LearnWorlds
enforces roughly **60 requests/minute sustained** (bursts of 8 req/s pass; the
first run spent 6.4 of 7.2 hours on Retry-After waits), so the sync is paced at
55/min, **checkpoints every 200 accounts**, and **resumes** — the next "Sync from
API" first ingests offline whatever the raw receipt already holds, then continues.
A full pass over ~63k accounts is ~33 hours of API time spread over sessions;
incremental runs (accounts active since the last completed run) take minutes.
Verified on 13 learners / 200 rows against the xlsx, and on the interrupted
run's receipt (5,595 accounts / 9,382 rows): dates never later, time never
lower, no certificate lost; 93 completions newer than the 14 Aug export.

**4 September 2026 — the run has to survive the night.** The 3 Sep session died
at 22:52 on `net::ERR_NETWORK_CHANGED` (a one-second Wi-Fi change) while listing
accounts at page 227 of 315: only 429s were retried, the failure surfaced as a
toast nobody saw, and card 2 showed the same "paused" line as a clean Cancel —
so nothing ran overnight. Now `_enrGet` retries transient failures in place
(network errors, 5xx, non-JSON bodies, 429s that outlast apiGet's own three
retries) with waits of 15 s, 30 s, 1, 2, 5 min and then every 10 min, for up
to 40 attempts (~6 h of outage) before giving up; 429 exhaustion also widens
the pacing gap by 20% (floor 20/min) for the session. Auth/config failures stop
at once; a bad request on one account skips just that account. The run record
keeps `pausedBy` (cancel/error), `pausedAt`, `lastError` and a session counter,
and the card says "in progress", "paused (Cancel)", "stopped by an error <when>
— <why>" or "interrupted". The abort flag is reset on entry (an earlier Cancel
used to end the next run at its first request with a phantom "cancelled"). A
receipt whose run moved on to accounts after its last certificate page counts
as a completed certificate pass, so the daily ~31-minute pass is skipped while a
receipt under a day old holds one. Fake-API harness: 31 checks (network blip,
429 slow-down, auth stop, Cancel during a retry wait, stale abort flag,
receipt-derived certificate refresh, give-up path).

**6 September 2026 — receipts outgrow V8's string limit.** The 4–6 Sep session
(46,876 accounts over two days) left a 923 MB receipt; the next resume died
three times in `_enrParseReceipt` with "Cannot create a string longer than
0x1fffffe8 characters" (Node's ~512 MB maximum string, hit by
`readFileSync(…, 'utf8')`). The preload bridge now exposes chunked read-only
access (`openSync` / `readSync` → exact-length Uint8Array / `closeSync`, fds
tracked), `_enrReadLines` streams a receipt in 16 MB slices through a
`TextDecoder`, and `_enrParseReceipt` peeks at each line's path with a regex
and only JSON-parses the bodies it needs: /users and /certificates pages
always, per-account bodies only for ids not already saved by the open or the
previous run (`priorProcessed`). The 923 MB receipt parses in ~0.6 s with the
heap flat at ~65 MB and yields exactly the 134 accounts fetched after the last
checkpoint. Also learned: closing the lid on battery sleeps the Mac regardless
of `caffeinate -s` (AC only), and quitting the app mid-run loses at most the
accounts since the last checkpoint — which the receipt harvest recovers.

**6 September 2026 (late) — the certificate pass was the real cost.** The
`/certificates` endpoint has its own limit: a call sooner than ~10 s after the
previous one is answered 429 + Retry-After 10, so the "paced" pass ran at ~5
pages/min and the daily ~1,750-page pass would have taken ~5 hours before a
single account was fetched (the 3 Sep evening run spent 4.5 h there too). The
API lists certificates newest-first (verified on 25 pages), so the pass is now
incremental: per course it stops at the first page whose certificates are all
in the index and all issued before the last complete pass (`meta.certsAt`);
new courses are walked to the end. That is ~1–2 pages per course, ~1 h/day at
the endpoint's limit, paced separately at 10.5 s (`ENR_CERT_GAP_MS`) so the
account phase's pacing is untouched. The pass now runs AFTER the accounts and
`_enrApplyCertIndexToRows` then joins the index onto every learner record, so
ordering loses nothing and xlsx-era rows also pick up later certificates.
Harness: 52 checks.

Rules that must survive future edits: start_date only when the learner has
progress (never-opened stays undated); rows from the union of enrolments and
progress (unenrolled courses keep their learning); dates only move earlier
(re-enrolment resets the enrolment `created`); time = max(API, prior).

Follow-ups:
- Finish the open full run in sessions (card 2 → "Sync from API" resumes it;
  keep the Mac awake with `caffeinate -i -s`, on mains, lid open; 46,876 of
  62,931 accounts done as of 6 Sep, ~10,000 still to fetch). After it
  completes, compare the Overview/Compare figures with the last xlsx-based
  numbers before trusting it for a report.
- Two paced workers under the same 55/min cap would roughly halve session time
  when the API answers slowly (~2 s per request → 31 req/min observed).
- Learner journeys: possible next steps — funnel + top paths in the HTML
  snapshot and the provider packages; a "recommended next course" list per
  course for the SURGhub site, derived from the 2-course paths.

## Done — card 2 faster still: parallel workers, one listing per night (10 September 2026)

- **Serialized pacer** (`_enrPace` as a promise chain): concurrent callers each
  get one slot, so parallel workers cannot burst; the cap is unchanged.
- **Parallel fetching under the cap**: `ENR_LIST_WORKERS` (3) for the account
  listing (~8 → ~6 min, the cap's floor), `ENR_WORKERS` (2) for the account
  phase (hides the API's 1.5–2 s latency; one worker only reached 30–45
  req/min). Checkpoints are serialized and swap buffers first (no account
  marked saved without its rows); cancel/auth failure stops every worker.
- **Listing reuse**: the Learners sync shares its account listing
  (`App._enrUsersCache`); an enrolment sync within `ENR_LISTING_REUSE_MIN`
  (30) reuses it — the nightly run and Sync Everything list once. The receipt
  gets the reused listing as one synthetic page (`LearnWorlds.captureRaw`).
- **Half-captures** (cancel between an account's two calls) are no longer
  ingested from receipts as complete.
- **API probe (read-only)**: `/users` ignores `last_login_after`,
  `created_after`, `updated_after` and sort params; ordering is sign-up date
  descending, recent logins spread over ~30 pages — no early stop possible.
- Nightly budget now: listing 0 (reused) or ~6 min, accounts ~5–8 min,
  certificates ~5–10 min. Remaining levers are outside card 2: card 1 and the
  ambassadors sync are already at the cap; the UI's Tailwind Play-CDN build is
  the main interactive-speed item left (needs a visual check after).

## Done — card 2: why the afternoon run crawled, and the fix (10 September 2026)

Seb's run after the parallel build showed "8,530 accounts this session · ~13 h
left". Two causes, both read off the receipts (`raw/enrolments__*/pull.jsonl`
request timestamps) and `settings/enrolment_sync.json`:

- **The API put the app in a penalty box.** Two account workers at 55/min ran
  13 minutes, then LearnWorlds answered 429 (Retry-After 30 s, then 60 s). The
  refused worker waited inside `apiGet`'s own retry while the other worker kept
  requesting, so the client was never silent — and the server let exactly ONE
  request through per minute for two hours (12:49–14:40 UTC). Single-flow
  sessions at ~50/min (the 13:29 session, the 08:00 UTC hour of the full pass
  at 53/min) were never refused; on 4 Sep a single flow at 70–136/min was
  refused but recovered each time because it went quiet. Fix in
  `js/enrolmentSync.js` + `js/learnworlds.js`: `apiGet(…, { rateLimit: 'throw' })`
  surfaces a 429 at once (status + Retry-After); `_enrRateLimited` holds EVERY
  worker (the pacer honours `_enrPausedUntil`; ≥ 60 s or the server's
  Retry-After, doubled when refused again within 5 min, ≤ 15 min), then the
  session continues single-file (one request in flight, a pacer guarantee) a
  third slower. Defaults: `ENR_TARGET_PER_MIN` 50, `ENR_WORKERS` 1,
  `ENR_LIST_WORKERS` 2. The overlay and card 2 say when the API refused.
- **The full pass's record had been lost, so 7,300 unchanged accounts were
  being re-fetched.** The 13:29 run (old build) replaced `meta.run`, and the
  receipts holding the first 8,500 accounts of the full pass had been pruned
  (retention keeps three), so those accounts had no fetch time and counted as
  "never fetched". Offline check on the live listing: 7,325 of the 7,330 still
  selected had NOT logged in since the pass began (5 were new sign-ups).
  Fix: `_enrSeedFetchedAtFromFullPass` — after the listing, every account
  created before the completed full pass began (`meta.lastFullStartedAt`, now
  recorded when a full run completes; for this device taken from the earliest
  `enrolments__` pull in `raw/manifest.jsonl`) with no fetch time is credited
  with the pass's start, so only a login since then re-fetches it.
- Verified with 43 fake-API checks (`test_enr_ratelimit.js` 16 — shared hold,
  Retry-After, escalation, sibling refusal, cancel during a hold, listing
  single-file, seeding from the manifest, no seeding without a completed
  pass; `test_enr_fast.js` 13; `test_enr_parallel.js` 14).
- To resume on Seb's Mac: Cancel the crawling run, restart the app, "Sync from
  API" → listing ~8 min (or reused), ~5 accounts, then the 3-day full
  certificate walk (~50 min, `ENR_CERT_FULL_DAYS`).

## Done — card 2 incremental runs made small (10 September 2026)

Two levers in `js/enrolmentSync.js`:
- **Per-account fetch times** (`meta.fetchedAt`, id → epoch, kept across runs;
  seeded from the receipts' exact request times, else the pass's start). An
  incremental run re-fetches only accounts that logged in after their last
  fetch (plus a 6-hour session slack), were created after it, or were never
  fetched — instead of everyone active in a two-day window. Steady state: the
  day's active accounts, ~15 minutes, not ~2 hours.
- **Targeted certificate walks**: each session walks only the courses where a
  fetched account completed something since the last walk; every course is
  walked at most every `ENR_CERT_FULL_DAYS` (3) as a safety net. The daily
  24-hour gate is gone (targeted walks are cheap, so certificates land the same
  session). `meta.certsFullAt` tracks the last full walk; receipts that prove a
  complete pass set it too.
Fake-API test: 13 checks (selection rule incl. slack and fallback, fetch times
recorded/refreshed/seeded, receipt times override the seed, targeted vs full
walk, quiet day does nothing).

## Done — Sync Everything includes card 2; targeted redraws (10 September 2026)

- **Sync Everything** now runs a third stage, Enrolments & progress: incremental
  when a full pass has completed, resuming an interrupted pass otherwise, and
  skipped with a note if card 2 has never completed (a 30-hour first pass is
  never started from here). It runs last, in-flight flag released around it,
  Cancel keeps the earlier stages; the summary reports accounts refreshed, new
  certificates and a pause. The old "NOT refreshed by this sync" warning is gone.
- **Targeted redraws** (`js/ui.js`): each view that draws charts remembers its
  draw hook (`_currentDraw`); `redrawCharts()` re-runs it without touching the
  DOM. `rerenderDashTab()` re-renders only `#dash-content` for the current
  dashboard tab (the overview still needs the full pass for its KPI cards) and
  runs that tab's own charts — no sidebar/header rebuild, no scroll jump.
  `setIncludePartialMonth(v)` syncs every partial-month toggle and caption on
  the page (`data-partial-toggle`, `data-partial-caption`), then redraws charts
  or re-renders an HTML tab. `_setChartWidth` resizes the wrapper, refreshes the
  S/M/L buttons and redraws that one chart from `Charts.redrawRegistered` (the
  export registry's last data). Tab-local controls in journeys / compare /
  institutions call `rerenderDashTab()`. Convention for new tabs: tab-local
  state → `App.rerenderDashTab()`; navigation → `renderView()`.

## Done — background sync of cards 3 and 2 (10 September 2026)

`js/backgroundSync.js`. Once a day, at the first quiet moment (3 min without
input) after a chosen hour (default 02:00) while the app is open, the Learners
& Ambassadors sync and then the incremental Enrolments & progress sync run by
themselves — the same functions as the buttons, `{silent: true}`. Progress
shows in a corner pill with Details / Stop (`_updateApiSyncOverlay` routes to
it while `_bgSyncRunning`); no dialogs. Runs only where the API credentials
are, never alongside another sync, once per calendar day; card 2 is skipped
with a note until a full pass has completed (a paused run is resumed). Panel
above card 1 on Data Sync: switch, hour, per-card toggles, last run summary,
Run now. Settings + 7-run log in `settings/bg_sync.json` (device-local nav
key). Follow-up: an optional Sheets push after a successful night so viewer
machines wake up to the new numbers.

## Done — ambassador attribution keeps itself current (9 September 2026)

Bug report: Neharaj Pitla showed 462 referrals on the Ambassador Performance
table and 517 on the Top Ambassadors chart. The chart reads the ambassadors
sync (7 Sep); the table reads a derived referrer → learner bridge
(`surghub_referrer_bridge`) that had last been built on 27 Jul and only
rebuilt on a manual Refresh. Now `_referrerBridgeStale()` compares the bridge's
source captures with the newest demographics / ambassadors receipts on disk,
the Ambassadors tab rebuilds a stale bridge silently once per set of captures,
the Learners (API) and Ambassadors syncs rebuild it on completion, and the
table header states the build date and capture (amber while newer data exists).
Rebuild is ~100 ms; names and counts only are persisted.

## Done — start on the last screen (9 September 2026)

`renderView()` records `{project, view, course, provider}` into the device-local
UI state (`_lastScreen` in `settings/ui_state.json`) while editing is
unlocked. The app always opens read-only on the org dashboard, so the restore
happens in `unlockEdit()`: if the editor is still on that startup screen when
they unlock, they are taken back to the remembered one (navigating first wins).
Viewer-mode renders are not recorded, so the startup screen cannot overwrite
the memory. A remembered course or provider that no longer exists falls back to
the platform view; a view whose project type no longer matches is ignored;
creation flows are never remembered; switching project on restore also writes
`surgdash_last_project`. "Reset view preferences" forgets it. 16 unit checks.

## Done — Learner lookup (9 September 2026)

`js/lookup.js`, dashboard pill "Learner lookup" (`data-edit-only`, content also
checks `App.editUnlocked`): search by email, name or hashed id, pick a learner,
see sign-up day and last login (account index), country and profession
(per-email demographics), totals, and one row per enrolment (enrolled, opened,
certificate day, learning minutes with the fast-certificate flag, score,
status). "Copy history" puts a plain-text summary on the clipboard for a
support reply. Personal data rules: the tab's markup is wrapped in
`data-no-export` so DOM-based exports strip it; the query and selection live in
memory only (deliberately NOT in uiState); typing re-renders only the result
list so the box keeps focus. Live-data test: 15 checks, printing counts only.

## Done — Learner journeys tab (9 September 2026)

`js/journeys.js` (pill "Learner journeys", loads before uiState.js): what the
API enrolment dates unlock.
- **Funnel** enrolled → opened → completed → certified, per course or per
  provider (min-enrolments filter, sortable, Excel). "Opened" = start date
  present; "completed" = LearnWorlds flag OR certificate (the flag alone makes
  the funnel run backwards: Navigating shows 51 completed vs 366 certified).
- **Pathways**: each learner's opened courses ordered by date (one entry per
  course); consecutive pairs → "most travelled paths", per-course "go on to /
  came from", courses-per-learner histogram, median gap, and "returned after a
  certificate" (opened another course after the day of the first certificate:
  19.8% platform-wide on 9 Sep). Top path: Surgical Foundations → Suture
  Technique.
- **Time to completion** (enrolment → completion, since API start dates equal
  the enrolment date) with a **fast-certificate flag** (`JRN_FAST_MIN` = 10
  recorded minutes; 2,062 of 33,411 certificates).
- **Activation & activity** from a new hashed account index `surghub_accounts`
  (`surghub/accounts.json`: sign-up day, last-login day, email domain per uid;
  written by every enrolment sync's account listing and by the receipt harvest;
  "Build from the last sync" creates it from the newest receipt; in the JSON
  backup/restore/wipe lists, never in exports). Activated = first course
  opened within 30 days of sign-up (81% of 63,204 accounts on the 6 Sep
  listing; 17% dormant; 6,739 active in the last 30 days, 14,926 in 90).
- Course and provider pages carry a "Learner journey" strip (funnel, next /
  previous courses, time to completion, fast certificates, return rate).
- Revision the same day: **a certificate is the completion test** (LearnWorlds'
  completed flag ignored; funnel = enrolled → opened → completed(certificate),
  durations enrolment → certificate day). Paths are shown as a plain **Top
  learning paths** list: the most common sequences of 2, 3 or 4 courses opened
  one after the other (course pills joined by arrows; learners, share of the
  first course's openers, median days apart for pairs; sort by learners or
  share; min-learners filter). A Sankey flow was built and then removed the
  same day as too complicated for the question — the list answers it.
- Live-data harness: 23 checks (independent recounts, Σnext = Σprev =
  transitions, index ↔ records join 55,722/55,809, tab renders both with and
  without the account index).

## Done — course trend sparklines (7 September 2026)

`js/sparklines.js`: a tiny inline-SVG line per course in the provider course
table and the Tracked Course Directory — courses started per month over the
last 12 complete months, with the current month as a hollow point on a dashed
segment when "Include current month" is on. Colour and label compare the last
3 complete months with the 3 before (≥ ±15% green/red, else grey; "new" when
the earlier quarter had none, "×N" beyond +1000%). Built from the completion
records already in memory (start_month per learner-course, counts only), index
rebuilt only when the records array changes (~40 ms for 150k rows), records
loaded on demand when the provider page is opened first. The interactive HTML
snapshot (export.js) carries the same sparklines in its provider and all-courses
tables: each course embeds its 13 monthly counts (`Trend`, counts only) and the
renderer is a standalone function (`__sparkSvg`, no `this`) whose source is
spliced into the exported page, so the export's own "include current month"
toggle drives the hollow point. Providers get the same line (their included
courses' monthly starts summed — `providerTrendSeries`, `__sparkSum` in the
export): on every row of the Providers directory, in the Provider Reports and
Course Details page headers next to the picker, and on the dashboard's All
Courses table; the snapshot's provider and course tabs carry the header line.

## Done — 2 September 2026 feature pass

The five features from the August review, all on `main`:

- **Persist UI state** (`js/uiState.js`, commit b241fcf). Dashboard tab,
  partial-month toggle, chart widths, trim/range toggles, category pickers,
  reach options and the new tabs' controls survive a restart, per device.
  Scalars are accessor-backed (no call-site changes); object prefs are
  snapshotted on `renderView()`. Stored at `settings/ui_state.json`, key
  `surgdash_ui_state` — forward-mapped only (never enumerated, pushed or
  exported) and in `NAV_KEYS` so a click never trips the unsynced banner.
  "↺ Reset view preferences" sits in the overview's Data-through line.
- **Institutions & cohorts tab** (`js/institutions.js`, b241fcf). Learners
  grouped by email domain from the completion records; webmail and relay
  domains pooled as "Personal email". KPI strip, dominance flags (months where
  one institution exceeded a chosen share — default 15% — of courses started
  or certificates; seha.ae is caught at 43%/47% in May/June 2026), sortable
  institution table, courses-started-per-month chart with the category
  picker, Excel export. Domains and counts only; no email is rendered.
- **Email-domain hygiene** (same file). Conservative typo detector: same
  registrable label with a different ending on tiny domains (seha.e / .ar /
  .a / .se → seha.ae), one- or two-edit near-misses of institutions whose
  label has ≥ 4 chars, webmail near-misses (gmil.com → gmail.com). nhs.scot
  and two-letter university domains are deliberately not flagged. 66 suspects
  on current data.
- **Compare periods tab** (`js/compare.js`, fcec8e9). Two month-aligned
  periods side by side — activity, per-day rates, certificates ÷ starts and a
  true cohort completion rate, survey volume and mean, reach shares, and the
  platform at each period end — with presets (last 12 complete months, July–
  June years, calendar years, custom) and an optional only/exclude filter on
  one institution for the completion-based metrics. Excel export. Reproduces
  the September director figures exactly on the same data.
- **Anomaly flags** (`js/anomalies.js`, fcec8e9). "Worth a look" strip above
  the overview KPIs: a source > 7 days behind the newest (with a Data Sync
  action), one institution dominating the latest complete month, a KPI > 2σ
  from its trailing-12 mean, a month with starts but no certificates, a
  country suddenly dominating sign-ups, registrations under half the prior
  3-month mean. Uses only sources already in memory; collapsible.

Definitions these tabs share (keep them consistent when adding more):
"courses started" = enrolments the learner opened (start date present; ~13% of
enrolments are never opened and carry no date); "survey responses" = submissions
with a 1–5 rating (submissions without a rating are shown separately); the
institution filter is exact-domain (typo variants are listed in the hygiene
panel, not swept in); "joined" on the Institutions tab = month of first course
start, because no per-email registration date is held.

## Done — August 2026 hardening pass

- Preload filesystem bridge path-guarded; salted PBKDF2 role passwords kept
  out of the Sheets push (d6632d9).
- Renderer-wide error capture (`js/errors.js`), full pre-sync backup with
  hard-link dedupe, KPI units, "Data through" freshness line (05a1a33).
- `Retry-After` honoured; CSP trimmed to gstatic + Google Fonts; Sync
  Everything states the age of the card-2 upload; pending submissions indexed
  (5d77936).
- One ISO pivot for country names: `countryToISO()` completed (246 codes, 75
  aliases) with ISO fallbacks in the income classifier, Lancet list and
  conflict matcher (ed09aaf).

## Later — follow-ups surfaced while building

- Institution filter: option to include a domain's detected typo variants
  (the 13 `seha.*` accounts hold ~8 certificates).
- Registrations by institution need a per-email registration date; the
  LearnWorlds `/users` pull has `created` but the app only keeps it in raw
  receipts. Persisting `email → created` (locally, never exported) would add
  "registered per month" to the Institutions tab and a domain filter to
  registrations in Compare.
- Per-tile "data through" stamps on the overview (the line covers sources,
  not tiles).
- Build Tailwind to a static stylesheet instead of shipping the Play-CDN JIT
  compiler (a likely GPU-load contributor); then drop `unsafe-eval` from the CSP.
- Release the two large SURGhub blobs from renderer memory when their views
  close, or move derivations into a worker.
- Keychain-backed storage (`safeStorage`) for the LearnWorlds and Anthropic
  credentials.
- Version history for the Sheets backup (dated tab per push or a monthly
  export).

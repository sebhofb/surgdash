# SURGdash roadmap

Working list of what to build next. Keep entries short; link to code when a
decision is made. Items move to `js/whatsnew.js` when they ship.

## Done — August 2026 hardening pass

From the security / stability review of 12 Aug 2026:

- Preload filesystem bridge is path-guarded (reads: `$HOME`, tmp, data dir, app
  bundle, dialog-picked files; writes: `$HOME`, tmp, data dir, dialog-picked
  folders / save paths; recursive delete refuses root directories).
- Role passwords are salted PBKDF2-SHA256 records and excluded from the Sheets
  push; legacy unsalted hashes upgrade themselves on the next successful login.
- Renderer-wide error capture (`js/errors.js`): uncaught errors and unhandled
  rejections → console, a throttled toast, and a rolling
  `settings/error_log.json`. Former empty `catch {}` blocks route through the
  throttled `__swallowed()` sink.
- Pre-sync backup covers every `surghub/*.json` (completion + anon_users
  included), hard-linking unchanged files so it costs little disk.
- KPI tiles state their unit; the dashboard shows a "Data through" freshness
  line per source and flags one trailing the others by more than 7 days.

## Later — new features

### Institution and cohort view
Group learners by email domain (and, where known, organisation) and surface the
largest cohorts per month. Flag any domain exceeding ~15% of a month's
registrations or certificates. Motivation: in June 2026 a single institutional
rollout (`seha.ae`, 3,898 accounts, ~3,150 nurses) produced 47% of the month's
certificates and half the year's nursing growth, and nothing in the app showed
it. Should feed the period comparison below so "with / without cohort X" is one
click.

### Period comparison
A dashboard panel that takes two date ranges and reports, side by side: new
registrations, courses started, certificates, learners enrolling, certificates
per enrolment, survey volume and satisfaction, plus reach shares (income group,
Lancet-priority, conflict settings, cadre, gender) in both flow (activity in
the window) and stock (cumulative at window end) terms, with per-day rates.
Everything the Aug 2026 director summary needed was hand-built in Node; this
makes it repeatable and keeps the methodology consistent. Should also compute a
true cohort completion rate (each started enrolment tracked to its outcome)
alongside the existing certificates ÷ enrolments ratio.

### Anomaly flags
Cheap checks, shown as a small "worth a look" strip on the overview:
- one email domain, course or country dominating a month (see cohort view);
- a data source older than its siblings (already partly covered by the
  "Data through" line — extend to per-tile stamps);
- a KPI moving more than ~2σ against its trailing 12-month distribution;
- a month with certificates but no enrolments (or vice versa) — a sync gap.

### Persist UI state
Remember per-device view preferences across restarts: the partial-month
toggle, chart width / trim settings, selected dashboard tab, top-N selectors,
country pickers on the growth charts. Store under `settings/ui_state.json`
(no storage key → never pushed to Sheets).

### Email-domain hygiene
Detect near-miss domain typos at import and in the learner table (`seha.e`,
`seha.ar`, `seha.a`, `seha.se` were all present for `seha.ae`), suggest the
canonical domain, and count them in the cohort view. Optionally warn before a
send list is exported.

## Also noted in the review, not yet scheduled

- Honour the LearnWorlds `Retry-After` header in `_apiGet` (the comment claims
  it; the code uses fixed 2/4/8 s backoff).
- Investigate whether the LearnWorlds API exposes per-user enrolment
  timestamps, to remove the dependency on the manual User-Progress xlsx.
- Tighten the CSP now that libraries are vendored (drop the unused CDN hosts;
  `unsafe-eval` goes once Tailwind is built to a static stylesheet).
- Build Tailwind to a static stylesheet instead of shipping the Play-CDN JIT
  compiler (a likely GPU-load contributor).
- Targeted chart redraws instead of full `renderView()` on toggle changes.
- Release the two large SURGhub blobs from renderer memory when their views
  close, or move derivations into a worker.
- Rename "Sync Everything" or make it prompt for the card-2 upload when that
  source is older than the others.
- One `normaliseCountry()` shared by the income classifier and the conflict
  list (the two currently carry separate alias tables).
- Explain `surgdash_pending_submissions` being absent from the storage
  reverse map, or add it.
- Keychain-backed storage (`safeStorage`) for the LearnWorlds and Anthropic
  credentials.
- Version history for the Sheets backup (dated tab per push or a monthly
  export).

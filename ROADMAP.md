# SURGdash roadmap

Working list of what to build next. Keep entries short; link to code when a
decision is made. Items move to `js/whatsnew.js` when they ship.

## Done — QA forms carry the real objectives, and the language (16 September 2026)

Seb's pass over the first forms:

- **Learning objectives come from the course page, not the description.** Every SURGhub
  course publishes them as an `<h2>Learning Objectives</h2>` followed by a list; the API
  carries none of it. `_coursePageFacts` reads that list, and the description's own
  objectives section is now only the fallback. "Event objectives" carries the summary and
  the objectives together, which is what UNITAR asked for; the objectives also keep their
  own row.
- **Language is filled automatically.** The page prints "Language: **English**" as a meta
  pill, so there is nothing to detect — it is read, not guessed.
- Removed the "a typical participant spent about N minutes" aside from "Content and
  structure"; "Additional Information" is now deliberately empty; the focal point is
  Michaela DORCIKOVA <Michaela.DORCIKOVA@unitar.org>.
- A GSF-run course is no longer described as being "in partnership with" the Global
  Surgery Foundation.

The course-summary sync therefore fetches two things per course: the API description and
the rendered page. A page that will not load costs that course its objectives and its
language, never the run.

## Done — UNITAR's annual QA form, and the course text behind it (16 September 2026)

- **`js/courseDetails.js`** fetches each course's summary from LearnWorlds
  (`/courses/{id}`) into `surghub_course_details`, mapped both ways so the prose travels
  with the numbers. Paced at 1.2 s a course, because this API has bitten us before. The
  public link is built from the course id (`surghub.org/course/<id>`, verified 200): the
  URL already on the course record is a *survey* link, not a page anyone can open.
- **`js/qaForm.js`** fills UNITAR's own Word form, all 20 rows, for a year you pick.
  Their .docx is a zip, so it is the same surgery as the spreadsheet with one addition:
  Word deflates its parts, so the one part we edit is inflated first
  (`DecompressionStream`), and everything is written back STORED — a legal zip, and no
  deflate implementation to own. Every other part, including the customXml Word cares
  about, goes back byte-for-byte.
  - **Word splits labels across runs** wherever the author paused typing, so the document
    really says "Mode of d elivery" and "Learning o bjectives". Matching on letters and
    digits alone is the only reliable way to find a row; matching on words filled 10 of 20.
  - **Left blank on purpose:** language and focal point (the app holds neither), and
    learning objectives unless the course's own description states them — UNITAR's own
    filled example leaves that row blank too. The toast names what it left for a person.
- **The EMS sheet stays anonymous.** Surname, first name and email are left empty; the
  data is in the completion store if UNITAR ever refuses the upload without them. Only
  the completion certificate is reported: a learner either earned it or did not, and
  there is no lesser certificate to report in the participation column.

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

## Done — the UNITAR report becomes UNITAR's own template (16 September 2026)

- **The report IS their EMS workbook.** `templates/unitar_ems_template.xls` ships with the
  app; the export reads it, fills the "Participants" sheet from row 2, leaves "Default
  Values" untouched and adds "SURGhub summary" in front. The code lists (gender 1-5,
  nationality ISO2, affiliation ACM/GOVN/…) are read from their own Default Values sheet at
  export time, so a template update brings its codes with it.
- **It carries personal data, and that is unavoidable.** Their template marks Surname,
  Firstname and Email required, so the anonymised list cannot satisfy it. Both entry points
  confirm before writing, the summary says so on its face, and the Methodology page will
  need to follow. Verified against Essential Burn Care: all six required columns filled for
  7,496 of 7,496 rows. Roughly a sixth of learners register a single word as their name;
  that word goes in both name columns, since both are required and inventing a surname is
  worse. Learners with no enrolment record have no name or email and leave those blank.
  Where a learner stated nothing, UNITAR's own "Unreported" codes (gender 5, nationality
  UN, affiliation UNR) fill the required column.
- **Full logo.** `build/gsf_logo_full.png`, cropped from the letterhead, replaces the
  emblem, and `_unitarAddLogo({firstOnly:true})` keeps it on our summary only — UNITAR's
  sheets must ship exactly as they came, headers and row heights included.
- **Summary**: the title is bold, and it is signed "Prepared with SURGdash (c) the Global
  Surgery Foundation".
- **Private courses classify themselves.** LearnWorlds already marks each course free (146),
  private (75) or draft (37); private and draft are private by default. The stored value is
  now an OVERRIDE map holding only the exceptions, so a course that changes on the platform
  follows it. The tick is on the course page and in the Directory.
- **Not done: the QA form.** See "Next" below.

## Done — UNITAR reports: simpler still, branded, and private courses (16 September 2026)

- **Summary trimmed again.** "Started the course" is gone from the totals (still counted
  for the app, and still a column on the participant sheet). The "Data through <today>"
  line read as a contradiction beside a 2025 period, so it is folded into one line:
  *Enrolments counted — 2025*, or *All time, up to 11 September 2026* when the window is
  open-ended. Dates are written out in words.
- **The GSF logo sits at the top of both sheets.** SheetJS's community build cannot place
  an image, so `_unitarAddLogo` adds the picture parts to the finished .xlsx: SheetJS
  writes every entry STORED, so the container can be unzipped and rewritten without any
  inflate/deflate step (`_unitarUnzip` / `_unitarZip`, CRC32 included). It also writes the
  spacer rows' heights, because the community build emits neither blank rows nor row
  heights and the logo would otherwise sit on the first line of text. Every unexpected
  case returns the original bytes untouched — a compressed archive, a worksheet that
  already owns relationships, a missing logo, any exception. A report without a logo beats
  a report Excel refuses to open. Verified by rendering the real file (`qlmanage`).
- **Private courses.** `surghub_private_courses` (a list of course names, mapped in both
  directions in storage.js so it travels with the data, not one laptop). A toggle on the
  course page marks in-country workshops and other closed cohorts; the batch dialog has an
  "Include private courses" checkbox, off by default, and the confirmation says how many
  were skipped or included. The single-course run has no toggle: opening that course is the
  decision.

## Done — UNITAR reports simplified, with a period and a launch month (15 September 2026)

Seb's verdict on the first cut: too complicated. Reworked the same afternoon.

- **One enrolment number.** The report gives the participants it lists and nothing else.
  The platform's own course total runs a little higher on most courses; printing both,
  with an explanation, raised a question nobody needed answered. The difference is on the
  Methodology page. Every figure in the file now reconciles with the participant sheet.
- **Certificates only.** "Completed the course" matched the certificate count to within a
  handful and answered the same question. Gone from both sheets.
- **Two data columns per block**: `# participants` and `% participants`. The stated counts
  are spread over every participant so each block sums to the total, one note on the
  summary says so, and each block states how many people stated the field. The four-column
  two-base layout is gone.
- **The method sheet is gone.** Its content is a section on the app's Methodology page
  (`_unitarMethodologyHtml`, defined in `unitarExport.js` beside the code it describes and
  rendered by ui.js, so the two cannot drift). The launch thresholds quoted there are read
  from the constants; a test asserts it.
- **Reporting period**, for the single run and the batch: a year button or any range of
  months, selecting on **enrolment date**. This was the reported bug — the batch had no
  filter at all, so it returned everyone. Learners whose enrolment date the platform never
  recorded cannot be placed in a window, so a period excludes them and the count is kept.
  The period appears on the summary and in the file name.
- **Course launched.** LearnWorlds' creation date is not the launch: courses sit private
  for reviewers for months. The month is read from the enrolment curve — the first month
  with at least 10 enrolments, at least 4x the average of the months before it, and not
  dwarfed by the months after. Validated across the catalogue: fires on 140 of 215
  courses, median pre-release tail 4 months; the rest fall back to the first enrolment
  month and the sheet says which. Burn Care: created Sep 2024, launched Oct 2024.
  Surgical Foundations: created Feb 2023, launched Jun 2023 after 21 reviewer enrolments.

## Done — UNITAR course reports (15 September 2026)

UNITAR uploads each course to its reporting system as an "event" with its participants
attached, so the unit is one course, one Excel file. `js/unitarExport.js`:
`App.exportUnitarCourseReport(course)` from the course page, and
`App.exportAllUnitarCourseReports()` for a folder of them from Data Sync.

Three sheets. **Summary**: the totals, then a block per dimension (country with ISO
codes, career stage, gender, organisation type, profession) giving participants, % of
those recorded, % of all records, and an estimate for the full enrolment.
**Participants**: one anonymised row each, with the exact enrolment, start, completion
and certificate dates joined from the enrolment records. **Method and assumptions**:
prose, not footnotes.

**Two gaps, reported separately, because they are different things.**
1. *Enrolments with no participant record.* The demographic file is short of the
   platform's own enrolment count on 169 of 218 courses (126 learners, 1.7%, on
   Essential Burn Care). The enrolment total is the platform figure; the difference is
   printed on the summary and explained on the method sheet.
2. *Fields blank for a participant we do hold.* Gender and organisation type come only
   from the sign-up survey, never from the API. Platform-wide: country 82.5%, career
   stage 79.4%, profession 70.4%, gender 70.4%, organisation type 66.8%. Per course it
   swings widely, so the gap is recomputed and printed per file.

**The estimate** applies the recorded shares to the full enrolment, allocated by largest
remainder so each estimated column sums exactly to the enrolment total. The method sheet
says in plain words that this assumes non-responders resemble responders, that it is a
projection rather than a count, and that it is least reliable where the recorded share is
lowest.

**Privacy.** No name, no email, no cross-course identifier: participant numbers restart at
1 in every file. Professions are folded through `Taxonomy.canonProf` (the raw tags carry
`nurse` and `nursing` separately, 17 tags to 11 cadres). The method sheet counts
categories below five participants and warns that, in a small course, one of those plus
the other columns can point to an individual. Courses switched off in the Directory are
skipped by the batch run.

## Done — a silent SURGfund mis-count, found and fixed (11 September 2026, evening)

KPI-log entries are stored with `Date.toString()` ("Fri Sep 04 2026 16:12:39 GMT+0200
…"), so `String(timestamp).slice(0, 10)` yielded "Fri Sep 04" — a string that matches no
ISO window. `digest.js` had counted SURGfund KPI edits that way since it was written, so
**every weekly digest reported zero edits**; the week of 4–10 Sep really had two, on
Nakuru OSS. Dates now go through `_digestDayOf`, which accepts an ISO prefix or anything
`Date` can parse and returns a local ISO day; an unparseable stamp is ignored rather than
guessed at. Regression test in `test/digest.test.js`.

**Rule this leaves behind:** never slice a stored stamp. Project events and updates are
ISO on disk; KPI logs and update ids are not.

Also: `deleteProject` now removes a project's actuals and quarter comments (it used to
leave an empty `actuals.json` behind for every deleted project). Version 2.1.2.

**Not kept:** a start-up Home screen (`js/home.js`, one page of totals / this week /
attention / SURGfund, routed as a pseudo-project) was built the same evening and removed
the same week — Seb did not want the app to open on a cover page. It is in the history at
`b9f18c7` if the idea ever comes back; the mis-count above is what it was worth finding.

## Done — 2.1.1 shipped; the sync-key split-brain fixed (11 September 2026, evening)

- Rotating the key failed with "unauthorised" although the app held the key it
  had just set: the script had accepted a rotation whose reply was lost, and the
  client's blind retry carried the superseded key, so the server ended up with a
  key the app did not know. Now `set_key` is replay-safe (a `newKey` that is
  already current answers OK), `?meta=1&k=…` reports `keyOk`,
  `SheetsSync.setKey` never retries blindly but asks whether the new key took
  (success only when the script is secured and accepts it), and the Settings key
  row explains the recovery (copy the `syncKey` Script Property into `URL#k=…`,
  or delete it and click Secure this Sheet again). `npm test` = 223 checks; a
  piped `tail` had once hidden a failing exit code from CI — the runner's exit
  code is what CI sees now.
- Release 2.1.1 was published directly (no draft any more) at 14:30 UTC;
  `latest-mac.yml` resolves to 2.1.1, so installed apps update themselves on
  their next launch.
- Recovery completed on Seb's Mac: replay-safe script deployed (meta reports
  `keyOk`), Sheet secured with a fresh key (the one that had been pasted into a
  chat is void), a full Sync to Sheets rewrote the tabs; a keyed read returns
  the 8 real projects and no junk; the start-up cleanup removed the 3 junk
  projects and 14 junk activities.
- `Projects.deleteProject` now also removes a project's actuals and quarter
  comments — it had left an empty `actuals.json` behind for every deleted
  project (the start-up cleanup relies on it).
- The sidebar version badge no longer has a hardcoded fallback (it read v2.0.8
  since that release when preload could not report the version); it shows the
  reported version or nothing.

## Done — after a damaged copy of the Apps Script (11 September 2026, evening)

The v4 script was pasted via a `.txt` opened in TextEdit, which re-encoded every
non-ASCII character (the em dash came back as `‚Äî`, the emoji tab names likewise).
The deployed script therefore no longer recognised its own tabs: `doGet` returned
`📊 Organisation`, `📋 SURGhub` and `📋 SURGdash Backup` as projects, and its
activity parser, whose year-band marker had been mangled, turned band rows and
the "No activities logged yet." placeholder into activities — a pull then wrote
three junk projects and two junk activities per project into the local store. Fixes:

- `scripts/google-apps-script.js` is **pure ASCII** now (non-ASCII in code as
  `\uXXXX` escapes, identical at runtime; a test asserts it) — no copy path can
  damage it again. Its parser only accepts tabs with a PROJECT INFO section and
  only activity rows that start with an ISO date (the placeholder row used to
  become an activity even with a correct script).
- `SheetsSync.isReservedTabName`: pulls drop such names, pushes refuse them (a
  project named `📋 SURGhub` would have overwritten the blob's tab).
- `Projects.purgeSheetArtifacts()` at start-up: removes reserved-name projects
  and activities without an ISO date; a toast reports what it removed.
- Recovery on Seb's Mac: restart (cleanup runs) → Copy Script from the app (never
  via TextEdit) → redeploy → Sync to Sheets (rewrites every tab; any mojibake-
  named tabs are deleted as non-project tabs).

## Done — the tests live in the repo; release 2.1.0 prepared (11 September 2026)

- `npm test` runs ten fixture-based suites (`test/*.test.js`, 214 checks, ~70 s, no
  network, no app data); `npm run test:live` adds three suites that read this
  Mac's SURGdash data folder and are skipped when it is absent. `test/run.js`
  sums the PASS/FAIL lines and exits non-zero on any failure;
  `.github/workflows/test.yml` runs `npm test` on every push to `main`. The
  previous Apps Script is pinned as `test/fixtures/google-apps-script-v2.js`.
  Tests are excluded from the app bundle (`build.files`). The ambassador-bridge
  harness was tied to one day's live numbers and was not committed — a
  fixture-based version is a follow-up.
- Version 2.1.0 with a What's New entry covering everything since 2.0.13.

## Done — the endpoint is secured, the nightly run publishes, and a weekly digest (11 September 2026)

Seb's picks from the "next level" list. Three builds, each with its own harness:

- **Sync key (Apps Script v4, `SCRIPT_VERSION = 4`).** "Access: Anyone" meant
  anyone holding the URL could read every learner record and overwrite the Sheet.
  Once a key is set (`type:'set_key'` — allowed while none exists, rotation needs
  the current key; Script Property `syncKey`), every GET (`?k=`) and POST (body
  `k`) must carry it; `?meta=1` stays open and reports `secured`. The app keeps
  the key device-local (`surgdash_sheets_key`, never pushed/exported) and hands it
  to colleagues inside the share link they already paste (`…/exec#k=KEY`); both
  URL fields parse that form. Settings → Google Sheets shows the state with
  Secure this Sheet / Copy share link / Rotate key. An unauthorised answer is
  fatal, never retried, and says what to paste. Legacy scripts ignore the key.
  Needs one redeploy, then "Secure this Sheet", then the new share link to
  colleagues (`test_sheets_sync.js`, 55 checks).
- **Publish to Sheets after the nightly sync.** The push got a UI-free core
  (`GenericViews._sheetsPushRun`) shared with the button. A new background step
  (checkbox on the panel, off by default) pushes after the cards; a device that
  auto-pulls (a viewer) never publishes; unchanged parts cost nothing
  (`test_bgsync.js`, 37 checks).
- **Weekly digest (`js/digest.js`).** What moved in the last seven full days
  versus the seven before: courses opened / enrolments / certificates by their
  exact dates, new accounts and logins from the hashed account index, top courses
  and providers, courses new on the platform, ambassador referrals (delta against
  the previous digest's snapshot), SURGfund KPI edits and activities, and the data
  health that produced the numbers. Generated by the background sync on the chosen
  weekday (caught up later in the week if the app was closed; once per ISO week)
  or by hand; stored device-locally (`surgdash_digest`); panel on the Data Sync
  page with Copy text / Email… (mailto) / Write narrative. The narrative is
  Claude (`claude-opus-4-8`) writing from the digest's JSON only, with a
  numbers-only instruction, labelled AI-written (`test_digest.js`, 24 checks).
- Still open from the list: commit the harnesses as `npm test` + a GitHub Action;
  release (44+ commits since v2.0.13); cohort tracker, forecast, automated
  provider/donor reporting, multi-editor backend.

## Done — toasts moved to the bottom-right corner (11 September 2026)

`App.showMsg` / `showUndo` toasts were anchored top-right, over the view tabs and
the buttons at the right end of that bar. One shared `_toastContainer()` now
anchors them bottom-right (bottom-left belongs to the What's New card), newest at
the bottom, sliding up into place.

## Done — dashboard tab bar fits again (11 September 2026)

Thirteen tabs ran off the right edge and broke mid-label. The bar is now a
full-width wrapping flex row; pills are `whitespace-nowrap` and a little tighter;
the long names are shortened (Conflict, Physicians, Nurses, Compare, Journeys,
Lookup) with the full name as a tooltip; Data Health and Learner lookup sit in a
right-aligned tools group behind a divider. Tab keys are unchanged, so the
remembered tab (uiState) and the HTML-snapshot tab list still work.
`test_dash_pills.js` evaluates the pill block straight from ui.js.
Second pass the same day: the two tools left the bar altogether — **Learner
lookup** is a section at the foot of the Directory page (edit-only,
`data-no-export`), **Data health** a section on the Data Sync page above the
Danger Zone (computed from `getAnalyticsSnap()` + `_dashAudSnap()`). Eleven
analysis tabs remain; `_dashTabKey()` maps a remembered `health`/`lookup` tab
back to the overview. Note: Data Sync is locked for viewers when an edit
password is set, so Data health is now an editor's view.

## Done — Google Sheets sync rebuilt: compressed, fingerprinted, retried (11 September 2026)

Seb: "It is slow, and sometimes fails for the SURGfund part … can this be much much
faster?" Measured on the live data: the SURGhub blob is 150 MB across 23 keys, sent
as 36 sequential 4.4 MB uploads (3,208 cells); every project tab rewritten with
60–120 Sheets calls each push; one attempt per request with a 90 s cap; a failed
SURGhub part fell back to embedding all 150 MB in one request (never succeeds);
pulls made the script parse 150 MB server-side. New transport `js/sheetsSync.js`
(plain functions with injected I/O) + Apps Script v3 (`scripts/google-apps-script.js`,
`SCRIPT_VERSION = 3`, needs ONE redeploy — the app detects the version via
`?meta=1` and uses the old protocol against an old deployment):

- **Compression**: the blob is gzip-compressed in the app (10.7× smaller on the live
  data: 150 MB → 14 MB → 18.7 MB base64), stored as opaque text with the `SDGZ1:`
  prefix — 5 uploads and 400 cells instead of 36 and 3,208; the script never parses
  it, the app inflates on pull (`fetchMirror`). Legacy plain-JSON blobs still read.
- **Fingerprints**: SHA-256 per project payload (clock stamp blanked), for the org
  summary (over the project hashes) and for the blob; the script stores them in
  Script Properties and returns them in `?meta`; an item whose fingerprint the
  server already holds is skipped. A SURGfund-only edit pushes that tab + org +
  backup; a day without an API sync pushes no SURGhub bytes at all. `force` pushes
  everything.
- **Reliability**: 3 attempts with 5 s / 15 s waits for transient failures (network,
  timeout, HTML error pages, "failed while accessing document"); a script error
  such as the 50,000-char cell limit is not retried. SURGhub parts carry
  `startRow`/`totalRows`, so a retry overwrites the same rows; the blob's
  fingerprint is advertised only once the last part landed, and a blob with fewer
  rows than expected is not served. Against a legacy script parts get one attempt
  (a retry would duplicate rows) and the doomed fallback is gone — the error says
  nothing was lost locally.
- **Pulls**: `pullPlan` skips the SURGhub download when the server's fingerprint
  equals the one this device last pushed or pulled (`googleSheetsSurghubHash`), or
  when a silent pull would not apply it anyway (local ahead → keeps the dirty
  protection). Silent pulls stay quiet.
- **Batched tab writes** in the script (`_block`): a project tab is written with one
  `setValues` + format grids + header merges — about a third of the calls, values
  and formats byte-identical to the per-row writer (parity-tested against the
  previous script from git).
- Verified with 36 checks (`test_sheets_sync.js`): the real v3 and previous scripts
  run in a VM against an in-memory Sheets model; the client protocol runs against
  them end-to-end (push, skip, edit-one, retry-a-part, legacy, pull decisions).
- Verified live after Seb redeployed (11 Sep 11:21): `?meta=1` → version 3, 8 project
  fingerprints, org + SURGhub fingerprints equal to this device's; the full pull
  returned a 15.3 MB packed blob that inflates to 112 MB and is byte-identical to
  the local files for all 22 pushed keys. That check also exposed a pre-existing
  gap: `surghub_survey_raw` (the raw feedback-survey responses, 151 courses) had its
  reverse key-map entry in the wrong branch of `storage.js relativeToKey`, so
  `Storage.keys()` never listed it — it was missing from every Sheets push, local
  JSON backup, restore and wipe. Fixed (`test_storage_keys.js`); the next push
  adds ~1.7 MB compressed and viewers get survey responses on their next pull.
- Not done (deliberately): per-key SURGhub deltas (the nightly sync rewrites the
  big keys anyway), parallel part uploads (5 parts are fast enough; concurrency on
  one sheet is a risk), Drive-file transport (new scope, 50 MB blob limit).

## Done — after the first full night on the new sync: three follow-ups (11 September 2026)

Checked Seb's Sync Everything of 11 Sep 09:14 against the receipts and the run
record: every stage completed, the listing was reused from card 3, 129 accounts
and 18 certificate pages fetched in 9 minutes with no refusal, fetch times now
cover all 63,615 accounts (12,652 credited to the full pass), 13 new
certificates. Three things were still wrong and are fixed here:

- **Routine certificate refusals were treated as the penalty box.** The
  `/certificates` endpoint answers 429 + Retry-After 10 when pages come
  < ~10 s apart; last night's 3-day full walk (246 pages) took 2 h 17 min
  instead of ~45 min because each such refusal got a ≥ 60 s hold, doubling.
  Now a Retry-After ≤ `ENR_ROUTINE_429_S` (15 s) is waited out exactly (+1 s),
  the certificate gap widens 250 ms per refusal (`_enrCertGapMs`, ≤ 15 s), and
  only `ENR_ROUTINE_429_MAX` (8) such refusals within 5 min on OTHER endpoints
  read as the penalty box. Counted as `pauses`, not `rateLimits`.
- **"1,451 from the receipt" was a re-merge, not a recovery.** The harvest
  skipped only the previous run's processed ids, so every new run re-merged the
  accounts of every receipt still on disk. `_enrParseReceipt(dir, skipIds,
  savedAt)` now also skips a capture at or before the account's saved fetch
  time (`meta.fetchedAt`); "from the receipt" again means recovered captures.
- **The nightly job would have redone cards 3 and 2 today.** `_bgDue` treats a
  hand-run sync as today's run when every enabled card's `surgdash_sync_log`
  stamp is today's; `_bgTick` loads the stamps if not cached.
- Not a bug: card 3's "63,526 learners" vs the listing's 63,615 accounts — the
  89 have no parseable sign-up date or one before May 2023 and are skipped by
  the demographics count. The provenance strip's one ▲ ("Growth-timeline
  coverage 219/220") is `pen-programme-en`: 2 learners, no growth timeline yet
  because the growth-timeline pull dates from 14 June — run "Sync Growth
  Timelines" (30–60 min) when convenient; it affects only that course's
  2 learners in the Platform-Growth trend.
- Checks: `test_enr_ratelimit.js` 19, `test_enr_fast.js` 13,
  `test_enr_parallel.js` 14, `test_bgsync.js` 30.

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

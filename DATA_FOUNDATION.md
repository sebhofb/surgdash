# SURGdash — Data Foundation

*How SURGdash's numbers are sourced, derived, kept accurate, backed up, and kept private — and how to refresh them before a reporting round.*

This is the **source-of-truth guide**. If you maintain or operate SURGdash — or you need to trust a number it produced — read this. It is written so someone other than the original author can run a clean reporting round and know the figures are correct.

> Companion docs: **`BACKUP.md`** (machine-level backup setup). In-app, the **Data Sync** page and the **Data Health → "Re-derive from raw"** panel are the operational surfaces this guide describes.

---

## 1. If you only read one thing

1. **Before any provider/board reporting round, refresh the data** via the **Data Sync** page, cards **1 → 2 → 3 → 4 in order** (see §4).
2. **Then open Data Health and click "Verify against raw."** Every line should be **●** (reproduces). If anything is **▲**, investigate before trusting that figure (see §6).
3. **Push to the cloud** ("Sync to Sheets") if colleagues need the update — pushing is **manual and deliberate** (see §8). Pulling is automatic and safe.
4. Your data lives in **`~/Documents/SURGdash/`** and survives reinstalls. Make sure that folder is backed up (Time Machine / iCloud) — see `BACKUP.md`.

Everything below is the "why" and the detail.

---

## 2. Architecture in one picture

```
  LearnWorlds API ─┐
  Manual uploads  ─┤→  RAW CAPTURE          →  DERIVED SNAPSHOTS        →  DASHBOARD · PDF · Web report · Ask-data
  (xlsx / CSV)    ─┘    (surghub/raw/*,          (surghub/data.json,         (all four RE-DERIVE the same
                        receipts, PII-bearing)    history.json, etc.)          headline numbers — see §7)
                              │                         │
                              └──── FIREWALL ───────────┘
                                  "re-derive from raw" proves the snapshots
                                  reproduce from the receipts (§6)
```

**Two principles hold the foundation together:**

- **Raw-capture + re-derive.** Syncs/uploads write the raw payloads to `surghub/raw/…` receipts, *and* a derived snapshot. The firewall re-runs the live aggregation over the receipts and checks it reproduces the snapshot — so on-screen numbers are **traceable to source**, not just trusted.
- **Single derivation, many surfaces.** The dashboard, the PDF report, the web (dark) report, and Ask-data each compute the headline metrics independently. They are kept in lock-step by **shared resolvers and documented invariants** (§7). If you add a fifth surface, route it through the same resolvers.

**Storage is local-first.** All data is individual JSON files under `~/Documents/SURGdash/` (`os.homedir()/Documents/SURGdash`), written atomically (write `.tmp` → rename), **not** in the app bundle — so it survives restart, app upgrade, and reinstall. (`js/storage.js`.)

---

## 3. Where everything lives on disk

```
~/Documents/SURGdash/
├── projects/{id}/{targets,actuals,events,updates,facilities,budget,kpi}.json   ← SURGfund project data
├── projects/{comments_|log_|quarter_comments_}{id}/kpi.json
├── other/surgdash_quality_data_{id}.json
├── other/anthropic_api_key.json            ← SECRET (never exported, see §7.8)
├── settings/learnworlds_api_token.json     ← SECRET
├── surghub/data.json                       ← derived course snapshot (the platform numbers)
├── surghub/history.json                    ← audience snapshots over time (users, country/profession stats)
├── surghub/anon_users.json   (~31 MB)      ← anonymized per-learner records  (PII-adjacent, local only)
├── surghub/completion.json   (~37 MB)      ← per-learner course/cert/minutes  (PII-bearing, local only)
├── surghub/raw/{label}__{stamp}/…          ← RAW CAPTURE RECEIPTS (PII-bearing, NEVER exported)
├── backups/                                ← auto pre-pull / pre-restore / pre-sync snapshots
└── settings/*.json
```

Two large blobs (`anon_users`, `completion`) are **lazy-loaded** after first paint, so cold start is fast; some panels (Performance tab, certain awards) populate a moment later. (`App.ensureAnonLoaded` / `ensureCompletionLoaded`.)

---

## 4. The pre-reporting refresh ritual

Open **Data Sync**. The page header says: *"Keep SURGdash in step with LearnWorlds. The numbered cards below are ordered — follow them top to bottom before a reporting round."* The built-in **"What to sync, when"** checklist is the short version; this is the annotated version.

**Routine (weekly / after course changes):** click **"Sync Everything"** (~10–15 min) — runs *Sync Courses* + *Sync Learners & Ambassadors* back-to-back, one summary at the end.

**Before every reporting round, run cards 1 → 2 → 3 → 4 in order:**

| # | Card | What it does | Why it matters |
|---|------|--------------|----------------|
| **1** | **Sync Courses** (~5 min, API) | Course-level metrics: learners, certificates, learning time, success rate, providers. | **Self-healing**: distrusts analytics zeros (the endpoint sometimes reports `students:0` for live courses), never lets a 0 overwrite a positive, repairs zeros from timeline record counts, clamps timelines to course launch dates. |
| **2** | **Upload User Progress xlsx** | Per-user progress export (one sheet per course; Course Start Date / Completion Date / Time spent). | **The only source of exact per-course enrolment dates** — the public API has none (course-user records carry only the account `created` date). Rebuilds ~230 course timelines with exact dates. Source: `surghub.org/author/userprogress` (filter *registered before tomorrow*) → Export → Reports log; or the saved segment `usersegments?segmentId=18`. |
| **3** | **Sync Learners & Ambassadors** (API) | Audience demographics (country/profession/career/topic) + ambassador referrals. Includes the **"Upload Signup Survey"** sub-step. | The **Signup Survey** upload is the **only** source of **gender + organisation type** — these are not in user tags or `/v2/users` (see §5). Upload retro-enriches stored records in place; coverage only grows across uploads. |
| **4** | **Sync Surveys** (paste token) | Course survey responses + ratings + the "new knowledge / intent to apply" impact stats. | **Not part of "Sync Everything"** — the survey token expires, so this one always needs a fresh paste. |
| 5 | **Growth Timelines** (optional; API is slow / hours, has a stall-skip guard) | Refreshes timeline tails for courses *not* covered by the card-2 upload. | Card 1 re-applies the exact (`src:'completion'`) timelines over API approximations afterward. Usually unnecessary if card 2 was run. |

Also occasionally: the **Course Insights overview export** (Product insights → Export courses report, one row per course) can be uploaded via the card-2 slot to reconcile Learners/Certificates against LearnWorlds' official totals (auto-detected; it has no start dates).

After refreshing → **Data Health → Verify against raw** (§6) → then export report packages / push to Sheets.

---

## 5. Data sources & the authority hierarchy

When two sources disagree about the same number, trust them **in this order** (highest first):

1. **Per-user progress summary export** (card 2) — exact dates *and* counts.
2. **Course Insights overview export** — LearnWorlds' official per-course totals.
3. **API record counts** (`/courses/{id}/users`, `/certificates`) — reliable counts, no enrolment dates.
4. **Analytics endpoint** — least trusted (emits spurious zeros; card 1 zero-guards it).

Specific source-of-truth facts:

- **Enrolment / start dates** → only the card-2 per-user summary. Without it, growth curves use signup dates clamped to the course launch month (documented as *approximate* in every methodology page; totals stay exact).
- **Gender & organisation type** → only the **Signup Survey** upload (qualification form, assessment `63a17c13afb16c5d17036164`). The form's export endpoint returns HTTP 500 on the synchronous path, so there is no API auto-fetch — it is a deliberate manual upload. Staleness only widens the "Not declared" bucket; aggregates stay robust. (See the `project-signup-survey` note for the full why.)
- **Learning time per course** → the API-enriched `LearningMinutes`, falling back to anonymized `course_minutes` when null (a freshly-synced course has `LearningMinutes = null`). This fallback is applied **everywhere** via one resolver (§7.1).
- **Countries** → per-course **`CountryStats`** (from Growth Timelines), with the anonymized-user CSV only as a fallback when `CountryStats` is absent (§7.4).
- **Registered users vs learners** → these are **different populations** (§7.5). Registered users = accounts (sign-ups); learners = course enrolments (one user enrols in many courses, so learners ≫ users).

---

## 6. The re-derive firewall ("Data Health")

**What it is.** A read-only provenance check. It re-runs the *exact* live aggregation over the captured raw receipts and diffs the result against the stored snapshot. On-screen title: **"Re-derive from raw (provenance check)"** — *"Re-runs the live aggregation over the captured raw and checks the numbers reproduce — proof your figures are traceable to the receipts."*

**How to run it.** Click **"Verify against raw"** (becomes **"Re-check"** after the first run). It also runs **automatically after every sync** and shouts if a number that *used* to reproduce stops reproducing (a regression alert).

**How to read it** — each check renders one of:

| Symbol | Meaning | Action |
|--------|---------|--------|
| **●** (green) | Reproduces from the receipts exactly | Trust it. |
| **▲** (amber) | **Differs** from the receipts | **Investigate before reporting this figure.** Usually: re-run the relevant sync, or a receipt was pruned (see below). |
| **○** (slate) | No receipt captured yet | Run the sync that captures it (e.g. a fresh *Sync Ambassadors* re-captures the ambassador receipt). |

The header shows **"N / N reproduce exactly."** The suite spans **course metrics** (learners / certificates / learning time across published courses), **demographics** (users, country, profession, gender, org-type), **ambassadors** (active / leads / clicks), and **growth-timeline consistency** (coverage + freshness). Receipts are kept **per-type, last 3** — so the latest of each kind always survives a burst of syncs.

**Growth-timeline check nuance:** it is a *consistency* check (there's no growth-timeline receipt, since that sync is usually skipped). It flags **shape staleness** — when courses gained learners without a fresh month bucket, so the curve understates recent growth while the headline total stays correct. ▲ here means "re-upload the user-progress file or run Growth Timelines."

If a check is ▲ and you can't explain it, **do not publish that number** — that is exactly what the firewall is for.

---

## 7. Derivation invariants — the source-of-truth contract

These are the rules every surface (dashboard, PDF, web report, Ask-data) must obey so the same metric reads the same everywhere. **If you add or change a derivation, conform to these.** (Established/expanded during the June 2026 cross-surface consistency audit.)

### 7.1 Learning time → one resolver
`App.courseLearningMinutes(d, map)` (ui.js) = `d.LearningMinutes ?? anonymized course_minutes`. **Every** learning-minute sum and per-course display routes through it: platform card, provider card, course card, provider table, the "Most Learning Time" award, the PDF and web report totals, and the Ask-data pack. Result: per-course rows always sum to the totals.
*Exception:* the firewall verifiers read the **raw** stored `LearningMinutes` (no fallback) — they audit storage against receipts, so a display fallback would defeat them.

### 7.2 Certificate rate → one formatter
`App.formatCertRate(cert, lrn, {asNumber})` (ui.js) = 1-decimal `%` string, or `–` when there are no learners (`{asNumber:true}` → number or `null`). Used by all cards, the All-Courses table, and Ask-data. Never print `0%` for a zero-learner course — print `–`.

### 7.3 Included-only vs platform basis
- **Platform TOTALS** (learners / certificates / learning hours) sum `getPlatformSnap()` — *including* active-but-private/excluded courses.
- **COUNTS** of courses & providers, and any **listing**, use `getAnalyticsSnap()` — included-only.
- **Any per-provider or per-course figure** uses the included-only basis (so a provider's bar matches that provider's own page). Only the single platform headline may use the platform basis — and it won't equal the sum of visible providers (documented in the methodology).

### 7.4 Countries → CountryStats-first
Derive countries from per-course **`CountryStats`** (the Growth-Timelines canonical source); fall back to the anonymized-user CSV only when `CountryStats` is absent. Applied on the dashboard *and* in the reports so all three agree.

### 7.5 Registered users ≠ learners
- **Registered users** (accounts / sign-ups): `demographics.registeredUsers` (total), `timeSeries.registeredUsersByMonth` (cumulative), `signupsByMonth` (monthly-new).
- **Learners / enrolments**: `platform.totalLearners`, `timeSeries.platformByMonth`.
- A user enrols in many courses, so **learners ≫ registered users**. "Registered-user growth" must use the registered series, never the learner series. **Ambassador referrals are registered users** (sign-ups via `referrer_id`), so "ambassador share of user growth" compares referrals to *registered-user* growth.

### 7.6 Course identity = slug
`window.courseKey(d) = d.CourseId || d.Course` (slug-first, title-fallback for legacy rows); `window.courseMatches(d, key)` matches either. Dedup, inclusion toggles, and detail lookups use these — so a course and a same-named clone stay separate, and excluding one slug never hits another. A `CourseId`-less orphan sharing a title with a real course is dropped from snapshots (`_dropOrphanDupes`).

### 7.7 Audience snapshot = newest row
`userHistory` is appended oldest-first, so `[0]` is the **oldest**. Always select the snapshot with the **max Timestamp** for "current" audience figures (dashboard, platform story, and Ask-data all do this).

### 7.8 Ambassador attribution = the complete bridge
`App.buildReferrerBridgeFromRaw()` joins raw `/users` `referrer_id` → affiliate-roster names → per-ambassador downstream reach + learner outcomes (courses/certs/minutes), persisted to `surghub_referrer_bridge` (names + counts only, **no emails**). The table, the "Most Referrals" award, and Ask-data's `topReferrers` all use this complete reach when built (else the partial synced lead counts). It is a true breakdown of the headline "Attributable Referrals."

### 7.9 PII withholding everywhere
Ambassador display names are sometimes emails. **Every** ambassador surface (table, awards, scatter, re-engagement panel, Ask-data) withholds names containing `@`. Keep this when adding any name-keyed ambassador view.

---

## 8. PII & data-egress map — what leaves the laptop

| Data | Stays local only | Leaves the laptop |
|------|:---:|:---:|
| API credentials (`anthropic_api_key`, `learnworlds_api_token`) | ✅ never exported (`SECRET_KEYS`) | — |
| `surghub/raw/` receipts (hold emails + `referrer_id`) | ✅ `storage.js keys()` skips `surghub/raw` | — |
| Learner emails (`completion.json`, `anon_users` email fields) | ✅ | — never in shareable exports/snapshots |
| `surghub_referrer_bridge` (names + counts only) | — | ✅ pushed to Sheets — so it **must stay PII-free** |
| Course/audience aggregates, project KPIs | — | ✅ Sheets push + exports |
| The Anthropic Ask-data payload | — | aggregates only; `@`-form names filtered out before send |

**Hard rules:** credentials never reach Sheets/exports. Learner emails never reach a shareable export. `surghub/raw/` is never pushed. The Sheets backup (`_syncToSheets`) *does* carry the email-bearing demographic/completion files as **Seb's private full backup** — there is no "no emails to Sheets" rule; the real rules are *credentials-never* and *anonymized-exports-email-free*. Anything new that is keyed by a person must be checked against this table.

---

## 9. Backup, sync & multi-user

- **Local store is the live source** and survives reinstall. Plaintext secrets live in it, so a folder copy carries them — keep copies private.
- **Sheets push is MANUAL** ("Sync to Sheets" / *"Push all projects + org summary to Google Sheets"*). It is a single **overwriting** mirror — **no version history**, and it omits `surghub/raw/` — so **it is not a complete backup.** The real safety net is a **folder-level backup** (Time Machine / iCloud Documents / scheduled copy) — see `BACKUP.md`.
- **Sheets pull is AUTOMATIC** (launch + every 5 min) and **safe**: it skips overwriting any project (or the SURGhub blob) that has **unsynced local edits** (`surghub_unsynced_local` sentinel + per-project mtime check). When you have local changes, the unsynced banner shows — *"You have unsynced changes — colleagues won't see them until you push to the cloud."* — push when ready. Manual Pull still prompts before overwriting.
- **Restore**: the history/clock control → local backup browser restores a pre-pull / pre-restore / pre-sync snapshot, taking a blocking safety snapshot first (never destroys without a rollback). Retention: pre-pull keep 20, pre-restore keep 10.
- **Multi-user reality**: safe for **one editor + many viewers** (keep the edit-lock on for others; teammates pull once via onboarding). **Not** safe for concurrent editors — last-sync-wins, no field-level merge. Until there's a real backend: **only one person edits.**

---

## 10. Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| A course shows 0 learners but has certificates | analytics endpoint zero, or stale snapshot | Re-run **Sync Courses** (self-heals) or upload the **overview export**. |
| Growth curve starts before the course launched | no per-user summary for that course | Upload the **User Progress xlsx** (card 2) — gives exact dates. |
| Gender / org-type mostly "Not declared" | signup survey not refreshed | Run **Upload Signup Survey** (card 3). |
| Ambassador checks show **○** | ambassador receipt pruned by a sync burst | Run **Sync Learners & Ambassadors** to re-capture it. |
| A firewall line shows **▲** | snapshot no longer reproduces from receipts | Re-run the relevant sync; if it persists, don't publish that figure until explained. |
| "Most Learning Time" / learning-hours look low | timeline shape stale, or `LearningMinutes` not enriched | Upload User Progress xlsx; the anon fallback (§7.1) covers un-enriched courses. |
| Colleague doesn't see your update | you haven't pushed | Click **Sync to Sheets** (push is manual). |
| Numbers differ between dashboard and a report | a surface bypassed a resolver/invariant (§7) | Route it through `courseLearningMinutes` / `formatCertRate` and the §7 basis rules. |
| App won't start / slow / offline errors | network stall on a remote lib | Libs are vendored locally; only Google Charts loads remotely and degrades gracefully. Check the console. |

---

## 11. Glossary

- **Enrolled Learners** (app) / **learners** (dark export) — course **enrolments**. One registered user produces many, so this exceeds Registered Users. ("Learners" is kept in the dark export and compact table headers where it's course/provider-scoped and reads as people.)
- **Registered Users** — distinct SURGhub accounts (sign-ups). The smaller, headcount population.
- **Referral / attributable referral** — a registered user who signed up via an ambassador (`referrer_id`).
- **Reach** (ambassador) — distinct learners an ambassador referred; the complete bridge metric behind "Referrals."
- **Included vs excluded course** — excluding hides a course from listings/reports but it still counts toward platform totals.
- **Receipt** — a raw API/upload payload saved under `surghub/raw/` so a number can be re-derived and proven.
- **Resolver / invariant** — the shared functions and rules (§7) that keep every surface consistent.
- **The firewall** — the "re-derive from raw" provenance check (§6).

---

*Maintainers: the detailed change history and rationale for each invariant lives in the project memory notes (`project-data-foundation`, `project-data-refresh`, `project-sync-backup`, `project-signup-survey`). Keep this doc in sync when a derivation rule changes.*

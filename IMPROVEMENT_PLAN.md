# SURGdash improvement plan

_3 November 2026. Based on a review of the code and of screenshots of all 41 main screens (taken with `npm run screens` on a copy of the live data), measured against the Global Surgery Foundation Design System (the organisation's default design system)._

---

## In short

**What already works.** SURGdash does a great deal, and its numbers are well guarded: every sync is checked against the raw data (Data health), 1,140 automated checks run on every change, data is backed up, and learners' personal details are scrubbed from what providers receive. The problems are about finding things, understanding them, and trusting that the app is up to date.

**What changed today (phase 0, done).** The app now looks like a GSF app:
- Arial throughout, with real Arial Black headings.
- The GSF blues, with gold used only for emphasis.
- The official white GSF emblem in the sidebar and on the start screen.
- White pages and calm cards.
- Readable grey text everywhere: every grey now passes the accessibility contrast standard.
- GSF-style banners, tabs, KPI tiles and notifications.
- GSF colours in the charts.
- No rainbow, dashed or gradient cards.

See "Phase 0" below for the full list and what is left.

**The ten biggest problems, in users' terms**

1. **Too many places to look.** SURGhub has 9 top tabs and 14 more tabs inside its Dashboard, with no search. Testimonials (a publishing tool) sits among the analysis tabs, and exports are scattered over page headers.
2. **Updating data is a chore, and it is hard to tell whether the data is current.** The Data Sync page asks people to "run cards 1 → 2 → 3 → 4 in order". Seven different banners can appear at the top, several at once. Only the SURGhub dashboard shows a "Data from …" date, and nothing says whether that is up to date or stale.
3. **Constant pop-ups.** 224 `alert()` and 58 `confirm()` dialogs interrupt work, some of them with long technical text.
4. **Silent failures.** 271 places swallow errors without telling anyone. Recent bugs were all found by users, not by the app: a publish that kept failing because of a cached reply, charts that moved when "Include Nov" was ticked, and a list that crashed when nothing had been published.
5. **Numbers that are easy to misread.** The tile labelled "Enrolled learners" counts course enrolments, not people. Estimates (demographics scaled up, "Conflict settings: accounts (estimate)") look exactly like exact figures. Definitions hide in hover tooltips.
6. **Small, faint text.** 670 labels are set at 8 to 11 px, below the design system's 12 px minimum. Phase 0 fixed the faintness but not the size.
7. **Exports follow an older look.** Reports, web exports and the showcase use their own dark "editorial" style, the Inter font and older colours, not the GSF design system.
8. **Off-brand text.** 375 emoji and symbol "icons" (✓ ⚠ ★ ✗ ▲ ● ↻ ✨ 🥇), Title Case buttons, long em-dash sentences, and developer words such as "drama mode", "receipts", "snapshot" and "pull".
9. **SURGfund project content out of step with GSF's strategy.** Four "programme areas" (maternal health, trauma, children's surgery and cancer care), where GSF has two programmes: the Women's Health Programme and the Children's Surgery Programme.
10. **Slow start, fragile offline.** Every library loads at start-up, including two Excel libraries. The stylesheet is compiled while the app opens, and charts depend on Google's servers, so they do not draw without internet access.

**What happens next:** quick wins this week (pop-ups, symbols, a freshness bar, one "include current month" switch per page), then a simpler structure and a single "Update data" flow over the following four to six weeks. Details below.

---

## Principles

- **One design language: the GSF design system.** Tokens, type and components come from the design system and live in shared code, never in copied class strings.
- **One obvious way to do each task.** Every screen answers one question. Each task has one place and one button, and its name says what it does.
- **No silent failures.** If something did not work, the person who asked for it is told in plain words, with what to do next. Background problems go to a log anyone can read.
- **Always show how fresh the data is.** Every figure carries its date and whether it is exact or an estimate.
- **Change shared pieces, check every screen.** Run `npm test` and `npm run screens` before and after each change, and keep the numbers that must not move under test.

---

## Phase 0: the GSF look (done, 3 November 2026)

Applied centrally, so every view inherits it without being rewritten:

| Area | Change | Where |
|---|---|---|
| Colours | Every Tailwind colour family the views use now resolves to design-system values:<br>• slate becomes blue-tinted neutrals, all text shades at 4.9:1 or more on white<br>• blue, sky, indigo, violet and purple become the primary blues<br>• amber becomes gold, with text shades darkened to pass<br>• emerald and green mean success; red and rose mean error; orange stays orange<br>`gsf-boston` is now strong blue #0468B1 (was #4389C8) and `gsf-crimson` is #CF2525.<br>About 4,000 class uses follow automatically. | `index.html` Tailwind config |
| Type | Arial everywhere. A font alias maps the weights to the real faces, so headings and big figures use real Arial Black. The Inter web font is gone. | `index.html` |
| Tokens and shared patterns | Design-system tokens (colour roles, radius 9 px, blue-tinted shadows, motion).<br>Shared patterns restyled:<br>• cards: white with a hairline; no dashed, rainbow or left-border cards<br>• buttons: no press movement<br>• focus ring: dark blue inside, gold outside<br>• inputs: blue border and gold ring on focus<br>• tables, scrollbars and the eyebrow label<br>• page titles in strong blue Arial Black<br>• reduced motion respected | `index.html` `#gsf-design-system` |
| Brand | Official white GSF emblem in the sidebar and on the start screen, uncropped. Sidebar on navy with readable labels in light blue and white, and no gradients. | `index.html`, `js/ui.js` `renderSidebar` |
| Navigation | Active tab in strong blue (the old gold underline failed contrast). The tab bar fits at 1440 px. | `js/ui.js` `renderTabBar` |
| KPI tiles | SURGhub, provider and course tiles: one style, figure in strong blue Arial Black, readable labels, no rainbow rails. | `js/ui.js` |
| Headline cards | Organisation and project cards: white cards, figures in strong blue, and a gold "Goal for 2026" tag on targets, so a goal is never mistaken for a result. | `js/genericViews.js` |
| Banners | Gold with dark-blue text (unsynced changes, new data, reporting mode), navy for read-only, blue for set-up and sample. Plain wording and sentence-case buttons. | `index.html` |
| Notifications | GSF toasts: navy for done, gold for "look at this", red for errors, each with an icon (emoji stripped). Errors stay on screen longer. | `js/app.js` `showMsg`, `showUndo` |
| Charts | GSF palette (strong blue, dark blue, light blue, orange, gold, then the tertiary colours) and readable axis text. | `js/charts.js` |
| Tooling | `npm run screens`: screenshots of all 41 main screens on a copy of the data, with no credentials and no network. | `scripts/capture/` |

**Left for later, on purpose:**
- **Hard-coded colours:** about 2,200 hard-coded hex colours inside views, especially per-project and per-KPI colours and the economic-impact cards.
- **Exports:** the exported reports, partner dashboards and showcase (decision 1 below).
- **Emoji and symbols** inside view text (H1).
- **Tiny text sizes** (G1).
- **Title Case** labels (H2).

These come later because each needs per-view edits and a screenshot check.

**Acceptance:** `npm test` passes (1,140 checks). `npm run screens` shows all 41 screens drawing without errors in the new look. No figure changed, because only styles were touched.

---

## Roadmap

Priority: **P0** now, **P1** next 4 to 6 weeks, **P2** later. Effort: S (under half a day), M (1 to 3 days), L (a week), XL (more).

### A. Navigation and structure (P1)

| Id | Problem | Change | Effort |
|---|---|---|---|
| A1 | 14 Dashboard sub-tabs in two wrapping rows (01-hub-overview) | Group them into five sections with a second-level bar:<br>• **Overview** (Overview, Quarterly)<br>• **Reach** (Learners, Geography, Conflict, Physicians, Nurses, Institutions)<br>• **Quality** (Performance, Feedback, Forum)<br>• **Trends** (Compare, Journeys)<br>Remember the last one. | M |
| A2 | Publishing tools are mixed into analysis (Testimonials tab; Publish buttons in several headers) | A "Website and sharing" area for website figures, course feed, testimonials (with hand-added ones), partner dashboards and milestones. | M |
| A3 | No way to jump to a provider, course or country | A search box (⌘K) over providers, courses, projects, countries and tabs, plus breadcrumbs (SURGhub › Provider › Course) on detail pages. | M |
| A5 | The tab bar overflows below about 1300 px (08-narrow-1100) | Move the overflow into a "More" menu. | S |

### B. Clarity of numbers (P1)

| Id | Problem | Change | Effort |
|---|---|---|---|
| B1 | Labels and definitions differ between tiles, exports and the Methodology tab | One metric registry (id, label, definition, source, freshness, exact or estimate) used by tiles, tooltips, exports and Methodology. | L |
| B2 | Definitions only on hover; estimates look exact | A standard KPI tile: label, figure, unit line, "as of" date, an info button that opens the definition, and an "estimate" tag where scaled. | M |
| B3 | Every chart has its own "Include Nov (partial)", S/M/L and "Trim y-axis (drama mode)" | One "Include the current month" switch per page. Chart size and zoom go into a small "…" menu. | M |
| B4 | Forecasts sit beside results | Label projections as projections (design-system rule) and set them visibly apart. | S |
| B5 | "Enrolled learners" counts enrolments | Rename to "Course enrolments" and "Registered learners" (see decision 4). | S |

### C. Updating data and freshness (P0/P1)

| Id | Problem | Change | Effort |
|---|---|---|---|
| C1 | Data Sync is a numbered manual (03-hub-upload) | One **Update data** button and a checklist panel: each step's state, time taken, and what still needs a person (the user-progress upload, the survey token). | L |
| C2 | Only the SURGhub dashboard shows a data date, and it never says "stale" | A freshness bar under every page title: "Data from 2 Nov, 09:25. Up to date." It turns gold when stale and links to Update data. | S (P0) |
| C3 | Up to seven stacked banners | One status area: a compact chip that opens a panel listing each message. | M |
| C4 | A new colleague's first launch | Guided set-up (paste the share link, get the data, done) and empty states that say what to do. | M |

### D. Dependability (P0/P1)

| Id | Problem | Change | Effort |
|---|---|---|---|
| D1 | 224 `alert()` and 58 `confirm()` pop-ups | A design-system dialog and the new toasts. Long messages open in a panel with "Copy details". Start with the 20 most frequent. | M (P0 for the top 20) |
| D2 | 271 silently swallowed errors | Send them to a readable activity log. User-started actions always end in a visible result. A "Report a problem" button saves the log, without personal data. | M |
| D3 | Long operations lack progress or cancel (forum read, enrolment sync, publishing, PDF exports) | One progress panel with cancel and resume, reused by every long task. | M |
| D4 | Visual bugs reach users | Run `npm run screens` before and after every UI change (done), then add a side-by-side comparison page. | S |
| D5 | Cached or slow network replies | Every GET to GitHub, Sheets and LearnWorlds bypasses caches (done for GitHub, 2 Nov). Use the same timeouts and retries everywhere, and show a clear offline notice. | S |
| D6 | A damaged data file at start-up | Keep the last good copy, open with it, and say so. | M |
| D7 | No tests of the screens themselves | A smoke test that draws every view in the harness and fails on any error. | M |

### E. Reports and sharing (P2)

| Id | Problem | Change | Effort |
|---|---|---|---|
| E1 | Export buttons scattered and named differently | One "Share and export" menu on every page: PDF report, Web page, Excel data, Shareable file. | M |
| E2 | Exports use the old dark editorial look and Inter | Move exports to the design system: a navy hero cover, white pages, Arial, and GSF colours and logo rules (decision 1). | L |
| E3 | Publishing goes straight out | A preview of what will change (figures, courses, testimonials) before it goes online, from one place (A2). | M |
| E4 | Internal and external outputs look alike | Mark every export "internal" or "for sharing", and keep internal figures out of shareable ones (house style). | S |

### F. Organisation and SURGfund projects (P2)

| Id | Problem | Change | Effort |
|---|---|---|---|
| F1 | Four programme areas (maternal health, trauma, children's surgery, cancer care) | Align with the two GSF programmes: the Women's Health Programme, with maternal health as its entry point, and the Children's Surgery Programme (decision 3). | M |
| F2 | Dense overview controls (years, Sample, HCW multiplier, Sheets) | Put secondary options behind "View options". | S |
| F3 | KPI names in Title Case ("Reached with Improved Surgical Care") | Sentence case, written once in `Projects.STANDARD_KPIS`. | S |
| F4 | Data-entry save states are shown mainly by colour (amber, grey, green, red cells) | Text states ("Saving…", "Saved", "Not saved: try again") and inline checks. | M |

### G. Accessibility (P1)

| Id | Problem | Change | Effort |
|---|---|---|---|
| G1 | 670 labels at 8 to 11 px | A 12 px floor for labels and 11 px only for dense tables, done view by view with screenshot checks. | M |
| G2 | Tooltips are hover-only `title` text | Focusable info buttons. | M |
| G3 | Tabs, pills and dialogs not fully keyboard-friendly | Arrow keys in tab bars, Escape closes dialogs, focus stays inside dialogs. | M |
| G4 | Tiny icon buttons (▲ ▼ reorder, copy, close) | At least 24 px targets and an `aria-label` on every icon-only button. | S |

### H. Copy and terminology (P0/P1)

| Id | Problem | Change | Effort |
|---|---|---|---|
| H1 | 375 emoji and symbol icons in view text | Lucide icons (design system). Start with the dashboard, Data Sync and Testimonials. | M (P0 for main screens) |
| H2 | Title Case, em dashes and exclamation marks in UI text | Sentence case for headings, tabs and buttons. Commas, colons or full stops instead of dashes (about 1,700 em dashes in the code, many in comments). British English. | M |
| H3 | Developer words on screen | Replace them using a short glossary (decision 4):<br>• "Sync Everything" → "Update all data"<br>• "Pull now" → "Update now"<br>• "drama mode" → "Zoom to the data"<br>• "Snapshot" → "Shareable file"<br>• "receipts" → "saved API replies"<br>• "Conflict settings" → "Conflict-affected countries" | S |

### I. Speed and structure (P2)

| Id | Problem | Change | Effort |
|---|---|---|---|
| I1 | Tailwind is compiled while the app opens (console warns against it) | Compile the stylesheet when the app is built. Faster start, and the CSP can drop `unsafe-eval`. | M |
| I2 | Every library loads at start, including two Excel builds | Load Leaflet, PDF, Excel and html2canvas only when used, and keep one Excel library. | M |
| I3 | Charts need Google's servers | Ship the chart library with the app, or move to Chart.js as planned in `UI_REFRESH_NOTES.md`, styled from the design system. | L |
| I4 | `js/genericViews.js` (15,266 lines) and `js/ui.js` (6,183 lines) | Split by view. Shared design-system helpers (Button, Card, Tile, Tag, Tabs, Dialog, Toast) in one module, so the brand lives in code rather than in copied class strings. | XL |

### J. Security and privacy (P2)

| Id | Problem | Change | Effort |
|---|---|---|---|
| J1 | Learner lookup is already edit-only (`js/lookup.js`); other screens that show learner names or emails have not been checked the same way | Check every screen that can show a learner's name or email (Directory lists, feedback, forum quotes), and apply the same edit-only rule where needed. | S |
| J2 | Passwords are screen locks (hashes ship in `js/app.js`) | Say so in Settings, and never rely on them to protect personal data. | S |
| J3 | `preload.js` allows writes anywhere under the home folder | Limit writes to the data folder and paths picked in a dialog. | S |
| J4 | CSP allows `unsafe-eval` | Remove it once I1 is done. | S |

---

## Sequence

- **Now (this week):** phase 0 (done), then:
  - C2: freshness bar
  - D1: the 20 most frequent pop-ups become dialogs and toasts
  - H1: symbols on the main screens
  - B3: one "include current month" switch per page
  - A5: "More" menu for the tab bar
  - H3: glossary
- **Next (4 to 6 weeks):** A1 to A3, B1, B2, B4, B5, C1, C3, C4, D2, D3, D5, D7, G1 to G4, H2.
- **Later:** E1 to E4, F1 to F4, I1 to I4, J1 to J4.

## Risks and how they are kept small

- **Numbers must not move.** Style and structure changes never touch the calculations. `npm test` and Data health are checked after every step.
- **Screens break unseen.** `npm run screens` before and after each change, compared screen by screen. D7 then makes it automatic.
- **Exports reuse app styles.** The PDF, html2canvas and HTML exports are checked separately for each E item.
- **Big files.** I4 is done last and in small pieces, with the shared helpers introduced first.

## Decisions for you

1. **Exported reports.** Move them to the design system: a navy hero cover, white pages and Arial. _Recommended._ The alternative is to keep the dark editorial style.
2. **Page background.** Phase 0 uses white, the design system's default. _Recommended:_ keep white. A very light blue tint is the alternative.
3. **Programme areas in SURGfund projects.** Align them with the two GSF programmes. _Recommended._ Trauma and cancer remain clinical needs but are not programmes.
4. **Labels.** Use "Registered learners" (was "Registered users") and "Course enrolments" (was "Enrolled learners"), plus the glossary in H3. _Recommended._
5. **Dashboard structure.** Five sections instead of 14 sub-tabs (A1). _Recommended._

## Appendix: measurements (3 November 2026)

| Measure | Count |
|---|---|
| Native `alert()` / `confirm()` | 224 / 58 |
| Silently swallowed errors (`__swallowed`) | 271 |
| Emoji and symbol icons in view code | 375 (✓ 119, ⚠ 80, ★ 33, ✗ 24, ▲ 13, ● 12, ↻ 8, ✨ 7, …) |
| Labels at 8 to 11 px | 670 |
| Hard-coded hex colours in `js/` | about 2,200 uses, 229 distinct |
| Colour-class uses now mapped to the design system | slate 3,078; amber 404; emerald 228; red 133; rose 56; sky 55; purple 45; green 44; blue 33; `gsf-*` about 1,350 |
| Largest modules | `js/genericViews.js` 15,266 lines; `js/ui.js` 6,183 |
| Automated checks | 1,140, all passing |

# SURGdash — UI Refresh notes & future upgrades

_Last updated: 13 Jun 2026_

This document records (a) what the **2026-Q2 UI refresh** changed, and (b) a backlog
of **suggested upgrades for a future iteration** that go beyond that mandate.

---

## A. What the refresh changed (this pass)

Goal: a modern, clearly‑GSF, consistent, user‑friendly look applied to **every page** —
without touching how data is loaded or stored. Approach: change the few **shared seams**
so the new language cascades app‑wide, rather than editing 20+ views by hand.

**Design principles applied**
- One design language, two zones: a dark **prussian chrome** (sidebar, with a polo‑blue
  active rail) and a light **content surface** with a warm **gold** highlight (the accent
  carried over from the dark export reports). Consistent‑by‑zone.
- Visual hierarchy & restraint: editorial **eyebrow** kickers (mono, uppercase, gold tick),
  **serif stat numbers** (Georgia, like the exports), one type scale, generous whitespace.
- Consistency: a single token set (`--gsf-*`, radii, shadows) and unified card / button /
  focus / scrollbar treatments.
- Accessibility: visible `:focus-visible` rings, larger hit areas on tabs.

**Where it lives**
- `index.html` → `<style id="gsf-design-system">`: tokens + component classes
  (`.gsf-eyebrow`, `.gsf-kpi`, `.gsf-stat`), and **measured global refinements** of the
  dominant patterns (`.rounded-xl.border.shadow-sm` cards, buttons, scrollbars, page bg,
  tab bar, sidebar active rail). Changing these restyles ~114 cards + every page at once.
- `js/ui.js` → `renderSidebar` (active rail), `renderTabBar`/`tab()` (gold active underline,
  taller tabs, eyebrow context label), KPI card markup (serif accent numbers).
- Removed the niche **"Copy all cards"** buttons from 4 page headers (per‑card click‑to‑copy
  remains) — the one redundancy that was safe to drop without losing capability.

**Data fixes shipped alongside**
- **Profession / Cadre** (Learners tab): raw tags are now **grouped into canonical cadres**
  (`_canonProf` / `_PROF_MAP`, mirrors `updater.js`) — Nursing, Anaesthesia, Surgeon,
  Emergency Medicine, Trainee/Resident, etc. — and **extrapolated to the full learner base**
  (scale = total users ÷ declared), matching the country/gender methodology.
- **Organisation Type** (cards + table): now **extrapolated** to the full base too.
- **Award PNG** (dark export): equal‑size boxes, content vertically centred, dynamic column
  count to fill the width, partial last row centred, long labels wrap instead of truncating.

---

## B. Future upgrades (beyond this mandate)

Roughly priority‑ordered within each theme. None are required; all are opt‑in.

### 1. Component consolidation (the redundancy clean‑up that needs real work)
The refresh deliberately **did not** rip out functional buttons (the brief said "don't break
anything"), but several headers are still busy. The proper fix is to build small reusable
controls, then route the existing actions through them:
- **Export menu** — replace the scattered PDF / Web / Excel / Snapshot / External buttons on
  the platform, provider, course, org and project headers with a single **"Export ▾"**
  dropdown. (Needs a tiny popover component; wiring is 1:1 to existing handlers.)
- **Links menu** — collapse the project dashboard's separate Google‑Sheet / GSF‑page /
  folder / extra‑links icon buttons into one **"Links ▾"**.
- **Feedback‑curation control** — the Score / Auto‑select / Summarize trio appears on both the
  Reports tab and provider pages; consolidate into one "Curate feedback" split‑button.
- **Org dashboard toolbar** (10+ buttons) — move secondary actions into an overflow menu.
- Extract the shared markup into `js/uiHelpers.js` (`makeCard`, `makeKpiCard`, `makeButton`,
  `makeSectionHeader`) so future restyles are a single edit instead of string‑search.

### 2. Navigation & information architecture
- **Command palette** (⌘K) to jump to any provider/course/project/tab — the registry is large.
- **Breadcrumbs** on provider/course detail pages (Hub › Provider › Course) with back‑nav.
- **Persist last view per project** so reopening a project lands where you left off.
- Collapsible sidebar (icon‑only) for smaller laptops; remember the collapsed state.
- A global **search** box in the sidebar header (providers, courses, countries, professions).

### 3. Optional full **dark mode** for the app
The exports are dark/editorial; some users may want the app to match. This is a *big* change
(100+ light‑themed Tailwind views) so it was out of scope here, but the new token layer makes
it feasible: introduce a `data-theme="dark"` switch that remaps the `--gsf-*`/surface tokens,
then migrate views off hard‑coded `bg-white`/`text-slate-*` to the tokens incrementally.

### 4. Charts & data viz polish  ← **biggest deferred item**
- **Modern bars (rounded + gradient) need a charting‑library migration.** The in‑app
  charts use **Google Charts** (`google.visualization`), which cannot do rounded bar
  corners or gradient fills — only flat solid colours. The dark export reports already
  use **Chart.js 4** (which supports both). To match the exports in‑app, migrate the
  bar/column/timeline charts from Google Charts to Chart.js: extract the export's
  `drawGrowth`/`drawRating`/`drawCourse` into a shared `js/chartjsCharts.js`, swap the
  chart `<div>`s for `<canvas>`, and reshape the data. This is a sizeable, higher‑risk
  refactor (many call sites: platform growth, provider/country/profession timelines,
  per‑question charts, ambassador charts) — deliberately deferred from the design pass
  so it can be done and tested carefully on its own. Leaflet maps stay as‑is.
- Once migrated: unify all charts behind one **theme config** (fonts, grid, tooltip,
  palette, rounded bars, gradients) matching the exports.
- Add the **reporting‑period marker band** (already in the dark report) to the in‑app
  growth charts too.
- Consistent empty/loading **skeletons** instead of blank panels while data resolves.
- Small **sparklines** on KPI cards (trend at a glance).

### 5. Insight features
- **Quarter‑over‑quarter deltas** on KPI cards (▲/▼ vs last quarter) using the history snapshots.
- A **"What changed since last sync"** digest on the dashboard.
- Saved **filter/segment presets** (e.g. "LMIC nurses") reused across tabs.
- **Cohort retention** view (signups → started → certified) per course/provider.
- Surface the **low‑coverage caveat** pattern (built for Wound Healing) anywhere demographic
  coverage is thin.

### 6. Accessibility & UX quality
- Audit colour contrast for WCAG AA (some slate‑400 labels on white are borderline).
- Full keyboard nav for tabs/menus (arrow keys, roving tabindex) + ARIA roles/labels.
- Honour `prefers-reduced-motion` for the fade/transition animations.
- Toast/inline confirmations for long actions (syncs, exports) with progress + cancel.

### 7. Performance & architecture
- The big render functions rebuild large HTML strings on every `renderView`. Consider
  memoising per‑view output keyed on data/lock state (the chrome already does a version of this).
- `genericViews.js` is ~13.7k lines — split by view into modules for maintainability.
- Lazy‑load heavy libraries (Leaflet, jsPDF, XLSX, html2canvas) only when a feature needs them
  — they currently all load on boot.
- Move the in‑app methodology/eligibility copy into a single source shared with the report so
  they never drift.

### 8. Profession/cadre grouping (data‑quality follow‑ups)
- `_PROF_MAP` is duplicated in `engagementAnalysis.js` and `updater.js`; extract to one shared
  module so the cadre taxonomy can't diverge.
- Add a tiny admin view listing **unmapped profession tags → "Other"** so the keyword map can
  be extended over time.

### 9. Branding & onboarding
- Replace the placeholder sidebar logo treatment with the official GSF mark + safe‑area rules.
- A short **"What's new"** changelog popover keyed to the app version.
- First‑run **guided tour** of the refreshed layout.

# SURGdash — Releasing & installing (Mac)

How to ship SURGdash to the team so they **install once and update automatically** forever after.

- **You** build a signed + notarized release and publish it to GitHub Releases.
- **The app** checks GitHub on launch and silently installs new versions.
- **Teammates** install the DMG once; after that they never download anything again.

Signing + notarization are unchanged from before (that's what makes the install warning-free). The only new piece is **auto-update via GitHub Releases**.

---

## A. One-time setup (you, once)

1. **Create the GitHub repo.** Make a repo named **`surgdash`** under your GitHub org or account. A **public** repo is simplest (no token ends up in the app, and the code holds no secrets — credentials live only on each user's machine).
   - Then open `package.json` → `build.publish` and replace **`REPLACE_WITH_GITHUB_OWNER`** with your GitHub owner (org or username). Fix `repo` too if you named it something other than `surgdash`.
   - Push this project to that repo.

2. **Install dependencies** (pulls in `electron-updater`):
   ```sh
   npm install
   ```

3. **Make sure your build machine has the signing + publishing credentials** as environment variables (same Apple ones you already used, plus a GitHub token):

   | Variable | What it is |
   |---|---|
   | `APPLE_ID` | your Apple Developer email |
   | `APPLE_TEAM_ID` | your 10-char Team ID |
   | `APPLE_APP_PASSWORD` | app-specific password from appleid.apple.com |
   | *(or)* `APPLE_KEYCHAIN_PROFILE` | a `notarytool store-credentials` profile name (instead of the three above) |
   | `GH_TOKEN` | a GitHub token with permission to create releases on the repo (classic: `repo` scope; fine-grained: **Contents: read & write** on the repo) |

   Your **"Developer ID Application"** certificate must be in your login keychain — electron-builder finds it automatically (or set `CSC_LINK` + `CSC_KEY_PASSWORD`).

---

## B. Each release (you)

1. **Bump the version** in `package.json` (e.g. `1.2.0` → `1.2.1`). Auto-update only fires when the published version is **higher** than what's installed — so always bump.
   Also update the **"What's new" changelog** in `js/whatsnew.js` (the `RELEASES` array, newest entry first) — the app shows it once per version, and a stale changelog is worse than none.

2. **Build, sign, notarize, and upload** in one command:
   ```sh
   npm run release
   ```
   This produces signed `arm64` + `x64` builds (`.dmg` for first install, `.zip` for auto-update, plus a `latest-mac.yml` manifest) and uploads them to a **draft** GitHub release. Takes a few minutes (notarization is the slow part).

3. **Publish the draft.** Go to the repo on GitHub → **Releases** → find the draft for this version → **Publish release**. Until you publish it, nobody updates — so this is your "go live" switch.

That's it. Open apps pick up the update within ~6 hours; newly opened apps within ~8 seconds of launch. Each user sees a small **"Update ready — Restart now / Later"** prompt; "Later" installs it silently on their next quit.

---

## C. First-time install (each teammate, once)

1. Open the latest release on GitHub (or you send them the `.dmg`) and download **`SURGdash-<version>-arm64.dmg`** (Apple-Silicon Macs) or the **`x64`** one (older Intel Macs). If unsure, arm64 covers M1/M2/M3/M4.
2. Open the DMG, drag **SURGdash** into **Applications**, and launch it. Because it's notarized, it opens with **no security warning**.
3. Done — they never download again. Future versions install themselves.

> Their data lives in `~/Documents/SURGdash/` and is untouched by updates (see `DATA_FOUNDATION.md` / `BACKUP.md`).

---

## D. Verify it works (first release)

1. Install version **N** on a test Mac from the DMG.
2. Ship version **N+1** (bump → `npm run release` → publish the draft).
3. Reopen the test app → within a few seconds you should get the **"Update ready"** prompt → Restart → it relaunches on N+1 (check the version in the app/About).

---

## E. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Build fails at notarization | Apple env vars missing/expired, or no internet. Re-check `APPLE_*`. |
| Upload fails ("not found"/401) | `GH_TOKEN` missing/insufficient, or `build.publish.owner`/`repo` still the placeholder. |
| Team never gets the update | The GitHub release is still a **draft** (publish it), or the version wasn't bumped higher, or the release is marked **pre-release** (don't). |
| "App is damaged / can't be opened" | The build wasn't signed/notarized (missing Developer ID cert or Apple creds). Auto-update also requires a signed build. |
| Update prompt never shows in dev | Expected — auto-update is disabled under `npm start`; it only runs in the packaged app. |
| Need to pause updates | Just don't publish the draft release; or delete a published release to stop it rolling out. |

---

## F. How it's wired (for maintainers)

- **`package.json` → `build.publish`**: GitHub provider (`owner`/`repo`). `build.mac.target` includes both `dmg` (install) and `zip` (the format macOS auto-update consumes). `npm run release` = `electron-builder --mac --publish always`.
- **`main.js` → `initAutoUpdate()`**: runs only when `app.isPackaged`; uses `electron-updater`'s `autoUpdater` to check after launch + every 6h, download in the background, prompt to restart on `update-downloaded`, and install on quit. All errors are swallowed so an offline/unreachable feed never disrupts the app.
- **`scripts/notarize.js`**: unchanged — Apple notarization in `afterSign`.
- A **public** repo means no GitHub token is embedded in the shipped app. If you ever make the repo **private**, the app will need a read-only token to fetch updates (set `"private": true` in `build.publish` and supply a token) — avoid this unless required, since the token would ship inside the app.

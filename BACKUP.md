# SURGdash — Backup & Recovery Guide

All your SURGdash data lives in **one folder on your laptop**:

```
~/Documents/SURGdash/
```

This folder holds everything — SURGfund project KPIs, the SURGhub learning data, settings, your API keys, and the automatic backups. It is **not** inside the app, so it survives app updates and even a full reinstall. The only off-device copy is whatever you've pushed to Google Sheets.

> ⚠️ **The Google Sheet is a backup, but not a complete one.** It's a *single, overwriting* copy (no version history — a bad push replaces the previous good one), and the `raw/` provenance receipts are never pushed. So a real, point-in-time backup of the whole folder is your actual safety net. Set up **one** of the options below.

---

## Recommended: Time Machine (Mac, automatic)

The simplest, most complete option. It snapshots your whole Mac (including `~/Documents/SURGdash`) hourly and keeps history you can roll back to.

1. Plug in an external drive (or have a network drive available).
2. **System Settings → General → Time Machine → Add Backup Disk** → pick the drive.
3. Leave "Back Up Automatically" on. Done.

To recover a file or the whole `SURGdash` folder later: open the `~/Documents` folder in Finder → click the Time Machine icon in the menu bar → **Browse Time Machine Backups** → step back to a date → restore.

---

## Alternative: iCloud Drive (automatic, off-site)

Puts `~/Documents` in iCloud so it's copied to Apple's servers and to your other Macs.

1. **System Settings → [your name] → iCloud → iCloud Drive → Options** → tick **Desktop & Documents Folders**.
2. `~/Documents/SURGdash` now syncs to iCloud automatically.

Notes: iCloud keeps ~30 days of file version history (right-click a file → *Revert To* on some file types), but it's primarily a *mirror*, not a deep archive — pair it with the in-app auto-backups (below) for point-in-time rollback. Also, the SURGhub data files are large (~75 MB total), so make sure you have iCloud storage headroom.

---

## Alternative: Manual / scheduled copy

If you don't want Time Machine or iCloud, periodically copy the folder somewhere safe (external drive, another cloud folder):

```bash
# One-off dated copy to an external drive:
cp -R ~/Documents/SURGdash "/Volumes/MyDrive/SURGdash_backup_$(date +%Y-%m-%d)"
```

Do this before any big change (a large sync, a wipe, or handing the laptop in).

---

## What's already protected inside the app

You don't have to rely only on folder backups — SURGdash protects itself too:

- **Auto-pull is safe.** On launch / every 5 min the app pulls the latest from Google Sheets, but it **skips any project you've edited locally but not yet synced** (and never touches unsynced SURGhub data). Your newer local edits are never silently overwritten — you'll see an "unsynced" banner reminding you to click **Sync** to push them.
- **Automatic backups before risky actions.** Before every cloud *pull* it snapshots your project data (`backups/pre-pull_*.json`), before every *sync* it snapshots the SURGhub headline data (`backups/presync_*/`), and before every *restore* it snapshots everything (`backups/pre-restore_*.json`).
- **One-click restore.** In the org dashboard header, the **clock/restore icon** (next to the backup/restore icons) opens *Restore from auto-backup* — browse those snapshots and roll back in one click. Your current data is saved first, so a restore is itself reversible.
- **Manual full backup.** The download icon saves a complete `SURGdash_backup_<date>.json` anywhere you choose — good before major changes or to hand a colleague a snapshot.

---

## Heads-up: your API keys are in this folder, in plain text

`~/Documents/SURGdash/other/anthropic_api_key.json` and `settings/learnworlds_api_token.json` are unencrypted. That's fine on your own machine, but:

- They are **excluded** from the Google Sheets push (they never leave your laptop).
- If you ever **share the folder, a Time Machine drive, or a manual copy** with someone, be aware those keys go with it. Rotate the keys if a copy leaves your control.

---

## For the team (future)

The Google Sheet model is safe for **one editor + many viewers**: you edit, teammates install the app, paste the shared Sheet URL once to pull everything, and thereafter see your updates. Keep the **edit lock** on for everyone else.

It is **not** safe for two people editing at the same time — there's no field-level merge, so concurrent editors would overwrite each other (last sync wins). Until/unless SURGdash moves to a real shared backend, keep the rule: **only one person edits; everyone else is view-only.**

#!/bin/bash
# Screenshots of every main screen (scripts/capture/steps.json) on a copy of this Mac's data.
# The copy leaves out backups, the raw API receipts and every credential (LearnWorlds, GitHub,
# Google Sheets sync key, Anthropic, passwords), and main.js closes the network, so the run
# can never sync, pull or publish.   npm run screens [-- <output folder>]
set -e
SRC="${SURGDASH_DATA:-$HOME/Library/Application Support/surgdash/data}"
DIR="${CAPTURE_DIR:-${TMPDIR:-/tmp}/surgdash-capture}"
OUT="${1:-$DIR/shots}"
mkdir -p "$DIR/userdata/data"
rsync -a --delete \
  --exclude 'backups/' --exclude 'surghub/raw/' \
  --exclude 'settings/learnworlds_*' --exclude 'settings/partner_dash_token.json' --exclude 'settings/sheets_key.json' \
  --exclude 'settings/edit_password.json' --exclude 'other/anthropic_api_key.json' --exclude 'other/surgdash_report_password.json' \
  "$SRC/" "$DIR/userdata/data/"
cd "$(dirname "$0")"
CAPTURE_DIR="$DIR" OUT="$OUT" ../../node_modules/.bin/electron main.js
echo "Screens saved in $OUT"

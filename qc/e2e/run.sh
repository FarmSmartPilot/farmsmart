#!/usr/bin/env bash
# Run the QC Playwright suite from web/ (uses web/node_modules). Usage: qc/e2e/run.sh [spec...] [playwright args]
cd "$(dirname "$0")/../../web" || exit 1
export NODE_PATH="$(pwd)/node_modules"
export PATH="/c/Program Files/nodejs:$PATH"
npx playwright test -c ../qc/e2e "$@"

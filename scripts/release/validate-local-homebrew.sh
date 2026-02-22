#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

cd "$REPO_ROOT"

npm run release:build

TARBALL_PATH="$(node -e 'const fs=require("fs"); const p=JSON.parse(fs.readFileSync("release/manifest.json","utf8")); process.stdout.write(p.tarballPath);')"
LOCAL_FORMULA_PATH="$REPO_ROOT/release/spark-talk.local.rb"

npm run release:formula -- --local-tarball "$TARBALL_PATH" --output "$LOCAL_FORMULA_PATH"

TAP_NAME="local/spark-test"
cleanup() {
  brew uninstall --formula spark-talk >/dev/null 2>&1 || true
  brew untap "$TAP_NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

brew uninstall --formula spark-talk >/dev/null 2>&1 || true
brew untap "$TAP_NAME" >/dev/null 2>&1 || true
brew tap-new --no-git "$TAP_NAME"
TAP_REPO="$(brew --repository "$TAP_NAME")"

mkdir -p "$TAP_REPO/Formula"
cp "$LOCAL_FORMULA_PATH" "$TAP_REPO/Formula/spark-talk.rb"

brew uninstall --formula spark-talk >/dev/null 2>&1 || true
brew install "$TAP_NAME/spark-talk"

spark --version

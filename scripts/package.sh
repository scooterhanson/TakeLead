#!/usr/bin/env bash
# Build TakeLead and bundle what a server needs into release/takelead-<version>.tar.gz
# Usage: npm run package            (app only)
#        npm run package -- --with-data   (also include data/: your database and guest photos)
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./package.json').version")
NAME="takelead-$VERSION"
STAGE="release/$NAME"

echo "Building…"
npm run build >/dev/null

rm -rf "$STAGE" "release/$NAME.tar.gz"
mkdir -p "$STAGE/src" "$STAGE/media" "$STAGE/scripts"

cp -R dist server deploy "$STAGE/"
cp -R src/shared "$STAGE/src/"
cp package.json package-lock.json tsconfig.json .env.example README.md DEPLOY.md "$STAGE/"
cp scripts/backup.ts scripts/make-demo-songs.ts "$STAGE/scripts/"
cp media/README.md "$STAGE/media/"
cp -R "media/Public Domain Demos" "$STAGE/media/"

if [[ "${1:-}" == "--with-data" ]]; then
  echo "Including data/ (database and guest photos)…"
  npx tsx scripts/backup.ts >/dev/null
  latest=$(ls -td backups/*/ | head -1)
  mkdir -p "$STAGE/data"
  cp -R "$latest"/* "$STAGE/data/"
fi

tar -czf "release/$NAME.tar.gz" -C release "$NAME"
rm -rf "$STAGE"
echo "Created release/$NAME.tar.gz ($(du -h "release/$NAME.tar.gz" | cut -f1))"

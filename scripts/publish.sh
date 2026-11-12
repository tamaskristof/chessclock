#!/usr/bin/env bash
# Builds the app and force-pushes dist/ as a single commit to the gh-pages branch.
set -euo pipefail

npm run build

src_rev=$(git rev-parse --short HEAD)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

cp -r dist/. "$tmp"/
touch "$tmp/.nojekyll"

cd "$tmp"
git init -q -b gh-pages
git add -A
git commit -qm "deploy: build of $src_rev"
git push -f "$(git -C "$OLDPWD" remote get-url origin)" gh-pages:gh-pages

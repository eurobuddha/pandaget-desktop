#!/usr/bin/env bash
# THE release command for PandaGet Desktop - all three platforms, every time (family rule).
# Unlike minimaCore Desktop / minimaDesk, PandaGet Desktop has NO separate update feed: it
# self-updates straight from the PandaApps catalog (apks.json), so this bumps the three catalog
# rows and nothing else.
#   1. the signed+notarized Mac DMG must exist (npm run dist:mac:signed)
#   2. tag v<ver> and push it: CI builds mac (unsigned), win (NSIS x64) and linux (AppImage x64)
#   3. wait for that CI run, refuse to go on if any platform failed
#   4. upload the LOCAL signed DMG alongside CI artifacts
#   5. bump the three PandaGet Desktop rows of the PandaApps catalog (../minima-core-apks) from the
#      release assets - publish-app.py downloads + hashes each, so a missing win/linux asset aborts;
#      commit + push (the catalog's pre-push hook runs check.py, which downloads and verifies every
#      binary including these three)
#   6. all three rows must be at <ver> or this script exits 1 and says so
# Usage: scripts/release-desktop.sh <ver> ["release notes"]
set -euo pipefail
cd "$(dirname "$0")/.."
VER="${1:?version, e.g. 0.1.3}"; NOTES="${2:-PandaGet Desktop $VER}"
REPO="eurobuddha/pandaget-desktop"
DMG="dist/PandaGet-$VER-arm64.dmg"
[ -f "$DMG" ] || { echo "no $DMG - build it first: npm run dist:mac:signed"; exit 1; }
xcrun stapler validate "$DMG" > /dev/null || { echo "$DMG is not notarized+stapled - refusing"; exit 1; }
[ "$(node -p "require('./package.json').version")" = "$VER" ] || { echo "package.json is not $VER"; exit 1; }
[ -z "$(git status --porcelain -- package.json main renderer scripts README.md .github build WINDOWS-SIGNING.md)" ] || { echo "uncommitted changes - commit first"; exit 1; }
echo "== tag v$VER"
if ! git rev-parse "v$VER" > /dev/null 2>&1; then git tag "v$VER"; fi
git push -q origin "v$VER" 2>&1 | grep -v "^WARNING" || true
echo "== waiting for CI (Build desktop: mac / win / linux)"
RUN=""
for i in $(seq 1 30); do
  RUN="$(gh run list -R "$REPO" --workflow desktop-build.yml --branch "v$VER" --limit 1 --json databaseId --jq '.[0].databaseId' 2>/dev/null || true)"
  [ -n "$RUN" ] && break; sleep 10
done
[ -n "$RUN" ] || { echo "CI run for v$VER did not appear"; exit 1; }
gh run watch "$RUN" -R "$REPO" --exit-status > /dev/null 2>&1 || {
  echo "CI run $RUN did not succeed on every platform:"; gh run view "$RUN" -R "$REPO" --json jobs --jq '.jobs[] | "  \(.name): \(.conclusion)"'; exit 1; }
gh run view "$RUN" -R "$REPO" --json jobs --jq '.jobs[] | "  \(.name): \(.conclusion)"'
# Keep the CI artifact and publish the notarized installer under its own immutable name.
SIGNED_DMG="${DMG%.dmg}-notarized.dmg"
if [ -e "$SIGNED_DMG" ]; then
  cmp -s "$DMG" "$SIGNED_DMG" || { echo "conflicting local signed artifact: $SIGNED_DMG"; exit 1; }
else
  cp -p "$DMG" "$SIGNED_DMG"
fi
DMG="$SIGNED_DMG"
SHA=$(shasum -a 256 "$DMG" | cut -d' ' -f1)
echo "== mac (signed DMG alongside CI artifacts)"
  REMOTE_SHA=$(gh api "repos/$REPO/releases/tags/v$VER" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(next((a.get("digest") or "unknown" for a in d["assets"] if a["name"]==sys.argv[1]), ""))' "$(basename "$DMG")")
  case "$REMOTE_SHA" in
    "") gh release upload "v$VER" "$DMG" -R "$REPO" ;;
    "sha256:$SHA") echo "identical notarized installer already published" ;;
    *) echo "conflicting published artifact; refusing to replace it"; exit 1 ;;
  esac
echo "== PandaApps catalog rows (PandaGet Desktop mac / win / linux)"
STORE="$(cd .. && pwd)/minima-core-apks"
[ -d "$STORE" ] || { echo "!! $STORE not found - update the three rows by hand (scripts/publish-app.py)"; exit 1; }
( cd "$STORE" && for pkg in com.eurobuddha.pandaget.desktop.mac com.eurobuddha.pandaget.desktop.win com.eurobuddha.pandaget.desktop.linux; do
    python3 scripts/publish-app.py "$pkg" "$VER"; done
  git commit -qam "PandaGet Desktop $VER" && git push -q origin HEAD && echo "catalog rows pushed" )
echo "== verdict"
python3 -c "
import json
d = json.load(open('$STORE/apks.json'))
need = ['com.eurobuddha.pandaget.desktop.mac','com.eurobuddha.pandaget.desktop.win','com.eurobuddha.pandaget.desktop.linux']
by = {a['packageId']: a for a in d['apps']}
ver = '$VER'
for p in need:
    a = by.get(p); print('  ', p, a['version'] if a else 'MISSING')
missing = [p for p in need if p not in by or by[p]['version'] != ver]
import sys
if missing: print('INCOMPLETE RELEASE - not at', ver, ':', missing); sys.exit(1)
print('ALL THREE PLATFORMS PUBLISHED at', ver)"

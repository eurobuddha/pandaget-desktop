# PandaGet Desktop

A **download-only store** for the Minima family's **desktop** apps (minimaCore Desktop,
MinimaClassic Desktop, miniMall Studio). PandaGet Desktop detects your OS, lists the installers
built for it, downloads the one you pick, **verifies its SHA-256**, and reveals it in your file
manager. It installs nothing itself — you install the file the same way you would any download.

The desktop sibling of the Android **PandaGet**: same catalog, same verify-before-install ethos,
same reason to exist (a store that can't install anything can't misbehave).

## How it works
- Reads the same `apks.json` the Android stores read, via the main process (GitHub API → raw CDN
  → IPFS fallbacks — see `main/catalog.js`).
- Shows only rows whose catalog `source` matches your platform (`Mac` / `Windows` / `Linux`).
- Download streams to `~/Downloads`, hashing as it goes; a partial or hash-mismatched file is
  discarded and never revealed (`main/download.js`).
- The renderer (`renderer/`) is plain HTML/CSS/JS, ported from the family's web store front, with
  the PandaApps theme, grouping, and glowing "Recommended" card.

## Build
```
npm ci
npm run dist:mac:signed   # mac: build + notarize DMG + verify (needs the `minimadesk` keychain profile)
npm run dist:win          # Windows nsis .exe (unsigned)
npm run dist:linux        # Linux AppImage
```
`dist:mac:signed` requires the "Developer ID Application: … (Z4JD286WF4)" cert in the login
keychain and the `minimadesk` notarytool keychain profile — the same setup as `minimaDesk` and
`minimacore-desktop`. `scripts/verify-mac.sh` proves the DMG installs cleanly on any Mac.

CI (`.github/workflows/desktop-build.yml`) builds all three platforms on a `v*` tag and signs mac
when the repo secrets exist; otherwise the locally-signed mac DMG is uploaded over CI's.

## Distribution
Installers are GitHub Release assets on this repo; the three catalog rows (PandaGet Desktop
Mac/Windows/Linux) in `desktop/minima-core-apks/apks.json` point at them, each with a SHA-256.

Windows `.exe` is unsigned (SmartScreen will warn); the Linux AppImage needs no signing; the mac
DMG is signed + notarized.

## License
MIT © 2026 eurobuddha

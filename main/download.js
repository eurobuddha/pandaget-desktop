/*
 * download.js — download a desktop installer, verify its SHA-256, reveal it. Never install.
 *
 * The Panda promise on every platform: stream the file to a .part, hash while streaming, and
 * only rename .part → final AFTER the size and (when the catalog carries one) the sha256 gate
 * pass — a partial or tampered file never becomes the real installer. Then reveal it in the OS
 * file manager; the user installs it themselves (drag a .dmg, run an .exe, chmod+run an
 * .AppImage). Mirrors Android ApkDownloader.java + ApkExporter.java. No silent install exists.
 *
 * Progress is pushed to the window on "pg:progress" as { packageId, percent, phase, error, savedPath }.
 */
const { app, shell } = require("electron");
const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function hex(buf) { return buf.toString("hex"); }

/** GET with redirect following; streams body chunks to onData. Resolves on 200 end. */
function stream(url, { timeout = 15 * 60_000, maxRedirects = 6 } = {}, onResponse) {
  return new Promise((resolve, reject) => {
    const req = https.get(new URL(url), {
      headers: { "User-Agent": "PandaGet-Desktop/" + app.getVersion(), Accept: "*/*" },
      timeout
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && maxRedirects > 0) {
        res.resume();
        return stream(new URL(res.headers.location, url).toString(), { timeout, maxRedirects: maxRedirects - 1 }, onResponse).then(resolve, reject);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error("HTTP " + res.statusCode)); }
      onResponse(res, resolve, reject);
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
  });
}

/**
 * Download `row.file`, verify against `row.sha256` (if present), save into ~/Downloads.
 * `emit(update)` is called with progress objects. Returns the saved absolute path.
 */
async function downloadInstaller(row, emit) {
  const url = String(row.file || "");
  const u = new URL(url);
  if (u.protocol !== "https:") throw new Error("refusing a non-https download");

  const dir = app.getPath("downloads");
  fs.mkdirSync(dir, { recursive: true });
  const name = path.basename(u.pathname) || (String(row.name || "download").replace(/[^\w.-]+/g, "-"));
  const dest = path.join(dir, name);
  const part = dest + ".part";

  const md = crypto.createHash("sha256");
  let got = 0, total = 0, lastPct = -1;

  emit({ packageId: row.packageId, percent: 0, phase: "downloading" });

  await stream(url, {}, (res, resolve, reject) => {
    total = parseInt(res.headers["content-length"] || "0", 10) || 0;
    const out = fs.createWriteStream(part);
    res.on("data", chunk => {
      out.write(chunk);
      md.update(chunk);
      got += chunk.length;
      if (total > 0) {
        const pct = Math.floor((got / total) * 100);
        if (pct !== lastPct) { lastPct = pct; emit({ packageId: row.packageId, percent: pct, phase: "downloading" }); }
      }
    });
    res.on("end", () => out.end(resolve));
    res.on("error", err => { out.destroy(); reject(err); });
    out.on("error", err => { res.destroy(); reject(err); });
  }).catch(err => { try { fs.unlinkSync(part); } catch (e) {} throw err; });

  // --- integrity gates: a partial or tampered file never becomes the real installer ---
  try {
    if (got === 0) throw new Error("Empty download");
    if (total > 0 && got !== total) throw new Error("Incomplete (" + got + "/" + total + " bytes)");
    const want = String(row.sha256 || "").toLowerCase().trim();
    if (want) {
      const actual = hex(md.digest());
      if (actual !== want) throw new Error("Checksum mismatch — download may be corrupt or tampered");
    }
  } catch (e) {
    try { fs.unlinkSync(part); } catch (_) {}
    throw e;
  }

  fs.renameSync(part, dest);
  emit({ packageId: row.packageId, percent: 100, phase: "saved", savedPath: dest });
  shell.showItemInFolder(dest);   // revealed, not opened — the user installs it themselves
  return dest;
}

module.exports = { downloadInstaller };

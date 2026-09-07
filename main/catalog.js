/*
 * catalog.js — fetch the SAME apks.json the Android PandaApps/PandaGet stores read.
 *
 * Four ordered sources, first that answers with a valid catalog wins — ported from the
 * Android app's Catalog.java: GitHub API (near-real-time) → GitHub raw CDN (~5 min lag) →
 * our own IPFS gateway → public IPFS gateway. Done in the main process so the renderer needs
 * no cross-origin network and no relaxed CSP.
 */
const https = require("https");
const { app } = require("electron");

const API_URL = "https://api.github.com/repos/eurobuddha/minima-core-apks/contents/apks.json";
const RAW_URL = "https://raw.githubusercontent.com/eurobuddha/minima-core-apks/main/apks.json";
const IPFS_OWN = "https://ipfs.eurobuddha.com/apks/apks.json";
const IPFS_PUBLIC = "https://ipfs.io/ipns/ipfs.eurobuddha.com/apks/apks.json";

const SOURCES = [
  { url: API_URL, accept: "application/vnd.github.raw" },  // GitHub API
  { url: RAW_URL, accept: "application/json" },            // raw CDN
  { url: IPFS_OWN, accept: "application/json" },           // own IPFS gateway
  { url: IPFS_PUBLIC, accept: "application/json" }         // public IPFS gateway
];

function get(url, accept, { timeout = 20000, maxRedirects = 5 } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(new URL(url), {
      headers: { "User-Agent": "PandaGet-Desktop/" + app.getVersion(), Accept: accept, "Cache-Control": "no-cache", Pragma: "no-cache" },
      timeout
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && maxRedirects > 0) {
        res.resume();
        return get(new URL(res.headers.location, url).toString(), accept, { timeout, maxRedirects: maxRedirects - 1 }).then(resolve, reject);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error("HTTP " + res.statusCode)); }
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
  });
}

/** Return the parsed catalog { apps:[...], disclaimer } from the first source that answers. */
async function fetchCatalog() {
  let lastErr = null;
  for (const s of SOURCES) {
    try {
      const data = JSON.parse((await get(s.url, s.accept)).toString("utf8"));
      if (data && Array.isArray(data.apps)) return { apps: data.apps, disclaimer: data.disclaimer || "", source: s.url };
      lastErr = new Error("no apps[] in " + s.url);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("no catalog source answered");
}

module.exports = { fetchCatalog };

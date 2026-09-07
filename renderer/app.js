/*
 * app.js — PandaGet Desktop renderer. A download-only store showing the family's DESKTOP apps
 * for THIS machine's OS. Grouping/glow/blurb are ported verbatim from the Android store (via the
 * web store port); downloads go through the main process (verify + reveal), never the browser.
 */
"use strict";

// ─── Groups — ported verbatim from the native store's Groups.java ────────────
var GROUP_ORDER = ["GET STARTED", "WALLETS", "FINANCE & TRADING", "SHOP & SELL", "SOCIAL",
                   "GAMES", "TOOLS", "DEVELOPER", "DESKTOP", "MORE"];
var CAT_GROUP = {
  core: "GET STARTED", store: "GET STARTED",
  wallet: "WALLETS", finance: "FINANCE & TRADING", shopping: "SHOP & SELL",
  social: "SOCIAL", games: "GAMES",
  tools: "TOOLS", utilities: "TOOLS", security: "TOOLS",
  developer: "DEVELOPER", desktop: "DESKTOP"
};
function groupFor(item) {
  return CAT_GROUP[String(item.category || "").trim().toLowerCase()] || "MORE";
}

var PANDAAPPS_URL = "https://github.com/eurobuddha/minima-core-android-pandaapps/releases/latest";

var PLATFORM = "Mac";        // "Mac" | "Windows" | "Linux" — matches the catalog `source`
var CATALOG = null;          // { apps:[...], disclaimer }
var expanded = {};           // detail key -> show-all-versions
var dl = {};                 // packageId -> { phase, percent, savedPath, error }
var toastTimer = null;

function el(id) { return document.getElementById(id); }

function ph() { var d = document.createElement("div"); d.className = "ph"; d.textContent = "◈"; return d; }
function iconEl(item) {
  if (!item.icon) return ph();
  var img = document.createElement("img"); img.className = "ico"; img.src = item.icon; img.alt = "";
  img.onerror = function () { img.replaceWith(ph()); };
  return img;
}

function toast(msg) {
  var t = el("toast");
  t.textContent = msg; t.className = "ok"; t.style.display = "block";
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { t.style.display = "none"; }, 4000);
}
function copyText(s) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(s).then(function () { toast("Copied."); });
  }
}

// Desktop rows for THIS os: catalog `source` equals the platform (Mac/Windows/Linux). This
// captures the desktop apps AND the PandaGet Desktop self-rows, and excludes every APK.
function desktopItems() {
  if (!CATALOG || !Array.isArray(CATALOG.apps)) return [];
  var p = PLATFORM.toLowerCase();
  return CATALOG.apps.filter(function (a) {
    return String(a.source || "").trim().toLowerCase() === p;
  });
}

function descText(d) { if (Array.isArray(d)) d = d.join(" "); return d ? String(d) : ""; }

// Split a changelog-style description into lead + [{version,text}] — the native store's Blurb.parse().
function blurbParse(desc) {
  var s = descText(desc).trim();
  var re = /\bv(\d+\.\d+(?:\.\d+)?):\s*/g;
  var lead = s, notes = [], m, marks = [];
  while ((m = re.exec(s)) !== null) marks.push({ idx: m.index, end: re.lastIndex, ver: m[1] });
  if (marks.length) {
    lead = s.slice(0, marks[0].idx).trim();
    for (var i = 0; i < marks.length; i++) {
      var endTxt = (i + 1 < marks.length) ? marks[i + 1].idx : s.length;
      notes.push({ version: marks[i].ver, text: s.slice(marks[i].end, endTxt).trim() });
    }
  }
  return { lead: lead, notes: notes };
}

// ─── Routing: "" list, "#/<idx>" detail ──────────────────────────────────────
function route() {
  var h = (location.hash || "").replace(/^#\/?/, "");
  if (h !== "") showDetail(h); else showList();
}
function goList() { location.hash = ""; }
function goDetail(key) { location.hash = "#/" + key; }

function showList() {
  el("detailView").style.display = "none";
  el("listView").style.display = "block";
  el("error").style.display = "none";
  if (CATALOG) render(); else load();
}

function load() {
  el("loading").style.display = "block";
  window.pandaget.catalog().then(function (res) {
    if (!res || !res.ok) { showError(res && res.error ? ("Could not reach the catalog: " + res.error) : "Could not reach the catalog."); return; }
    CATALOG = res;
    route();
  }).catch(function (e) { showError("Could not reach the catalog: " + (e && e.message || e)); });
}

function render() {
  el("loading").style.display = "none";
  el("error").style.display = "none";
  if (CATALOG.disclaimer) el("disclaimer").textContent = CATALOG.disclaimer;
  el("note").innerHTML = "<b>Desktop installers for " + PLATFORM + ".</b> Open an app, Download it — " +
    "PandaGet verifies the file against its published SHA-256 and reveals it. Install it yourself; " +
    "PandaGet installs nothing.";

  var items = desktopItems();
  var host = el("groups");
  host.innerHTML = "";
  if (!items.length) { showError("No desktop apps for " + PLATFORM + " in the catalog yet."); return; }

  var byGroup = {};
  items.forEach(function (it, i) {
    var g = groupFor(it);
    (byGroup[g] = byGroup[g] || []).push({ it: it, key: i });
  });
  GROUP_ORDER.forEach(function (g) {
    var l = byGroup[g];
    if (!l || !l.length) return;
    var h = document.createElement("div"); h.className = "ghead"; h.textContent = g;
    host.appendChild(h);
    l.forEach(function (e) { host.appendChild(rowFor(e.it, e.key)); });
  });
  el("subtitle").textContent = items.length + (items.length === 1 ? " app for " : " apps for ") + PLATFORM;
}

function showError(extra) {
  el("loading").style.display = "none";
  var e = el("error");
  e.innerHTML = (extra ? (extra + " ") : "Could not load the catalog. ") + '<a id="retry">Try again</a>.';
  e.style.display = "block";
  var r = document.getElementById("retry");
  if (r) r.onclick = function () { CATALOG = null; showList(); };
}

// ─── Rows (icon · name/state · chevron) ──────────────────────────────────────
function rowFor(item, key) {
  var r = document.createElement("div"); r.className = "row";
  r.appendChild(iconEl(item));
  var mid = document.createElement("div"); mid.className = "mid";
  var nm = document.createElement("div"); nm.className = "name"; nm.textContent = item.name || "App";
  if (item.highlight) {
    r.className += " hot";
    var hb = document.createElement("span"); hb.className = "hotchip"; hb.textContent = item.highlight;
    nm.appendChild(hb);
  }
  mid.appendChild(nm);
  var st = document.createElement("div"); st.className = "state";
  var d = dl[item.packageId];
  if (d && d.phase === "saved") { st.className = "state saved"; st.textContent = "Saved to Downloads"; }
  else if (d && d.phase === "downloading") { st.textContent = "Downloading… " + (d.percent || 0) + "%"; }
  else { st.textContent = "v" + (item.version || "?") + "  ·  " + (item.source || "Desktop"); }
  mid.appendChild(st);
  r.appendChild(mid);
  var ch = document.createElement("span"); ch.className = "chev"; ch.textContent = "›";
  r.appendChild(ch);
  r.onclick = function () { goDetail(key); };
  return r;
}

// ─── Detail view ─────────────────────────────────────────────────────────────
function showDetail(key) {
  if (!CATALOG) { load(); return; }
  var item = desktopItems()[parseInt(key, 10)];
  if (!item) { showList(); return; }
  el("listView").style.display = "none";
  el("detailView").style.display = "block";
  el("dtitle").textContent = item.name || "App";
  el("backBtn").onclick = function () { goList(); };
  renderDetail(item, key);
}

function renderDetail(item, key) {
  var body = el("detailBody");
  body.innerHTML = "";

  var hero = document.createElement("div"); hero.className = "hero";
  hero.appendChild(iconEl(item));
  var hc = document.createElement("div");
  var hn = document.createElement("div"); hn.className = "hname"; hn.textContent = item.name || "App";
  if (item.highlight) {
    var hhb = document.createElement("span"); hhb.className = "hotchip"; hhb.textContent = item.highlight;
    hn.appendChild(hhb);
  }
  hc.appendChild(hn);
  var hv = document.createElement("div"); hv.className = "hver";
  hv.textContent = "v" + (item.version || "?") + (item.category ? ("  ·  " + item.category) : "");
  hc.appendChild(hv);
  if (item.source) { var hs = document.createElement("div"); hs.className = "hsrc"; hs.textContent = item.source; hc.appendChild(hs); }
  hero.appendChild(hc);
  body.appendChild(hero);

  // ── Action area (Download → verify → reveal) ──
  if (item.file) body.appendChild(actionArea(item, key));

  if (item.repo && /^https?:\/\//i.test(item.repo)) {
    var src = document.createElement("button");
    src.className = "sbtn"; src.textContent = "View source code  ↗";
    src.onclick = function () { window.pandaget.openExternal(item.repo); };
    body.appendChild(src);
  }

  var b = blurbParse(item.description);
  if (b.lead) {
    body.appendChild(sectionHead("About"));
    var p = document.createElement("div"); p.className = "para"; p.textContent = b.lead;
    body.appendChild(p);
  }
  if (b.notes.length) {
    body.appendChild(sectionHead("What's new"));
    var showAll = !!expanded[key];
    var shown = showAll ? b.notes : b.notes.slice(0, 2);
    shown.forEach(function (n) {
      var w = document.createElement("div"); w.className = "vnote";
      var vl = document.createElement("div"); vl.className = "vlabel"; vl.textContent = "v" + n.version;
      w.appendChild(vl);
      var tx = document.createElement("div"); tx.className = "para"; tx.textContent = n.text;
      w.appendChild(tx);
      body.appendChild(w);
    });
    if (!showAll && b.notes.length > 2) {
      var more = document.createElement("button"); more.className = "showall";
      more.textContent = "Show all " + b.notes.length + " versions  ⌄";
      more.onclick = function () { expanded[key] = true; renderDetail(item, key); };
      body.appendChild(more);
    }
  }

  body.appendChild(sectionHead("Details"));
  var t = document.createElement("div"); t.className = "dtable";
  detailRow(t, "Version", "v" + (item.version || "?") + (item.versionCode ? (" (" + item.versionCode + ")") : ""));
  if (item.category) detailRow(t, "Category", item.category);
  detailRow(t, "Publisher", item.source || "PandaGet");
  if (item.packageId) detailRow(t, "Package", item.packageId, true);
  if (item.sha256) detailRow(t, "SHA-256", item.sha256, true, true);   // full value, never truncated
  if (item.file) { try { detailRow(t, "Host", new URL(item.file).hostname); } catch (e) {} }
  body.appendChild(t);
}

function actionArea(item, key) {
  var wrap = document.createElement("div");
  var d = dl[item.packageId] || {};
  var f = String(item.file).toLowerCase();
  var kind = f.indexOf(".dmg") >= 0 ? "installer (.dmg)"
           : f.indexOf(".appimage") >= 0 ? "app (.AppImage)"
           : f.indexOf(".exe") >= 0 ? "installer (.exe)" : "file";

  if (d.phase === "downloading") {
    var btn = document.createElement("button"); btn.className = "abtn"; btn.disabled = true;
    btn.textContent = "Downloading… " + (d.percent || 0) + "%";
    wrap.appendChild(btn);
    var bar = document.createElement("div"); bar.className = "pbar";
    var fill = document.createElement("span"); fill.style.width = (d.percent || 0) + "%";
    bar.appendChild(fill); wrap.appendChild(bar);
    return wrap;
  }

  if (d.phase === "saved" && d.savedPath) {
    var reveal = document.createElement("button"); reveal.className = "abtn"; reveal.textContent = "Reveal in " + revealName();
    reveal.onclick = function () { window.pandaget.reveal(d.savedPath); };
    wrap.appendChild(reveal);
    var open = document.createElement("button"); open.className = "sbtn";
    open.textContent = process_isMac() ? "Open the .dmg" : "Open the " + kind;
    open.onclick = function () { window.pandaget.open(d.savedPath); };
    wrap.appendChild(open);
    var redl = document.createElement("button"); redl.className = "sbtn"; redl.textContent = "Download again";
    redl.onclick = function () { startDownload(item, key); };
    wrap.appendChild(redl);
    var s = document.createElement("div"); s.className = "stateline saved";
    s.textContent = "Saved & verified — open it to install. PandaGet installs nothing itself.";
    wrap.appendChild(s);
    return wrap;
  }

  var dbtn = document.createElement("button"); dbtn.className = "abtn"; dbtn.textContent = "Download for " + PLATFORM;
  dbtn.onclick = function () { startDownload(item, key); };
  wrap.appendChild(dbtn);
  var line = document.createElement("div"); line.className = "stateline";
  line.textContent = item.sha256
    ? "Downloads the " + kind + " to your Downloads folder — verified against its SHA-256, then revealed."
    : "Downloads the " + kind + " to your Downloads folder, then reveals it.";
  wrap.appendChild(line);
  if (d.phase === "error" && d.error) {
    var err = document.createElement("div"); err.className = "stateline err"; err.textContent = d.error;
    wrap.appendChild(err);
  }
  return wrap;
}

function startDownload(item, key) {
  dl[item.packageId] = { phase: "downloading", percent: 0 };
  renderDetail(item, key);
  window.pandaget.download(item).then(function (res) {
    if (!res || !res.ok) { dl[item.packageId] = { phase: "error", error: (res && res.error) || "Download failed" }; }
    else { dl[item.packageId] = { phase: "saved", savedPath: res.savedPath }; }
    if (isCurrentDetail(key)) renderDetail(item, key);
  });
}

function isCurrentDetail(key) {
  return el("detailView").style.display !== "none" &&
         (location.hash || "").replace(/^#\/?/, "") === String(key);
}
function process_isMac() { return PLATFORM === "Mac"; }
function revealName() { return PLATFORM === "Mac" ? "Finder" : PLATFORM === "Windows" ? "Explorer" : "Files"; }

function sectionHead(txt) { var h = document.createElement("div"); h.className = "shead"; h.textContent = txt; return h; }
function detailRow(table, label, value, mono, copyable) {
  var r = document.createElement("div"); r.className = "drow";
  var k = document.createElement("div"); k.className = "k"; k.textContent = label; r.appendChild(k);
  var v = document.createElement("div"); v.className = "v" + (mono ? " mono" : "");
  v.textContent = value; r.appendChild(v);           // full value, never truncated
  if (copyable) {
    var c = document.createElement("span"); c.className = "copy"; c.textContent = "COPY";
    r.style.cursor = "pointer";
    r.onclick = function () { copyText(value); };
    r.appendChild(c);
  }
  table.appendChild(r);
}

// ─── Live download progress from main ─────────────────────────────────────────
window.pandaget.onProgress(function (u) {
  if (!u || !u.packageId) return;
  var prev = dl[u.packageId] || {};
  if (u.phase === "downloading") dl[u.packageId] = { phase: "downloading", percent: u.percent || 0 };
  else if (u.phase === "saved") dl[u.packageId] = { phase: "saved", savedPath: u.savedPath };
  else if (u.phase === "error") dl[u.packageId] = { phase: "error", error: u.error };
  // refresh whichever view is showing this app
  var det = el("detailView").style.display !== "none";
  if (det) {
    var key = (location.hash || "").replace(/^#\/?/, "");
    var item = CATALOG ? desktopItems()[parseInt(key, 10)] : null;
    if (item && item.packageId === u.packageId) renderDetail(item, key);
  } else if (CATALOG) {
    render();
  }
});

// ─── Boot ─────────────────────────────────────────────────────────────────────
el("phoneLink").onclick = function () { window.pandaget.openExternal(PANDAAPPS_URL); };
window.addEventListener("hashchange", route);
window.pandaget.platform().then(function (p) { PLATFORM = p || "Mac"; load(); });

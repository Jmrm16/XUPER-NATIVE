"use strict";

const https = require("node:https");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const zlib = require("node:zlib");

const EPG_FEEDS = [
  { key: "MX1", url: "https://epgshare01.online/epgshare01/epg_ripper_MX1.xml.gz" },
  { key: "CO1", url: "https://epgshare01.online/epgshare01/epg_ripper_CO1.xml.gz" },
  { key: "AR1", url: "https://epgshare01.online/epgshare01/epg_ripper_AR1.xml.gz" },
  { key: "ES1", url: "https://epgshare01.online/epgshare01/epg_ripper_ES1.xml.gz" },
];

const CACHE_DIR = process.env.XUPER_DATA_DIR || os.tmpdir();
const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours
const WINDOW_PAST_MS = 2 * 60 * 60 * 1000;
const WINDOW_FUTURE_MS = 14 * 60 * 60 * 1000;

let state = {
  ready: false,
  loading: false,
  lastLoadedAt: 0,
  // normName -> [channelId, ...]
  nameIndex: new Map(),
  // compactName -> [channelId, ...]
  compactIndex: new Map(),
  // channelId -> feedKey ("MX1", "CO1", "AR1", "ES1")
  channelFeed: new Map(),
  // channelId -> [{ startMs, stopMs, title, desc }]
  programmes: new Map(),
  channelsIndexed: 0,
  programmesCount: 0,
};

const NOISE_WORDS = new Set([
  "hd", "fhd", "uhd", "4k", "sd", "tv", "latam", "latino", "latinoamerica",
  "colombia", "mexico", "argentina", "espana", "chile", "peru", "ecuador",
  "co", "mx", "ar", "es", "pe", "cl", "us", "usa", "east", "west",
  "este", "oeste", "sur", "norte", "feed", "canal", "channel", "en", "vivo"
]);

function decodeXmlEntities(str) {
  if (!str) return "";
  return String(str)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .trim();
}

function normalizeName(raw) {
  if (!raw) return "";
  let s = decodeXmlEntities(raw)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " ")
    .replace(/\+/g, " plus ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return "";
  const tokens = s.split(" ").filter((t) => t && !NOISE_WORDS.has(t));
  return tokens.join(" ").trim();
}

function compactName(norm) {
  return String(norm || "").replace(/\s+/g, "");
}

function parseXmltvTime(raw) {
  // Format: YYYYMMDDHHmmss +0000 (or -0500)
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\s*([+-]\d{4}))?/.exec(String(raw || "").trim());
  if (!m) return 0;
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const min = Number(m[5]);
  const sec = Number(m[6]);
  let utcMs = Date.UTC(year, month, day, hour, min, sec);
  if (m[7]) {
    const sign = m[7][0] === "-" ? -1 : 1;
    const offH = Number(m[7].slice(1, 3));
    const offM = Number(m[7].slice(3, 5));
    utcMs -= sign * (offH * 60 + offM) * 60 * 1000;
  }
  return utcMs;
}

function formatLocalHhMm(ms) {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function fetchGunzippedXml(feed) {
  return new Promise((resolve) => {
    const cacheFile = path.join(CACHE_DIR, `xuper-epg-${feed.key}.xml`);
    try {
      if (fs.existsSync(cacheFile)) {
        const stat = fs.statSync(cacheFile);
        if (Date.now() - stat.mtimeMs < CACHE_TTL_MS && stat.size > 1000) {
          return resolve(fs.readFileSync(cacheFile, "utf8"));
        }
      }
    } catch {}

    const req = https.get(feed.url, { timeout: 12000, headers: { "User-Agent": "XuperTV/1.0" } }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return resolve("");
      }
      const chunks = [];
      res
        .pipe(zlib.createGunzip())
        .on("data", (c) => chunks.push(c))
        .on("end", () => {
          const xml = Buffer.concat(chunks).toString("utf8");
          try {
            if (xml.length > 1000) fs.writeFileSync(cacheFile, xml, "utf8");
          } catch {}
          resolve(xml);
        })
        .on("error", () => resolve(""));
    });
    req.on("timeout", () => {
      try { req.destroy(); } catch {}
      resolve("");
    });
    req.on("error", () => resolve(""));
  });
}

function parseFeedIntoIndex(feedKey, xml, nameIndex, compactIndex, channelFeed, programmes, nowMs) {
  if (!xml) return;
  const minMs = nowMs - WINDOW_PAST_MS;
  const maxMs = nowMs + WINDOW_FUTURE_MS;

  // 1. Parse <channel id="...">...</channel>
  const chRe = /<channel id="([^"]+)">([\s\S]*?)<\/channel>/g;
  let cm;
  while ((cm = chRe.exec(xml)) !== null) {
    const chId = decodeXmlEntities(cm[1]);
    if (!channelFeed.has(chId)) channelFeed.set(chId, feedKey);
    const inner = cm[2];
    const dnRe = /<display-name[^>]*>([^<]+)<\/display-name>/g;
    let dm;
    while ((dm = dnRe.exec(inner)) !== null) {
      const norm = normalizeName(dm[1]);
      if (!norm) continue;
      if (!nameIndex.has(norm)) nameIndex.set(norm, []);
      const arr = nameIndex.get(norm);
      if (!arr.includes(chId)) arr.push(chId);

      const cmp = compactName(norm);
      if (cmp) {
        if (!compactIndex.has(cmp)) compactIndex.set(cmp, []);
        const cArr = compactIndex.get(cmp);
        if (!cArr.includes(chId)) cArr.push(chId);
      }
    }
  }

  // 2. Parse <programme start="..." stop="..." channel="...">...</programme>
  const prRe = /<programme start="([^"]+)" stop="([^"]+)" channel="([^"]+)">([\s\S]*?)<\/programme>/g;
  let pm;
  while ((pm = prRe.exec(xml)) !== null) {
    const startMs = parseXmltvTime(pm[1]);
    const stopMs = parseXmltvTime(pm[2]);
    if (!startMs || !stopMs || stopMs < minMs || startMs > maxMs) continue;
    const chId = decodeXmlEntities(pm[3]);
    const inner = pm[4];
    const titleM = /<title[^>]*>([^<]+)<\/title>/.exec(inner);
    if (!titleM) continue;
    const title = decodeXmlEntities(titleM[1]);
    if (!title) continue;
    const descM = /<desc[^>]*>([^<]+)<\/desc>/.exec(inner);
    const desc = descM ? decodeXmlEntities(descM[1]) : "";

    if (!programmes.has(chId)) programmes.set(chId, []);
    programmes.get(chId).push({ startMs, stopMs, title, desc });
  }
}

async function loadAllFeeds(force = false) {
  if (state.loading) return;
  if (!force && state.ready && Date.now() - state.lastLoadedAt < CACHE_TTL_MS) return;

  state.loading = true;
  try {
    const xmlList = await Promise.all(EPG_FEEDS.map(fetchGunzippedXml));
    const nowMs = Date.now();
    const nameIndex = new Map();
    const compactIndex = new Map();
    const channelFeed = new Map();
    const programmes = new Map();

    for (let i = 0; i < EPG_FEEDS.length; i++) {
      parseFeedIntoIndex(EPG_FEEDS[i].key, xmlList[i], nameIndex, compactIndex, channelFeed, programmes, nowMs);
    }

    let totalProgs = 0;
    for (const [, list] of programmes) {
      list.sort((a, b) => a.startMs - b.startMs);
      totalProgs += list.length;
    }

    state.nameIndex = nameIndex;
    state.compactIndex = compactIndex;
    state.channelFeed = channelFeed;
    state.programmes = programmes;
    state.channelsIndexed = nameIndex.size;
    state.programmesCount = totalProgs;
    state.lastLoadedAt = nowMs;
    state.ready = true;
    console.log(`[epg] XMLTV listo: ${nameIndex.size} canales indexados, ${totalProgs} programas en ventana`);
  } catch (err) {
    console.warn("[epg] Error cargando EPG:", err && err.message);
  } finally {
    state.loading = false;
  }
}

function warmUp() {
  loadAllFeeds(false).catch(() => {});
}

function findChannelIdsForName(rawName) {
  const norm = normalizeName(rawName);
  if (!norm) return [];
  if (state.nameIndex.has(norm)) return state.nameIndex.get(norm);
  const cmp = compactName(norm);
  if (cmp && state.compactIndex.has(cmp)) return state.compactIndex.get(cmp);

  // Try stripping trailing region/variant number only if no exact match (never strip channel numbers like ESPN 2 -> ESPN)
  return [];
}

function orderChannelIdsByRegion(ids, region) {
  if (!ids || ids.length <= 1) return ids || [];
  const reg = String(region || "auto").toLowerCase();
  const orderMap = {
    auto: ["MX1", "CO1", "AR1", "ES1"],
    mx: ["MX1", "CO1", "AR1", "ES1"],
    co: ["CO1", "MX1", "AR1", "ES1"],
    ar: ["AR1", "MX1", "CO1", "ES1"],
    es: ["ES1", "MX1", "CO1", "AR1"],
  };
  const priority = orderMap[reg] || orderMap.auto;
  return ids.slice().sort((a, b) => {
    const fa = priority.indexOf(state.channelFeed.get(a) || "");
    const fb = priority.indexOf(state.channelFeed.get(b) || "");
    return (fa === -1 ? 99 : fa) - (fb === -1 ? 99 : fb);
  });
}

function getSchedule(rawName, limit = 6, opts = {}) {
  if (!state.ready) return { now: null, next: null, schedule: [] };
  const ids = orderChannelIdsByRegion(findChannelIdsForName(rawName), opts.region);
  if (!ids.length) return { now: null, next: null, schedule: [] };

  const offsetMs = (Number(opts.offsetMinutes) || 0) * 60 * 1000;
  const nowMs = Date.now();
  for (const chId of ids) {
    const list = state.programmes.get(chId);
    if (!list || !list.length) continue;

    let currentIdx = -1;
    for (let i = 0; i < list.length; i++) {
      const s = list[i].startMs + offsetMs;
      const e = list[i].stopMs + offsetMs;
      if (s <= nowMs && e > nowMs) {
        currentIdx = i;
        break;
      }
    }
    if (currentIdx === -1) {
      for (let i = 0; i < list.length; i++) {
        if (list[i].startMs + offsetMs >= nowMs) {
          currentIdx = i;
          break;
        }
      }
    }
    if (currentIdx === -1) continue;

    const cur = list[currentIdx];
    const curStart = cur.startMs + offsetMs;
    const curStop = cur.stopMs + offsetMs;
    const isActuallyNow = curStart <= nowMs && curStop > nowMs;
    const nowProg = isActuallyNow
      ? {
          title: cur.title,
          desc: cur.desc,
          startMs: curStart,
          stopMs: curStop,
          startTime: formatLocalHhMm(curStart),
          stopTime: formatLocalHhMm(curStop),
          progress: Math.min(100, Math.max(2, Math.round(((nowMs - curStart) / Math.max(1, curStop - curStart)) * 100))),
        }
      : null;

    const nextEntry = isActuallyNow ? list[currentIdx + 1] : cur;
    const nextProg = nextEntry
      ? {
          title: nextEntry.title,
          startMs: nextEntry.startMs + offsetMs,
          stopMs: nextEntry.stopMs + offsetMs,
          startTime: formatLocalHhMm(nextEntry.startMs + offsetMs),
          stopTime: formatLocalHhMm(nextEntry.stopMs + offsetMs),
        }
      : null;

    const schedule = list.slice(currentIdx, currentIdx + limit).map((p) => ({
      title: p.title,
      desc: p.desc,
      startTime: formatLocalHhMm(p.startMs + offsetMs),
      stopTime: formatLocalHhMm(p.stopMs + offsetMs),
      isLiveNow: p.startMs + offsetMs <= nowMs && p.stopMs + offsetMs > nowMs,
    }));

    return { now: nowProg, next: nextProg, schedule, feed: state.channelFeed.get(chId) || "" };
  }

  return { now: null, next: null, schedule: [] };
}

function getNowNext(rawName, opts = {}) {
  const res = getSchedule(rawName, 2, opts);
  return { now: res.now, next: res.next, feed: res.feed };
}

function getNowNextBatch(names, opts = {}) {
  const out = {};
  if (!state.ready || !Array.isArray(names)) return out;
  for (const name of names) {
    if (!name || out[name]) continue;
    const res = getNowNext(name, opts);
    if (res.now || res.next) {
      out[name] = res;
    }
  }
  return out;
}

function getStatus() {
  return {
    ready: state.ready,
    loading: state.loading,
    channelsIndexed: state.channelsIndexed,
    programmesCount: state.programmesCount,
    lastLoadedAt: state.lastLoadedAt,
  };
}

module.exports = {
  warmUp,
  loadAllFeeds,
  getNowNext,
  getNowNextBatch,
  getSchedule,
  getStatus,
};

import { NativeModules } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import fallbackSeedsRaw from './seeds-fallback.json';
import type {
  MediaItem,
  MediaDetail,
  Episode,
  Season,
  LiveCategory,
  LiveChannel,
  ResolvedStream,
  SubtitleTrack,
  TrackInfo,
  SeedInfo,
} from './types';

const { XuperNative } = NativeModules as {
  XuperNative: {
    getLocalServerPort(): number;
    des3EncryptBase64(plainUtf8: string, keyHex: string): string;
    des3DecryptUtf8(cipherBase64: string, keyHex: string): string;
    registerStream(
      url: string,
      headersJson: string,
      duration: number,
      backupsJson: string,
      isLive: boolean,
    ): string;
    registerSubtitle(url: string): string;
    setLandscape(landscape: boolean): void;
    httpRequest(
      optsJson: string,
      bodyStr: string | null,
    ): Promise<{ status: number; headersJson: string; bodyBase64: string }>;
  };
};

const KEY_HEX = 'e7af1ed7de1ffddd7bd3fe37ebdffde9ef3fe1ae39edfeb8';
const HOSTS = [
  'ftmrmy.jdfey0cd.com',
  'fuxok.nguvmqhpk.com',
  'eajmnp.hcgv1dt8.com',
  'mptec.dhkrxuzcy.com',
  'hinumz.a878kkoyc.com',
  'krdwvd.swcaw7qx.com',
  'osuhk.m3x8o50te.com',
  'oogoy.f30c96w8.com',
];

const PORTAL_CODE = 'masnew';
const APP_ID = 'com.android.msandroid';
const APK_VERSION = '49902';
const SPKG_VER = '2024-09-10 06:25:30_33_13_';
const APK_VER_HEADER = '43404';
const USER_AGENT = 'okhttp/3.12.12';
const UA_CDN = 'Ranger/4.9.4-17294ac0';
const CONTENT_TYPE = 'application/json;charset=utf-8';
const FIXED_MAC = '02:00:00:00:00:00';
const FIXED_RESERVE1 = '583442714b345572434a4d5769637461545a735936413d3d';
const FIXED_DRM_ID = '0iSGEyv2EqiS/nqI/I3hqdu12irw5Q3/uqrWvRFx9bM=';

const SEED_URLS = [
  'https://raw.githubusercontent.com/cristianco7/XUPER-HYDRA-PORT-WEBOS/seeds/seeds.json',
  'https://raw.githubusercontent.com/Jmrm16/streaming/seeds/seeds.json',
  'https://raw.githubusercontent.com/Jmrm16/streaming/main/webos/services/com.webosflux.xuptertv.fidelity.service/seeds-fallback.json',
];

const STORAGE_SEEDS = '@xuper/seeds_v1';
const STORAGE_DEAD_SEEDS = '@xuper/dead_seeds_v1';
const DEAD_SEED_MS = 21600000;
const SESSION_MAX_AGE_MS = 21600000;
const TREE_TTL = 600000;
const SEARCH_TTL = 180000;
const SLB_TTL = 300000;
const PLAY_TTL = 60000;
const LIVE_RESOLVE_CACHE_MS = 120000;
const SEED_RESCUE_ROUNDS = 6;

const GEO_BLOCKED = 'portal100024';
const SESSION_DEAD: Record<string, boolean> = {
  aaa100027: true,
  aaa100028: true,
  aaa100080: true,
  aaa100082: true,
  aaa100083: true,
};

const ROOT_CODES: Record<string, string> = {
  featured: 'masnew_featured',
  movies: 'masnew_movies',
  series: 'masnew_series',
  anime: 'masnew_anime',
  kids: 'masnew_kids',
  free: 'masnew_free',
};

const ROOT_CATEGORY: Record<string, string> = {
  featured: 'destacado',
  movies: 'pelicula',
  series: 'serie',
  anime: 'anime',
  kids: 'infantil',
  free: 'gratis',
};

const DEVICE_FIXED: Record<string, string | number> = {
  loginType: '2',
  appLanguage: 'en',
  hardwareInfo: 'ranchu',
  model: 'sdk_gphone64_arm64',
  product: 'sdk_gphone64_arm64',
  cpu: 'arm64-v8a',
  B29: '',
  reserve1: FIXED_RESERVE1,
  deviceToken: '',
  drmId: FIXED_DRM_ID,
  sdkVer: 33,
};

// ── Base64 & Hex Helpers (Hermes-safe, zero Node Buffer) ────────────────────
const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LUT = new Int16Array(256).fill(-1);
for (let i = 0; i < B64_CHARS.length; i++) B64_LUT[B64_CHARS.charCodeAt(i)] = i;

export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64 || '';
  const len = clean.length;
  if (!len) return new Uint8Array(0);
  let validLen = 0;
  for (let i = 0; i < len; i++) {
    const code = clean.charCodeAt(i);
    if (code < 256 && (B64_LUT[code] >= 0 || code === 61)) validLen++;
  }
  const pad = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  const out = new Uint8Array(Math.max(0, Math.floor((validLen * 3) / 4) - pad));
  let p = 0;
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < len; i++) {
    const code = clean.charCodeAt(i);
    if (code === 61) break;
    const v = code < 256 ? B64_LUT[code] : -1;
    if (v < 0) continue;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      if (p < out.length) out[p++] = (acc >> bits) & 255;
    }
  }
  return out;
}

export function bytesToUtf8(bytes: Uint8Array): string {
  const chunks: string[] = [];
  const codes: number[] = [];
  let i = 0;
  while (i < bytes.length) {
    const c = bytes[i++];
    if (c < 128) {
      codes.push(c);
    } else if (c >= 192 && c < 224) {
      const c2 = bytes[i++] ?? 0;
      codes.push(((c & 31) << 6) | (c2 & 63));
    } else if (c >= 224 && c < 240) {
      const c2 = bytes[i++] ?? 0;
      const c3 = bytes[i++] ?? 0;
      codes.push(((c & 15) << 12) | ((c2 & 63) << 6) | (c3 & 63));
    } else {
      const c2 = bytes[i++] ?? 0;
      const c3 = bytes[i++] ?? 0;
      const c4 = bytes[i++] ?? 0;
      const cp =
        (((c & 7) << 18) | ((c2 & 63) << 12) | ((c3 & 63) << 6) | (c4 & 63)) - 0x10000;
      codes.push(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
    }
    if (codes.length >= 4096) {
      chunks.push(String.fromCharCode(...codes));
      codes.length = 0;
    }
  }
  if (codes.length > 0) {
    chunks.push(String.fromCharCode(...codes));
  }
  return chunks.join('');
}

export function base64ToUtf8(b64: string): string {
  return bytesToUtf8(base64ToBytes(b64));
}

function asciiToHex(str: string): string {
  let out = '';
  for (let i = 0; i < str.length; i++) {
    out += str.charCodeAt(i).toString(16).padStart(2, '0');
  }
  return out;
}

function hexToAscii(hex: string): string {
  const clean = hex.trim();
  let out = '';
  for (let i = 0; i < clean.length; i += 2) {
    out += String.fromCharCode(parseInt(clean.slice(i, i + 2), 16));
  }
  return out;
}

function encryptBody(jsonStr: string): string {
  const b64 = XuperNative.des3EncryptBase64(jsonStr, KEY_HEX);
  return asciiToHex(b64);
}

function decryptBlob(hexStr: string): string {
  const b64 = hexToAscii(hexStr);
  return XuperNative.des3DecryptUtf8(b64, KEY_HEX);
}

// ── MD5 / signO3 for Live CDN ───────────────────────────────────────────────
const LIVE_K = [
  3614090360, 3905402710, 606105819, 3250441966, 4118548399, 1200080426,
  2821735955, 4249261313, 1770035416, 2336552879, 4294925233, 2304563134,
  1804603682, 4254626195, 2792965006, 1236535329, 4129170786, 3225465664,
  643717713, 3921069994, 3593408605, 38016083, 3634488961, 3889429448,
  568446438, 3275163606, 4107603335, 1163531501, 2850285829, 4243563512,
  1735328473, 2368359562, 4294588738, 2272392833, 1839030562, 4259657740,
  2763975236, 1272893353, 4139469664, 3200236656, 681279174, 3936430074,
  3564056709, 76029189, 3654602809, 3871185381, 530742520, 3299628645,
  4096336452, 1126891415, 2878612391, 4237533241, 1700485571, 2399980690,
  4293706877, 2240044497, 1873313359, 4264355552, 2734768916, 1309151649,
  4149444226, 3174756917, 765973179, 3951481745,
];
const LIVE_S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];
const LIVE_ROUND1 = [10, 11, 12, 13, 14, 15, 6, 7, 8, 9, 0, 1, 2, 3, 4, 5];
const LIVE_G = Array.from({ length: 64 }, (_, i) =>
  i < 16 ? LIVE_ROUND1[i] : i < 32 ? (5 * i + 1) % 16 : i < 48 ? (3 * i + 5) % 16 : (7 * i) % 16,
);
const LIVE_SALT = [
  115, 97, 108, 116, 51, 51, 51, 51, 61, 52, 152, 13, 10, 21, 50, 201, 195, 130, 23, 8, 192,
];

function rotl(x: number, n: number): number {
  return ((x << n) | (x >>> (32 - n))) >>> 0;
}

function md5BytesHex(input: Uint8Array): string {
  const t = input.length;
  const n = (56 - ((t + 1) % 64) + 64) % 64;
  const s = new Uint8Array(t + 1 + n + 8);
  s.set(input, 0);
  s[t] = 128;
  const bitLo = (t % 536870912) * 8;
  const bitHi = Math.floor(t / 536870912);
  for (let i = 0; i < 4; i++) {
    s[t + 1 + n + i] = (bitLo >>> (8 * i)) & 255;
    s[t + 5 + n + i] = (bitHi >>> (8 * i)) & 255;
  }

  const r = [1732584193, 4023233417, 2562383102, 271733878];
  const m = new Array<number>(16);
  for (let off = 0; off < s.length; off += 64) {
    for (let j = 0; j < 16; j++) {
      const a = off + 4 * j;
      m[j] = (s[a] | (s[a + 1] << 8) | (s[a + 2] << 16) | (s[a + 3] << 24)) >>> 0;
    }
    let a = r[0], b = r[1], c = r[2], d = r[3];
    for (let k = 0; k < 64; k++) {
      const f =
        k < 16
          ? (b & c) | (~b & d)
          : k < 32
            ? (d & b) | (~d & c)
            : k < 48
              ? b ^ c ^ d
              : c ^ (b | ~d);
      const sum = (f + a + LIVE_K[k] + m[LIVE_G[k]]) >>> 0;
      a = d;
      d = c;
      c = b;
      b = (b + rotl(sum, LIVE_S[k])) >>> 0;
    }
    r[0] = (r[0] + a) >>> 0;
    r[1] = (r[1] + b) >>> 0;
    r[2] = (r[2] + c) >>> 0;
    r[3] = (r[3] + d) >>> 0;
  }

  let hex = '';
  for (let d = 0; d < 4; d++) {
    for (let c = 0; c < 4; c++) {
      hex += ((r[d] >>> (8 * c)) & 255).toString(16).padStart(2, '0');
    }
  }
  return hex;
}

function signO3(token: string, startMoment: number): string {
  const str = `token=${token}&sign2_method=sign_o3&instance=0&start_moment=${startMoment}`;
  const bytes = new Uint8Array(str.length + LIVE_SALT.length);
  for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i);
  for (let i = 0; i < LIVE_SALT.length; i++) bytes[str.length + i] = LIVE_SALT[i];
  return md5BytesHex(bytes);
}

// ── Seed Pool & Session ─────────────────────────────────────────────────────
interface RawSeed {
  sn: string;
  userId: string;
  userToken: string;
  portalKind?: string;
}

let seedPool: RawSeed[] = Array.isArray((fallbackSeedsRaw as any)?.seeds)
  ? ((fallbackSeedsRaw as any).seeds as RawSeed[])
  : Array.isArray(fallbackSeedsRaw)
    ? (fallbackSeedsRaw as RawSeed[])
    : [];
let deadSeeds: Record<string, number> = {};
let preferredHost = '';

const session = {
  sn: '',
  userId: '',
  userToken: '',
  ready: false,
  at: 0,
  seed: null as RawSeed | null,
};

let storageLoaded = false;
async function ensureSeedsLoaded(): Promise<void> {
  if (storageLoaded) return;
  storageLoaded = true;
  try {
    const [savedSeeds, savedDead] = await Promise.all([
      AsyncStorage.getItem(STORAGE_SEEDS),
      AsyncStorage.getItem(STORAGE_DEAD_SEEDS),
    ]);
    if (savedSeeds) {
      const parsed = JSON.parse(savedSeeds);
      const arr = Array.isArray(parsed?.seeds) ? parsed.seeds : Array.isArray(parsed) ? parsed : [];
      if (arr.length) seedPool = arr;
    }
    if (savedDead) {
      const parsed = JSON.parse(savedDead);
      if (parsed && typeof parsed === 'object') deadSeeds = parsed;
    }
  } catch {
    // ignore storage errors
  }
  // Background refresh from GitHub
  refreshSeedsFromCloud().catch(() => {});
}

function seedIdentity(s: RawSeed | null): string {
  if (!s) return '';
  return `${(s.sn || '').trim().toLowerCase()}|${(s.userId || '').trim()}`;
}

function isSeedDead(s: RawSeed): boolean {
  const id = seedIdentity(s);
  const exp = deadSeeds[id];
  if (!exp) return false;
  if (Date.now() > exp) {
    delete deadSeeds[id];
    return false;
  }
  return true;
}

function usableSeeds(): RawSeed[] {
  return seedPool.filter((s) => s && s.sn && s.userId && s.userToken && !isSeedDead(s));
}

function markSeedDead(s: RawSeed | null): void {
  if (!s) return;
  const id = seedIdentity(s);
  if (!id) return;
  deadSeeds[id] = Date.now() + DEAD_SEED_MS;
  AsyncStorage.setItem(STORAGE_DEAD_SEEDS, JSON.stringify(deadSeeds)).catch(() => {});
}

export async function refreshSeedsFromCloud(): Promise<number> {
  for (const url of SEED_URLS) {
    try {
      const res = await XuperNative.httpRequest(
        JSON.stringify({ url, method: 'GET', timeoutMs: 8000 }),
        null,
      );
      if (res.status >= 200 && res.status < 300 && res.bodyBase64) {
        const text = base64ToUtf8(res.bodyBase64);
        const parsed = JSON.parse(text);
        const list: RawSeed[] = Array.isArray(parsed?.seeds)
          ? parsed.seeds
          : Array.isArray(parsed)
            ? parsed
            : [];
        const valid = list.filter((s) => s && s.sn && s.userId && s.userToken);
        if (valid.length > 0) {
          seedPool = valid;
          await AsyncStorage.setItem(STORAGE_SEEDS, JSON.stringify({ seeds: valid, at: Date.now() }));
          return valid.length;
        }
      }
    } catch {
      // try next URL
    }
  }
  return seedPool.length;
}

function pickSeed(tried: Record<string, boolean>): RawSeed | null {
  const list = usableSeeds().slice();
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  for (const s of list) {
    if (!tried[seedIdentity(s)]) return s;
  }
  return list[0] || null;
}

function adoptSeed(s: RawSeed): void {
  session.sn = (s.sn || '').trim().toLowerCase();
  session.userId = (s.userId || '').trim();
  session.userToken = (s.userToken || '').trim();
  session.seed = s;
  session.ready = true;
  session.at = Date.now();
}

async function ensureSession(forceNew = false): Promise<void> {
  await ensureSeedsLoaded();
  if (!forceNew && session.ready && session.userId && session.userToken) {
    if (Date.now() - session.at < SESSION_MAX_AGE_MS) return;
  }
  const s = pickSeed({});
  if (!s) throw new Error('Sin semillas disponibles para conectar al portal');
  adoptSeed(s);
}

// ── Native HTTP + Portal Call ───────────────────────────────────────────────
export async function nativeHttpGetText(url: string, timeoutMs = 15000): Promise<string> {
  const res = await XuperNative.httpRequest(
    JSON.stringify({ url, method: 'GET', timeoutMs }),
    null,
  );
  if (res.status < 200 || res.status >= 400) {
    throw new Error(`HTTP ${res.status}`);
  }
  return base64ToUtf8(res.bodyBase64);
}

function hostOrder(): string[] {
  const out: string[] = [];
  if (preferredHost) out.push(preferredHost);
  for (const h of HOSTS) {
    if (h !== preferredHost) out.push(h);
  }
  return out;
}

async function portalPost(endpoint: string, payload: Record<string, unknown>): Promise<any> {
  const encrypted = encryptBody(JSON.stringify(payload));
  const hosts = hostOrder();
  let lastErr: Error | null = null;

  for (const host of hosts) {
    for (const scheme of ['https', 'http']) {
      try {
        const res = await XuperNative.httpRequest(
          JSON.stringify({
            url: `${scheme}://${host}/api/portalCore/${endpoint}`,
            method: 'POST',
            timeoutMs: 4500,
            headers: {
              apk: APP_ID,
              apkVer: APK_VER_HEADER,
              spkgVer: SPKG_VER,
              'User-Agent': USER_AGENT,
              'Content-Type': CONTENT_TYPE,
            },
          }),
          encrypted,
        );
        if (res.status < 200 || res.status >= 300 || !res.bodyBase64) {
          lastErr = new Error(`${endpoint}: HTTP ${res.status}`);
          continue;
        }
        const rawText = base64ToUtf8(res.bodyBase64);
        const outer = JSON.parse(rawText);
        if (outer?.returnCode && outer.returnCode !== '0' && outer.returnCode !== '200') {
          const code = String(outer.returnCode);
          const err: any = new Error(outer.errorMessage || outer.message || `Portal error ${code}`);
          err.portalCode = code;
          throw err;
        }
        preferredHost = host;
        if (typeof outer?.data === 'string' && outer.data.length > 0) {
          const dec = decryptBlob(outer.data);
          return JSON.parse(dec);
        }
        return outer?.data ?? outer;
      } catch (e: any) {
        if (e?.portalCode) throw e;
        lastErr = e instanceof Error ? e : new Error(String(e));
      }
    }
  }
  throw lastErr || new Error(`${endpoint}: portal unreachable`);
}

let portalQueue: Promise<unknown> = Promise.resolve();

function portalCall(endpoint: string, params: Record<string, unknown>): Promise<any> {
  const run = async () => {
    await ensureSession();
    const tried: Record<string, boolean> = {};

    for (let round = 0; round <= SEED_RESCUE_ROUNDS; round++) {
      const body: Record<string, unknown> = {
        portalCode: PORTAL_CODE,
        userId: session.userId,
        userToken: session.userToken,
        ...DEVICE_FIXED,
        apkVersion: APK_VERSION,
        sysVersion: SPKG_VER,
        appId: APP_ID,
        sn: session.sn,
        ...params,
      };
      try {
        return await portalPost(endpoint, body);
      } catch (err: any) {
        const code = String(err?.portalCode || '');
        const msg = String(err?.message || '');
        const isDead =
          code === GEO_BLOCKED ||
          Boolean(SESSION_DEAD[code]) ||
          /sesi[oó]n|login|token.*expir|invalid.*sn/i.test(msg);
        if (!isDead || round === SEED_RESCUE_ROUNDS) throw err;

        if (session.seed) {
          tried[seedIdentity(session.seed)] = true;
          if (SESSION_DEAD[code]) markSeedDead(session.seed);
        }
        const nextSeed = pickSeed(tried);
        if (!nextSeed) throw err;
        adoptSeed(nextSeed);
      }
    }
  };

  const next = portalQueue.then(run, run);
  portalQueue = next.catch(() => {});
  return next;
}

// ── Parsing & Deduplication ─────────────────────────────────────────────────
function trim(v: unknown): string {
  return v == null ? '' : String(v).trim();
}

function imageOf(e: any, type: 'icon' | 'poster' | 'stage'): string {
  const list = e?.posterList;
  if (Array.isArray(list)) {
    for (const p of list) {
      if (p?.fileType === type && trim(p?.fileUrl)) return trim(p.fileUrl);
    }
  }
  if (type === 'icon') {
    return trim(e?.iconUrl || e?.icon || e?.coverUrl || e?.cover || e?.posterUrl || e?.poster || e?.imageUrl || e?.image);
  }
  if (type === 'poster') {
    return trim(e?.posterUrl || e?.poster || e?.coverUrl || e?.cover || e?.iconUrl || e?.icon || e?.imageUrl || e?.image);
  }
  return trim(e?.backdropUrl || e?.backdrop || e?.landscapeUrl || e?.landscape || e?.wideImage || e?.bannerImage);
}

function genresOf(e: any): string[] {
  const raw = trim(e?.tags);
  if (!raw) return [];
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

function inferType(raw: any, fallbackCategory: string): MediaItem['type'] {
  const cat = (fallbackCategory || '').toLowerCase();
  const cType = Number(raw?.contentType);
  if (cat === 'anime') return 'anime';
  if (cat === 'infantil' || cat === 'kids') return 'kids';
  if (cType === 2 || cat === 'serie' || cat === 'series') return 'series';
  return 'movie';
}

function itemFromAsset(raw: any, fallbackCategory = ''): MediaItem | null {
  const id = trim(raw?.contentId || raw?.id);
  const title = trim(raw?.name || raw?.title);
  if (!id || !title) return null;
  const poster = imageOf(raw, 'poster') || imageOf(raw, 'icon') || imageOf(raw, 'stage');
  const backdrop = imageOf(raw, 'stage') || poster;
  return {
    id,
    title,
    poster,
    backdrop,
    rating: trim(raw?.score || raw?.rating),
    year: trim(raw?.year || raw?.releaseTime || '').slice(0, 4),
    quality: trim(raw?.quality || raw?.definition || 'HD'),
    category: fallbackCategory,
    type: inferType(raw, fallbackCategory),
    genres: genresOf(raw),
    description: trim(raw?.description || raw?.shortDescription || raw?.introduce),
    contentType: Number(raw?.contentType) || undefined,
  };
}

export function dedupMedia(items: MediaItem[]): MediaItem[] {
  const seenIds = new Set<string>();
  const seenKeys = new Set<string>();
  const out: MediaItem[] = [];
  for (const item of items) {
    if (!item?.id || seenIds.has(item.id)) continue;
    const normTitle = (item.title || '').toLowerCase().replace(/[^a-z0-9áéíóúñ]/gi, '');
    const key = normTitle ? `${normTitle}|${item.year || ''}|${item.type || ''}` : item.id;
    if (seenKeys.has(key)) continue;
    seenIds.add(item.id);
    seenKeys.add(key);
    out.push(item);
  }
  return out;
}

// ── Public Catalog / Search / Detail / Resolve ──────────────────────────────
const treeCache: Record<string, { at: number; items: MediaItem[] }> = {};
const searchCache: Record<string, { at: number; items: MediaItem[]; total?: number }> = {};
const playCache: Record<string, { at: number; data: any }> = {};
let slbCache: { at: number; slb: any } | null = null;
let liveCategoriesCache: LiveCategory[] | null = null;
const liveResolveCache: Record<string, { at: number; stream: ResolvedStream }> = {};

export async function getHome(root: string, pageNum = 1): Promise<{ root: string; items: MediaItem[] }> {
  const r = ROOT_CODES[root] ? root : 'movies';
  const key = `${r}:${pageNum}`;
  const cached = treeCache[key];
  if (cached && Date.now() - cached.at < TREE_TTL) {
    return { root: r, items: cached.items };
  }
  const resp = await portalCall('getNextColumns', {
    columnCode: ROOT_CODES[r],
    pageNum,
    pageSize: 60,
    version: '',
  });
  const list = resp?.recommendList || [];
  const items: MediaItem[] = [];
  const cat = ROOT_CATEGORY[r] || '';
  for (const row of list) {
    for (const asset of row?.assetList || []) {
      const m = itemFromAsset(asset, cat);
      if (m) items.push(m);
    }
  }
  const clean = dedupMedia(items);
  treeCache[key] = { at: Date.now(), items: clean };
  return { root: r, items: clean };
}

export async function searchCatalog(
  query: string,
  pageNum = 1,
): Promise<{ items: MediaItem[]; total?: number }> {
  const q = trim(query);
  if (!q) return { items: [] };
  const key = `${q.toLowerCase()}:p${pageNum}`;
  const cached = searchCache[key];
  if (cached && Date.now() - cached.at < SEARCH_TTL) {
    return { items: cached.items, total: cached.total };
  }
  const resp = await portalCall('v3/searchByName', {
    value: q,
    type: '0',
    columnId: '',
    filter: '',
    pageNum,
    pageSize: 50,
  });
  const items: MediaItem[] = [];
  for (const block of resp?.searchItemList || []) {
    for (const raw of block?.itemList || []) {
      const m = itemFromAsset(raw);
      if (m) items.push(m);
    }
  }
  const clean = dedupMedia(items);
  const total = typeof resp?.totalSize === 'number' ? resp.totalSize : clean.length;
  searchCache[key] = { at: Date.now(), items: clean, total };
  return { items: clean, total };
}

export async function getDetail(contentId: string): Promise<MediaDetail> {
  const resp = await portalCall('v4/getItemData', {
    contentId: trim(contentId),
    type: '0',
    sortType: '0',
    language: 'en',
    macAddr: FIXED_MAC,
  });
  const base = itemFromAsset(resp) || {
    id: contentId,
    title: trim(resp?.name || 'Sin título'),
    poster: '',
    type: 'movie',
  };
  const epsRaw = Array.isArray(resp?.episodeList) ? resp.episodeList : [];
  const episodes: Episode[] = epsRaw
    .filter(Boolean)
    .map((c: any, idx: number) => ({
      id: trim(c.contentId),
      episodeId: trim(c.contentId),
      contentId: trim(c.contentId),
      number: c.seriesNumber != null ? Number(c.seriesNumber) : idx + 1,
      title: trim(c.name || `Episodio ${idx + 1}`),
      duration: trim(c.duration),
      thumbnail: trim(c.picture || c.pic || c.image || c.cover || c.posterUrl || c.poster),
    }));

  const seasonsRaw = Array.isArray(resp?.sameSeasonSeriesList) ? resp.sameSeasonSeriesList : [];
  const seasons: Season[] = seasonsRaw
    .filter((s: any) => s && trim(s.contentId))
    .map((s: any, idx: number) => ({
      id: trim(s.contentId),
      number: Number(s.seasonNumber || idx + 1),
      name: `Temporada ${s.seasonNumber || idx + 1}`,
      episodes: trim(s.contentId) === trim(contentId) ? episodes : [],
    }));

  return {
    ...base,
    synopsis: trim(resp?.description || resp?.introduce || base.description),
    cast: trim(resp?.actor) ? trim(resp.actor).split(',').map((s) => s.trim()).filter(Boolean) : [],
    director: trim(resp?.director),
    duration: trim(resp?.duration),
    episodes,
    seasons: seasons.length > 0 ? seasons : episodes.length > 0 ? [{ number: 1, name: 'Temporada 1', episodes }] : [],
    // Keep raw season IDs mapped in description/season name if needed; we also expose a helper below
  };
}

export async function getDetailSeasonIds(contentId: string): Promise<Array<{ id: string; number: number }>> {
  const resp = await portalCall('v4/getItemData', {
    contentId: trim(contentId),
    type: '0',
    sortType: '0',
    language: 'en',
    macAddr: FIXED_MAC,
  });
  const seasonsRaw = Array.isArray(resp?.sameSeasonSeriesList) ? resp.sameSeasonSeriesList : [];
  return seasonsRaw
    .filter((s: any) => s && trim(s.contentId))
    .map((s: any, idx: number) => ({
      id: trim(s.contentId),
      number: Number(s.seasonNumber || idx + 1),
    }));
}

function durationSeconds(val: unknown): number {
  const s = trim(val);
  if (!s) return 0;
  if (s.includes(':')) {
    const parts = s.split(':').map((p) => Number(p) || 0);
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
  }
  const n = Number(s) || 0;
  return n > 100000 ? n / 1000 : n;
}

function audioPenalty(track: any): number {
  const a = trim(track?.audioInfo || track?.audio || track?.language).toLowerCase();
  if (!a) return 0;
  if (/latino|latam|419|\b(?:mx|co|ar|cl|pe|ve|ec|uy|py|bo|do|pr)\b|am[eé]rica latina/.test(a)) return 0;
  if (/^(?:es|spa|esp)\b|español|spanish/.test(a)) return /españa|espana|castellano|\bes\b/.test(a) ? 400 : 50;
  if (/^(?:en|eng|ing)\b|english|ingl[eé]s/.test(a)) return 250;
  if (/^(?:pt|por|bra)\b|portugu[eé]s|brasil|brazil/.test(a)) return 1500;
  return 300;
}

function trackScore(t: any): number {
  const enc = trim(t?.encodeFormat).toLowerCase().replace(/[^a-z0-9]/g, '');
  const fmt = trim(t?.videoFormat).toLowerCase();
  const h = Number(String(t?.quality || '').replace(/[^0-9]/g, '')) || 720;
  let score = enc.includes('h264') || enc.includes('avc') ? 0 : enc.includes('h265') || enc.includes('hevc') ? 80 : 160;
  if (fmt !== 'mp4') score += 2000;
  score += h >= 1000 && h < 2000 ? 1000 : h >= 700 && h < 1000 ? 2000 : 3000;
  return score + audioPenalty(t);
}

function withHttps(addr: string): string {
  const s = trim(addr).replace(/\/+$/, '').replace(/^http:\/\//i, 'https://');
  return s.startsWith('https://') ? s : `https://${s}`;
}

async function getSlbInfo(): Promise<any> {
  if (slbCache && Date.now() < slbCache.at + SLB_TTL) return slbCache.slb;
  const bean = {
    hasPay: '0',
    userIdentity: '1',
    type: 'merge',
    appVer: APK_VERSION,
    lang: 'es',
    encMediaSupported: 1,
    liveCodeList: ['masnew_live'],
    appParams: '',
    reserve1: FIXED_RESERVE1,
    pipFlag: '0',
  };
  let slb: any;
  try {
    slb = await portalCall('v15/getSlbInfo', bean);
  } catch {
    slb = await portalCall('v14/getSlbInfo', bean);
  }
  slbCache = { at: Date.now(), slb };
  return slb;
}

export async function resolveVod(
  contentId: string,
  seriesContentId = '',
  trackIndex = 0,
): Promise<ResolvedStream> {
  const key = `${trim(contentId)}:${trim(seriesContentId)}`;
  let playData = playCache[key]?.data;
  if (!playData || Date.now() > playCache[key].at + PLAY_TTL) {
    const resp = await portalCall('v10/startPlayVOD', {
      contentId: trim(contentId),
      seriesContentId: trim(seriesContentId),
      startTime: 0,
      type: '1',
      columnId: 0,
      authType: '',
    });
    const ep = resp?.episodeList?.[0];
    if (!ep) throw new Error('El portal no devolvió pistas de vídeo');
    const rawTracks: any[] = [];
    for (const tm of ep.totalMovieList || []) {
      for (const m of tm?.movieList || []) {
        if (m && trim(m.contentId)) rawTracks.push(m);
      }
    }
    if (!rawTracks.length) throw new Error('Sin pistas de vídeo disponibles');
    rawTracks.sort((a, b) => trackScore(a) - trackScore(b));
    playData = { play: resp, episode: ep, tracks: rawTracks };
    playCache[key] = { at: Date.now(), data: playData };
  }

  const tracks: any[] = playData.tracks;
  const idx = trackIndex >= 0 && trackIndex < tracks.length ? trackIndex : 0;
  const chosen = tracks[idx];
  const license = trim(chosen?.licenseList?.[0]?.license);
  if (!license) throw new Error('El portal no devolvió licencia de reproducción');

  const slb = await getSlbInfo();
  const cdns: Array<{ bases: string[]; auth: string }> = [];
  for (const c of slb?.cdn_list || []) {
    if (trim(c?.tag) !== 'vod') continue;
    for (const u of c.url_list || []) {
      const auth = trim(u?.url);
      if (!auth) continue;
      if ((trim(u?.sign_type) === 'cfl' || auth.includes('sign_type=cfl')) && trim(u?.tag) === 'free') {
        const bases = [withHttps(c.main_addr)];
        if (trim(c.spared_addr)) {
          const sp = withHttps(c.spared_addr);
          if (!bases.includes(sp)) bases.push(sp);
        }
        cdns.push({ bases, auth });
        break;
      }
    }
  }
  if (!cdns.length) {
    for (const c of slb?.cdn_list || []) {
      if (trim(c?.tag) !== 'vod') continue;
      for (const u of c.url_list || []) {
        const auth = trim(u?.url);
        if (auth && (trim(u?.tag) === 'free' || auth.includes('tag=free'))) {
          const bases = [withHttps(c.main_addr)];
          if (trim(c.spared_addr)) {
            const sp = withHttps(c.spared_addr);
            if (!bases.includes(sp)) bases.push(sp);
          }
          cdns.push({ bases, auth });
          break;
        }
      }
    }
  }
  if (!cdns.length) throw new Error('El portal no expuso CDN de VOD libre');

  const ext = trim(chosen.videoFormat).toLowerCase() === 'ts' ? 'ts' : 'mp4';
  const mediaPath = `/vod/${trim(chosen.contentId)}_media.${ext}`;
  const makeHeaders = (auth: string) => ({
    'Content-Auth': auth,
    'Content-License': license,
    'User-Agent': UA_CDN,
    App: APP_ID,
    'App-Version': APK_VERSION,
  });

  const mainUrl = cdns[0].bases[0] + mediaPath;
  const mainHeaders = makeHeaders(cdns[0].auth);
  const backups: Array<{ url: string; headers: Record<string, string> }> = [];
  for (let h = 0; h < cdns.length; h++) {
    for (let g = 0; g < cdns[h].bases.length; g++) {
      if (h === 0 && g === 0) continue;
      backups.push({ url: cdns[h].bases[g] + mediaPath, headers: makeHeaders(cdns[h].auth) });
    }
  }

  const dur = durationSeconds(
    chosen.duration || playData.episode?.duration || playData.play?.duration,
  );
  const port = XuperNative.getLocalServerPort();
  const streamToken = XuperNative.registerStream(
    mainUrl,
    JSON.stringify(mainHeaders),
    dur,
    JSON.stringify(backups),
    false,
  );
  const proxyUrl =
    ext === 'ts'
      ? `http://127.0.0.1:${port}/media/${streamToken}/playlist.m3u8`
      : `http://127.0.0.1:${port}/media/${streamToken}/video.mp4`;

  const subtitles: SubtitleTrack[] = [];
  for (const sub of playData.episode?.subtitleList || []) {
    const f = sub?.file?.[0];
    if (trim(f?.url)) {
      const rawUrl = trim(f.url);
      const subToken = XuperNative.registerSubtitle(rawUrl);
      subtitles.push({
        lang: trim(sub.language),
        name: trim(sub.language || 'Subtítulo'),
        url: rawUrl,
        proxyUrl: `http://127.0.0.1:${port}/sub/${subToken}.srt`,
      });
    }
  }

  const allTracks: TrackInfo[] = tracks.map((t, i) => ({
    quality: trim(t.quality || 'HD'),
    audio: trim(t.audioInfo || 'Audio'),
    audioLang: trim(t.audioInfo),
    format: trim(t.videoFormat || 'mp4'),
    bitrate: trim(t.bitrate),
    duration: durationSeconds(t.duration),
    qualityIdx: i,
    audioIdx: i,
  }));

  return {
    streamUrl: mainUrl,
    proxyUrl,
    headers: mainHeaders,
    backups: backups.map((b) => b.url),
    format: ext,
    quality: trim(chosen.quality || 'HD'),
    audio: trim(chosen.audioInfo || 'Latino'),
    duration: dur,
    subtitles,
    allTracks,
  };
}

// ── Live TV ─────────────────────────────────────────────────────────────────
export async function getLiveCategories(): Promise<LiveCategory[]> {
  if (liveCategoriesCache?.length) return liveCategoriesCache;
  const resp = await portalCall('getNextColumns', {
    columnCode: 'masnew_live',
    pageNum: 1,
    pageSize: 200,
    version: '',
  });
  const cats: LiveCategory[] = [];
  for (const item of resp?.recommendList || []) {
    if (!item?.columnId) continue;
    const name = trim(item.name || item.title || item.alias || `Categoría ${cats.length + 1}`);
    cats.push({
      id: String(item.columnId),
      name,
      count: 0,
      isAdult: /adult|\+18|xxx|hot|er[oó]t/i.test(name),
    });
  }
  liveCategoriesCache = cats;
  return cats;
}

export async function getLiveChannels(
  columnId = '76182',
  pageNum = 1,
  pageSize = 250,
): Promise<LiveChannel[]> {
  const resp = await portalCall('v6/getLiveData', {
    columnId: columnId && columnId !== 'all' ? Number(columnId) || columnId : 76182,
    dataVersion: '',
    pageSize,
    pageNum,
    expireTimeStr: '',
  });
  const list = resp?.channelList || [];
  const seen = new Set<string>();
  const out: LiveChannel[] = [];
  for (const ch of list) {
    const code = trim(ch?.channelCode);
    if (!code || seen.has(code)) continue;
    seen.add(code);
    const logo = trim(ch.posterUrl) || trim(ch.posterList?.[0]?.fileUrl);
    out.push({
      id: code,
      number: String(ch.channelNumber || out.length + 1),
      name: trim(ch.name || ch.alias || `Canal ${out.length + 1}`),
      logo,
      category: columnId,
      categoryId: columnId,
      currentProgram: 'En vivo',
      quality: ch.quality === '3' ? 'UHD' : 'HD',
    });
  }
  return out;
}

export async function resolveLive(channelCode: string, force = false): Promise<ResolvedStream> {
  const cached = liveResolveCache[channelCode];
  if (!force && cached && Date.now() - cached.at < LIVE_RESOLVE_CACHE_MS) {
    return cached.stream;
  }

  let playResp: any = null;
  for (const bean of [
    { channelCode, type: '1' },
    { channelCode, columnId: '76182', type: '1' },
    { channelCode, columnId: 0, type: '1' },
  ]) {
    try {
      playResp = await portalCall('v4/startPlayLive', bean);
      if (playResp?.liveAddressList?.length) break;
    } catch {
      // try next variant
    }
  }
  const addrs = playResp?.liveAddressList || [];
  const chosen = addrs.find((a: any) => a?.playCode && a?.license) || addrs[0];
  if (!chosen?.license) throw new Error('El portal no devolvió licencia para el canal');

  const playCode = trim(chosen.playCode) || channelCode;
  const license = trim(chosen.license);
  const slb = await getSlbInfo();

  const cdns: Array<{ cflHost: string; authBase: string }> = [];
  const seenHosts = new Set<string>();
  const addCdn = (addr: string, authBase: string) => {
    const host = trim(addr).replace(/^https?:\/\//i, '').split('/')[0];
    if (host && !seenHosts.has(host)) {
      seenHosts.add(host);
      cdns.push({ cflHost: host, authBase });
    }
  };

  for (const c of slb?.cdn_list || []) {
    if (c?.tag !== 'live') continue;
    for (const u of c.url_list || []) {
      const d = trim(u?.url);
      if (u?.sign_type === 'cfl' || d.includes('sign_type=cfl')) {
        addCdn(c.main_addr, d);
        if (c.spared_addr) addCdn(c.spared_addr, d);
      }
    }
  }
  if (!cdns.length) throw new Error('CDN de TV en vivo vacía');

  const makeLiveHeaders = (entry: { authBase: string }) => {
    const m = entry.authBase.match(/token=([0-9a-fA-F]{32})/);
    const token = m ? m[1] : '';
    const moment = Date.now();
    const s2 = signO3(token, moment);
    return {
      'Content-Auth': `${entry.authBase}&sign2_method=sign_o3&instance=0&start_moment=${moment}&sign2=${s2}`,
      'Content-License': license,
      'User-Agent': UA_CDN,
      App: APP_ID,
      'App-Version': APK_VERSION,
      'X-Buffer': '0',
    };
  };

  const mainUrl = `http://${cdns[0].cflHost}/live/${playCode}.m3u8`;
  const mainHeaders = makeLiveHeaders(cdns[0]);
  const backups = cdns.slice(1).map((c) => ({
    url: `http://${c.cflHost}/live/${playCode}.m3u8`,
    headers: makeLiveHeaders(c),
  }));

  const port = XuperNative.getLocalServerPort();
  const streamToken = XuperNative.registerStream(
    mainUrl,
    JSON.stringify(mainHeaders),
    0,
    JSON.stringify(backups),
    true,
  );
  const proxyUrl = `http://127.0.0.1:${port}/media/${streamToken}/index.m3u8`;

  const result: ResolvedStream = {
    streamUrl: mainUrl,
    proxyUrl,
    headers: mainHeaders,
    backups: backups.map((b) => b.url),
    format: 'hls',
  };
  liveResolveCache[channelCode] = { at: Date.now(), stream: result };
  return result;
}

export function getSeedStats(): { total: number; usable: number; sn: string; host: string } {
  return {
    total: seedPool.length,
    usable: usableSeeds().length,
    sn: session.sn ? session.sn.slice(0, 12) + '…' : 'sin sesión',
    host: preferredHost || HOSTS[0],
  };
}

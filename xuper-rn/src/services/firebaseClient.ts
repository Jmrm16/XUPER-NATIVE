import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AuthUser, EpisodeProgressEntry, MediaItem, WatchProgressItem } from './types';

const FIREBASE_API_KEY = 'AIzaSyDwXUJajmOgLGNtg-nWk-1M7GBaY25kFGg';
const RTDB_URL = 'https://streaming-47a7d-default-rtdb.firebaseio.com';

const STORAGE_AUTH = '@xuper/auth_user_v1';
const STORAGE_HISTORY = '@xuper/watch_history_v1';
const STORAGE_EP_PROGRESS = '@xuper/ep_progress_v1';
const STORAGE_FAVORITES = '@xuper/favorites_v1';

function sanitizeKey(k: string): string {
  return String(k || '').replace(/[.#$\[\]/]/g, '_');
}

async function jsonPost(url: string, body: Record<string, unknown>): Promise<any> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    const code = data?.error?.message || `HTTP_${res.status}`;
    throw new Error(mapFirebaseError(code));
  }
  return data;
}

function mapFirebaseError(code: string): string {
  if (code.includes('EMAIL_NOT_FOUND') || code.includes('INVALID_LOGIN_CREDENTIALS')) {
    return 'Correo o contraseña incorrectos.';
  }
  if (code.includes('INVALID_PASSWORD')) return 'Contraseña incorrecta.';
  if (code.includes('EMAIL_EXISTS')) return 'Este correo ya está registrado.';
  if (code.includes('WEAK_PASSWORD')) return 'La contraseña debe tener al menos 6 caracteres.';
  if (code.includes('INVALID_EMAIL')) return 'El correo no es válido.';
  if (code.includes('TOO_MANY_ATTEMPTS')) return 'Demasiados intentos. Espera un momento.';
  return code;
}

// ── Auth State & Session ────────────────────────────────────────────────────
let currentUser: AuthUser | null = null;

export async function loadStoredUser(): Promise<AuthUser | null> {
  if (currentUser) return currentUser;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_AUTH);
    if (!raw) return null;
    const parsed: AuthUser = JSON.parse(raw);
    if (parsed.refreshToken && Date.now() > parsed.expiresAt - 60000) {
      return await refreshAuthSession(parsed);
    }
    currentUser = parsed;
    return parsed;
  } catch {
    return null;
  }
}

async function saveUser(user: AuthUser | null): Promise<void> {
  currentUser = user;
  if (user) {
    await AsyncStorage.setItem(STORAGE_AUTH, JSON.stringify(user));
  } else {
    await AsyncStorage.removeItem(STORAGE_AUTH);
  }
}

export async function refreshAuthSession(user: AuthUser): Promise<AuthUser | null> {
  try {
    const res = await fetch(`https://securetoken.googleapis.com/v1/token?key=${FIREBASE_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(user.refreshToken)}`,
    });
    const data = await res.json();
    if (!res.ok || !data.id_token) return user;
    const updated: AuthUser = {
      ...user,
      idToken: data.id_token,
      refreshToken: data.refresh_token || user.refreshToken,
      expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000,
    };
    await saveUser(updated);
    return updated;
  } catch {
    return user;
  }
}

async function getValidToken(): Promise<{ uid: string; idToken: string } | null> {
  const u = await loadStoredUser();
  if (!u || !u.emailVerified) return null;
  if (Date.now() > u.expiresAt - 60000) {
    const ref = await refreshAuthSession(u);
    if (!ref) return null;
    return { uid: ref.uid, idToken: ref.idToken };
  }
  return { uid: u.uid, idToken: u.idToken };
}

export async function signInWithEmail(email: string, password: string): Promise<AuthUser> {
  const data = await jsonPost(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`,
    { email: email.trim(), password, returnSecureToken: true },
  );
  const lookup = await jsonPost(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_API_KEY}`,
    { idToken: data.idToken },
  );
  const info = lookup?.users?.[0] || {};
  const user: AuthUser = {
    uid: data.localId,
    email: data.email || email.trim(),
    displayName: info.displayName || data.displayName || email.split('@')[0],
    emailVerified: Boolean(info.emailVerified),
    idToken: data.idToken,
    refreshToken: data.refreshToken,
    expiresAt: Date.now() + Number(data.expiresIn || 3600) * 1000,
  };
  await saveUser(user);
  return user;
}

export async function signUpWithEmail(
  email: string,
  password: string,
  displayName: string,
): Promise<AuthUser> {
  const data = await jsonPost(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_API_KEY}`,
    { email: email.trim(), password, returnSecureToken: true },
  );
  if (displayName.trim()) {
    await jsonPost(
      `https://identitytoolkit.googleapis.com/v1/accounts:update?key=${FIREBASE_API_KEY}`,
      { idToken: data.idToken, displayName: displayName.trim(), returnSecureToken: false },
    ).catch(() => {});
  }
  await jsonPost(
    `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${FIREBASE_API_KEY}`,
    { requestType: 'VERIFY_EMAIL', idToken: data.idToken },
  ).catch(() => {});

  const user: AuthUser = {
    uid: data.localId,
    email: data.email || email.trim(),
    displayName: displayName.trim() || email.split('@')[0],
    emailVerified: false,
    idToken: data.idToken,
    refreshToken: data.refreshToken,
    expiresAt: Date.now() + Number(data.expiresIn || 3600) * 1000,
  };
  await saveUser(user);
  return user;
}

export async function checkEmailVerified(): Promise<AuthUser | null> {
  const u = await loadStoredUser();
  if (!u) return null;
  const lookup = await jsonPost(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_API_KEY}`,
    { idToken: u.idToken },
  );
  const info = lookup?.users?.[0];
  if (!info) return u;
  const updated: AuthUser = { ...u, emailVerified: Boolean(info.emailVerified) };
  await saveUser(updated);
  return updated;
}

export async function resendVerificationEmail(): Promise<void> {
  const u = await loadStoredUser();
  if (!u) throw new Error('No hay sesión activa');
  await jsonPost(
    `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${FIREBASE_API_KEY}`,
    { requestType: 'VERIFY_EMAIL', idToken: u.idToken },
  );
}

export async function sendPasswordReset(email: string): Promise<void> {
  await jsonPost(
    `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${FIREBASE_API_KEY}`,
    { requestType: 'PASSWORD_RESET', email: email.trim() },
  );
}

export async function signOutUser(): Promise<void> {
  await saveUser(null);
}

// ── Watch History ───────────────────────────────────────────────────────────
export async function getWatchHistory(): Promise<WatchProgressItem[]> {
  let local: Record<string, WatchProgressItem> = {};
  try {
    const raw = await AsyncStorage.getItem(STORAGE_HISTORY);
    if (raw) local = JSON.parse(raw);
  } catch {
    local = {};
  }

  const auth = await getValidToken();
  if (auth) {
    try {
      const res = await fetch(`${RTDB_URL}/users/${auth.uid}/watchHistory.json?auth=${auth.idToken}`);
      if (res.ok) {
        const remote = await res.json();
        if (remote && typeof remote === 'object') {
          for (const [k, v] of Object.entries<any>(remote)) {
            if (v && (!local[k] || (v.updatedAt || 0) > (local[k].updatedAt || 0))) {
              local[k] = v;
            }
          }
          await AsyncStorage.setItem(STORAGE_HISTORY, JSON.stringify(local));
        }
      }
    } catch {
      // keep local
    }
  }

  return Object.values(local)
    .filter((i) => i && i.mediaId)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, 40);
}

export async function saveWatchProgress(item: WatchProgressItem): Promise<void> {
  const key = sanitizeKey(item.mediaId);
  const next: WatchProgressItem = { ...item, updatedAt: Date.now() };
  try {
    const raw = await AsyncStorage.getItem(STORAGE_HISTORY);
    const map: Record<string, WatchProgressItem> = raw ? JSON.parse(raw) : {};
    map[key] = next;
    await AsyncStorage.setItem(STORAGE_HISTORY, JSON.stringify(map));
  } catch {
    // ignore
  }

  if (item.episodeId) {
    await saveEpisodeProgress(item.mediaId, item.episodeId, {
      currentTime: item.currentTime,
      duration: item.duration,
      progressPercent: item.progressPercent,
      completed: item.progressPercent >= 90,
      updatedAt: next.updatedAt,
    });
  }

  const auth = await getValidToken();
  if (auth) {
    fetch(`${RTDB_URL}/users/${auth.uid}/watchHistory/${key}.json?auth=${auth.idToken}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next),
    }).catch(() => {});
  }
}

export async function saveEpisodeProgress(
  seriesId: string,
  episodeId: string,
  entry: EpisodeProgressEntry,
): Promise<void> {
  const sKey = sanitizeKey(seriesId);
  const eKey = sanitizeKey(episodeId);
  try {
    const raw = await AsyncStorage.getItem(STORAGE_EP_PROGRESS);
    const map: Record<string, Record<string, EpisodeProgressEntry>> = raw ? JSON.parse(raw) : {};
    if (!map[sKey]) map[sKey] = {};
    map[sKey][eKey] = entry;
    await AsyncStorage.setItem(STORAGE_EP_PROGRESS, JSON.stringify(map));
  } catch {
    // ignore
  }

  const auth = await getValidToken();
  if (auth) {
    fetch(
      `${RTDB_URL}/users/${auth.uid}/episodeProgress/${sKey}/${eKey}.json?auth=${auth.idToken}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
      },
    ).catch(() => {});
  }
}

export async function getSeriesEpisodeProgress(
  seriesId: string,
): Promise<Record<string, EpisodeProgressEntry>> {
  const sKey = sanitizeKey(seriesId);
  let out: Record<string, EpisodeProgressEntry> = {};
  try {
    const raw = await AsyncStorage.getItem(STORAGE_EP_PROGRESS);
    if (raw) {
      const map = JSON.parse(raw);
      if (map?.[sKey]) out = map[sKey];
    }
  } catch {
    // ignore
  }

  const auth = await getValidToken();
  if (auth) {
    try {
      const res = await fetch(
        `${RTDB_URL}/users/${auth.uid}/episodeProgress/${sKey}.json?auth=${auth.idToken}`,
      );
      if (res.ok) {
        const remote = await res.json();
        if (remote && typeof remote === 'object') {
          out = { ...out, ...remote };
        }
      }
    } catch {
      // ignore
    }
  }
  return out;
}

// ── Favorites ───────────────────────────────────────────────────────────────
export async function getFavorites(): Promise<MediaItem[]> {
  let local: Record<string, MediaItem> = {};
  try {
    const raw = await AsyncStorage.getItem(STORAGE_FAVORITES);
    if (raw) local = JSON.parse(raw);
  } catch {
    local = {};
  }

  const auth = await getValidToken();
  if (auth) {
    try {
      const res = await fetch(`${RTDB_URL}/users/${auth.uid}/favorites.json?auth=${auth.idToken}`);
      if (res.ok) {
        const remote = await res.json();
        if (remote && typeof remote === 'object') {
          local = { ...local, ...remote };
          await AsyncStorage.setItem(STORAGE_FAVORITES, JSON.stringify(local));
        }
      }
    } catch {
      // ignore
    }
  }

  return Object.values(local).filter((m) => m && m.id);
}

export async function toggleFavorite(item: MediaItem): Promise<boolean> {
  const key = sanitizeKey(item.id);
  let map: Record<string, MediaItem> = {};
  try {
    const raw = await AsyncStorage.getItem(STORAGE_FAVORITES);
    if (raw) map = JSON.parse(raw);
  } catch {
    map = {};
  }

  const added = !map[key];
  if (added) {
    map[key] = item;
  } else {
    delete map[key];
  }
  await AsyncStorage.setItem(STORAGE_FAVORITES, JSON.stringify(map));

  const auth = await getValidToken();
  if (auth) {
    fetch(`${RTDB_URL}/users/${auth.uid}/favorites/${key}.json?auth=${auth.idToken}`, {
      method: added ? 'PUT' : 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: added ? JSON.stringify(item) : undefined,
    }).catch(() => {});
  }
  return added;
}

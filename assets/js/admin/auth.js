// Admin sign-in state: repository, branch and the GitHub token.
//
// The token lives in sessionStorage (until the tab closes) by default, or in
// localStorage ("On this device") when the user asks for it. It is never logged,
// never put in a URL and never written anywhere else.

const KEY = "mca-admin-session";
const SIGN_IN_PAGE = "index.html"; // admin/index.html, relative to the admin pages

function readFrom(storage) {
  try {
    const data = JSON.parse(storage.getItem(KEY));
    if (data && data.token && data.repo && data.branch) return data;
  } catch {
    // Storage unavailable or corrupt: treat as signed out.
  }
  return null;
}

/**
 * Save a sign-in. Clears any previous one from both storages first.
 * @param {{repo: string, branch: string, token: string, persist?: boolean}} session
 *   `persist: true` stores it in localStorage, otherwise sessionStorage.
 */
export function saveSession({ repo, branch, token, persist = false }) {
  clearToken();
  const storage = persist ? localStorage : sessionStorage;
  storage.setItem(KEY, JSON.stringify({ repo, branch, token, persist }));
}

/**
 * The current sign-in, if any.
 * @returns {?{repo: string, branch: string, token: string, persist: boolean}}
 */
export function getSession() {
  const found = readFrom(sessionStorage) || readFrom(localStorage);
  return found ? { ...found, persist: Boolean(found.persist) } : null;
}

/** @returns {?string} The stored token, or null when signed out. */
export function getToken() {
  const session = getSession();
  return session ? session.token : null;
}

/** Forget the token everywhere (both storages). */
export function clearToken() {
  for (const storage of [sessionStorage, localStorage]) {
    try {
      storage.removeItem(KEY);
    } catch {
      // Ignore blocked storage.
    }
  }
}

/**
 * Guard for admin pages: returns the session, or redirects to the sign-in page and returns null.
 * @returns {?{repo: string, branch: string, token: string, persist: boolean}}
 */
export function requireAuth() {
  const session = getSession();
  if (!session) {
    location.replace(SIGN_IN_PAGE);
    return null;
  }
  return session;
}

'use client';
import { create } from 'zustand';
import type { User } from './api';
import {
  auth,
  ensureSessionMatchesRole,
  ensureFreshSession,
  refreshAccessToken,
  setAccessToken,
} from './api';

interface AuthState {
  user: User | null;
  token: string | null;
  loading: boolean;
  setAuth: (token: string, user: User) => void;
  clearAuth: () => void;
  loadFromStorage: () => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  token: null,
  loading: false,

  setAuth: (token, user) => {
    // The access token is kept in memory only (see lib/api.ts). We still cache
    // the non-sensitive user object so a relaunch can paint instantly before
    // the token is re-minted from the refresh cookie.
    setAccessToken(token);
    localStorage.setItem('cleanops_user', JSON.stringify(user));
    set({ user, token, loading: false });
  },

  clearAuth: () => {
    setAccessToken(null);
    localStorage.removeItem('cleanops_token'); // clear any legacy persisted token
    localStorage.removeItem('cleanops_user');
    set({ user: null, token: null, loading: false });
  },

  loadFromStorage: async () => {
    // Option B: the access token is never persisted. Paint instantly from the
    // cached (non-sensitive) user object so a home-screen relaunch doesn't
    // flash the login screen, then re-mint the token from the httpOnly refresh
    // cookie. That cookie — first-party, 90 days, rotated on each refresh, not
    // subject to Safari's 7-day script-storage cap — is what keeps a PWA user
    // logged in across app switches and cold launches.
    const userStr = localStorage.getItem('cleanops_user');
    let hadCachedUser = false;
    if (userStr) {
      try {
        set({ user: JSON.parse(userStr) as User, loading: false });
        hadCachedUser = true;
      } catch {
        // corrupted cache
      }
    }
    if (!hadCachedUser) set({ loading: true });

    let token: string | null = null;
    try {
      token = await refreshAccessToken();
    } catch {
      // Transient (offline / server blip) on launch: keep the cached session
      // and stop loading. The next request or foreground refresh retries — we
      // do NOT log the user out over a dropped connection.
      set({ loading: false });
      return;
    }

    if (!token) {
      // Server says we're genuinely signed out.
      get().clearAuth();
      return;
    }

    try {
      const user = await auth.me();
      set({ user, token, loading: false });
      localStorage.setItem('cleanops_user', JSON.stringify(user));
      // If the fresh token's role disagrees with the server, re-mint it.
      ensureSessionMatchesRole(user.role).catch(() => {});
    } catch (e) {
      const status = (e as { status?: number })?.status;
      if (status === 401 || status === 403) {
        get().clearAuth(); // account no longer valid
      } else {
        set({ user: get().user, token, loading: false }); // transient — keep the session
      }
    }
  },

  logout: async () => {
    try { await auth.logout(); } catch { /* ignore */ }
    get().clearAuth();
    window.location.href = '/login';
  },
}));

// Proactively refresh the access token when a home-screen/PWA user returns to
// the app (switched away and back, or woke a sleeping phone), so their next
// action and the socket reconnect use a valid token instead of hitting a 401
// first. Failures are ignored — only an explicit signed-out response ends the
// session, so a brief network blip on return never logs anyone out.
if (typeof window !== 'undefined') {
  const refreshOnForeground = () => {
    if (document.visibilityState === 'visible' && useAuth.getState().user) {
      ensureFreshSession().catch(() => {});
    }
  };
  document.addEventListener('visibilitychange', refreshOnForeground);
  window.addEventListener('focus', refreshOnForeground);
}

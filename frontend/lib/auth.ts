'use client';
import { create } from 'zustand';
import type { User } from './api';
import { auth } from './api';

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
    localStorage.setItem('cleanops_token', token);
    localStorage.setItem('cleanops_user', JSON.stringify(user));
    set({ user, token, loading: false });
  },

  clearAuth: () => {
    localStorage.removeItem('cleanops_token');
    localStorage.removeItem('cleanops_user');
    set({ user: null, token: null, loading: false });
  },

  loadFromStorage: async () => {
    const token = localStorage.getItem('cleanops_token');
    const userStr = localStorage.getItem('cleanops_user');

    if (!token) {
      set({ loading: false });
      return;
    }

    // Restore from cache immediately so UI doesn't flash
    if (userStr) {
      try {
        const user = JSON.parse(userStr) as User;
        set({ user, token, loading: false });
      } catch {
        // corrupted cache
      }
    }

    // Verify token is still valid
    try {
      const user = await auth.me();
      set({ user, token, loading: false });
      localStorage.setItem('cleanops_user', JSON.stringify(user));
    } catch {
      get().clearAuth();
    }
  },

  logout: async () => {
    try { await auth.logout(); } catch { /* ignore */ }
    get().clearAuth();
    window.location.href = '/login';
  },
}));

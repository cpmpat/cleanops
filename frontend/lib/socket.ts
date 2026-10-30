'use client';
import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from './auth';
import { TOKEN_REFRESHED_EVENT, refreshAccessToken } from './api';

let socket: Socket | null = null;

export function getSocket(): Socket | null {
  return socket;
}

export function useSocket(
  handlers: Record<string, (data: any) => void> = {},
) {
  const { token } = useAuth();
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!token) return;

    // Create socket connection once per session
    if (!socket || !socket.connected) {
      socket = io((process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:3001') + '/ws', {
        path: '/socket.io',
        auth: { token },
        transports: ['websocket'],
        reconnection: true,
        reconnectionDelay: 1000,
        // Cleaners keep this tab open for days. With a finite attempt count the
        // socket gave up after ~5 seconds of a sleeping phone or a Wi-Fi→LTE
        // switch and never came back — the tab then showed stale data forever.
        reconnectionDelayMax: 30000,
        reconnectionAttempts: Infinity,
        randomizationFactor: 0.5,
      });

      // A reconnect whose in-memory access token has expired is rejected at the
      // handshake — common after a home-screen app was backgrounded past the
      // ~15-minute token lifetime. Minting a fresh token fires
      // TOKEN_REFRESHED, whose listener below re-arms socket.auth and bounces
      // the connection, so live data resumes with no user action. A failure
      // here is ignored; the socket keeps retrying on its own backoff.
      socket.on('connect_error', () => {
        refreshAccessToken().catch(() => {});
      });
    }

    // Register a stable wrapper per event that always calls the latest
    // handler. Until 16 Oct 2026 the first-render handler itself was
    // registered (a stale closure), and cleanup tried to remove the *current*
    // one — a different function — so handlers leaked on every unmount.
    const registered: [string, (data: any) => void][] = Object.keys(handlersRef.current).map((event) => {
      const wrapper = (data: any) => handlersRef.current[event]?.(data);
      socket!.on(event, wrapper);
      return [event, wrapper];
    });

    return () => {
      // Clean up only our registered handlers, not the socket itself
      registered.forEach(([event, wrapper]) => socket?.off(event, wrapper));
    };
  }, [token]);
}

/**
 * A socket authenticates once, at handshake. After a silent token refresh the
 * old token is still on the connection and the next reconnect would be
 * rejected — so re-arm it and bounce the connection.
 */
if (typeof window !== 'undefined') {
  window.addEventListener(TOKEN_REFRESHED_EVENT, (e: Event) => {
    const token = (e as CustomEvent<string>).detail;
    if (!socket || !token) return;
    (socket.auth as Record<string, unknown>) = { token };
    socket.disconnect().connect();
  });
}

// Convenience: disconnect on logout
/**
 * Re-run a loader whenever the tab could have missed something: socket
 * reconnect, tab regaining focus, network coming back, plus a slow poll.
 * Pair this with any screen whose data is pushed rather than requested.
 */
export function useRefreshOnReconnect(
  refresh: () => void,
  { intervalMs = 60000 }: { intervalMs?: number } = {},
) {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    const run = () => refreshRef.current();
    const onVisible = () => {
      if (document.visibilityState === 'visible') run();
    };

    socket?.on('connect', run);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', run);
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') run();
    }, intervalMs);

    return () => {
      socket?.off('connect', run);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', run);
      clearInterval(timer);
    };
  }, [intervalMs]);
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
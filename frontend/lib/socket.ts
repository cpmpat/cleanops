'use client';
import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from './auth';
import { TOKEN_REFRESHED_EVENT } from './api';

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
    }

    // Register all provided event handlers
    const registered: string[] = [];
    Object.entries(handlersRef.current).forEach(([event, handler]) => {
      socket!.on(event, handler);
      registered.push(event);
    });

    return () => {
      // Clean up only our registered handlers, not the socket itself
      registered.forEach(event => {
        socket?.off(event, handlersRef.current[event]);
      });
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
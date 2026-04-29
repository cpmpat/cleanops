'use client';
import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from './auth';

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
        reconnectionAttempts: 5,
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

// Convenience: disconnect on logout
export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
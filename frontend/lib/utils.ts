import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

export function formatDate(iso: string, locale = 'en'): string {
  try {
    return new Date(iso).toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric' });
  } catch { return iso; }
}

export function todayISO(): string {
  return new Date().toISOString().split('T')[0];
}

export function channelColor(channel: string): string {
  const map: Record<string, string> = {
    AIRBNB: '#FF5A5F', BOOKING_COM: '#003580', VRBO: '#3B5998',
    EXPEDIA: '#FFC72C', DIRECT: '#059669', OTHER: '#6b7280',
  };
  return map[channel] ?? map.OTHER;
}

import { redirect } from 'next/navigation';

/** Notifications has one section so far; the bare URL opens it. */
export default function NotifyPage() {
  redirect('/notify/data');
}

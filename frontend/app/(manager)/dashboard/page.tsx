import { redirect } from 'next/navigation';

/** Dashboard unfolds into views (Cleaning first, 20 Oct 2026); the bare URL lands on Cleaning. */
export default function DashboardPage() {
  redirect('/dashboard/cleaning');
}

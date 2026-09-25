import { redirect } from 'next/navigation';

/** Planning is two tabs now; the bare URL lands on the arrival side. */
export default function PlanningPage() {
  redirect('/planning/check-in');
}

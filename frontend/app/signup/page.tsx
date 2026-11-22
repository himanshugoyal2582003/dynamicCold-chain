import { redirect } from 'next/navigation';

// Accounts are provisioned by authorized administrators and fleet owners.
// Keeping this route prevents stale external links from exposing a public signup flow.
export default function SignupPage() {
  redirect('/login');
}

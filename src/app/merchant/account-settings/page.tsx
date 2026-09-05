import { redirect } from 'next/navigation';

// Account settings is not part of the ACG prototype — every merchant control
// lives in Policies. Redirect stragglers to the dashboard.
export default function AccountSettings() {
  redirect('/merchant');
}

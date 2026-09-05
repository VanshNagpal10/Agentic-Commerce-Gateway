import { redirect } from 'next/navigation';

// Onboarding is the homepage now — keep /onboard working for existing links,
// docs, and bookmarks.
export default function OnboardRedirect() {
  redirect('/');
}

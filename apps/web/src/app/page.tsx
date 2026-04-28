/**
 * Home page — redirects to dashboard.
 * RSC: Server component, no client-side JS needed.
 */
import { redirect } from 'next/navigation';

export default function HomePage() {
  redirect('/dashboard');
}

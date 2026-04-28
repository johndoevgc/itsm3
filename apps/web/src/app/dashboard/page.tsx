/**
 * Dashboard page.
 * RSC: Server component — fetches data server-side, no client bundle bloat.
 * WCAG 2.2 AA: Semantic HTML, ARIA labels, keyboard navigation.
 */
import { Suspense } from 'react';
import { TicketsSummary } from '@/components/TicketsSummary';
import { RecentTickets } from '@/components/RecentTickets';

export const metadata = {
  title: 'Dashboard — VGC ITSM',
};

export default function DashboardPage() {
  return (
    <main className="min-h-screen p-8" aria-label="ITSM Dashboard">
      <div className="max-w-7xl mx-auto space-y-8">
        <header>
          <h1 className="text-3xl font-bold tracking-tight">IT Service Management</h1>
          <p className="text-muted-foreground mt-1">
            Welcome back. Here&apos;s what needs your attention.
          </p>
        </header>

        <Suspense fallback={<div className="h-32 animate-pulse bg-muted rounded-xl" />}>
          <TicketsSummary />
        </Suspense>

        <Suspense fallback={<div className="h-64 animate-pulse bg-muted rounded-xl" />}>
          <RecentTickets />
        </Suspense>
      </div>
    </main>
  );
}

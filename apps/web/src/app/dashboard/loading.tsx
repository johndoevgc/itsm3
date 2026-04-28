/**
 * Loading skeleton for dashboard — shown during RSC streaming.
 * WCAG: aria-busy + aria-label for screen readers.
 */
export default function DashboardLoading() {
  return (
    <main
      className="min-h-screen p-8"
      aria-busy="true"
      aria-label="Loading dashboard"
    >
      <div className="max-w-7xl mx-auto space-y-8">
        <div className="space-y-2">
          <div className="h-8 w-64 animate-pulse bg-muted rounded-lg" />
          <div className="h-4 w-48 animate-pulse bg-muted rounded-lg" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse bg-muted rounded-xl" />
          ))}
        </div>
        <div className="h-64 animate-pulse bg-muted rounded-xl" />
      </div>
    </main>
  );
}

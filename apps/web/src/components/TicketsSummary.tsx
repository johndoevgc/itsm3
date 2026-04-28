/**
 * Tickets summary cards — RSC server component.
 * Shows open/in_progress/resolved/P1 counts.
 */
export async function TicketsSummary() {
  // In production, fetches from /api/v1/tickets with summary query
  const stats = [
    { label: 'Open Tickets', value: '—', severity: 'default' },
    { label: 'In Progress', value: '—', severity: 'default' },
    { label: 'Resolved Today', value: '—', severity: 'default' },
    { label: 'P1 Active', value: '—', severity: 'p1' },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className={`rounded-xl border p-6 shadow-sm bg-card ${
            stat.severity === 'p1' ? 'border-destructive' : 'border-border'
          }`}
          role="region"
          aria-label={stat.label}
        >
          <p className="text-sm font-medium text-muted-foreground">{stat.label}</p>
          <p
            className={`text-4xl font-bold mt-2 ${
              stat.severity === 'p1' ? 'text-destructive' : 'text-foreground'
            }`}
          >
            {stat.value}
          </p>
        </div>
      ))}
    </div>
  );
}

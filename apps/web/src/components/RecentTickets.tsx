/**
 * Recent tickets table — RSC server component.
 * Shows latest 10 tickets with severity badge and status.
 */

const SEVERITY_COLORS: Record<string, string> = {
  A: 'bg-destructive text-destructive-foreground',
  B: 'bg-orange-500 text-white',
  C: 'bg-yellow-500 text-black',
  D: 'bg-secondary text-secondary-foreground',
};

export async function RecentTickets() {
  // In production, fetches from /api/v1/tickets?limit=10
  const tickets: Array<{
    id: string;
    title: string;
    severity: string;
    status: string;
    reporterUpn: string;
    createdAt: string;
  }> = [];

  return (
    <section aria-labelledby="recent-tickets-heading" className="rounded-xl border bg-card shadow-sm">
      <div className="p-6 border-b">
        <h2 id="recent-tickets-heading" className="text-lg font-semibold">
          Recent Tickets
        </h2>
      </div>
      {tickets.length === 0 ? (
        <div className="p-12 text-center text-muted-foreground">
          <div className="text-4xl mb-4" aria-hidden="true">🎉</div>
          <p className="font-medium">All clear! No open tickets.</p>
          <p className="text-sm mt-1">Your team is on top of things.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full" role="table" aria-label="Recent tickets">
            <thead>
              <tr className="border-b text-left">
                <th scope="col" className="px-6 py-3 text-sm font-medium text-muted-foreground">Severity</th>
                <th scope="col" className="px-6 py-3 text-sm font-medium text-muted-foreground">Title</th>
                <th scope="col" className="px-6 py-3 text-sm font-medium text-muted-foreground">Status</th>
                <th scope="col" className="px-6 py-3 text-sm font-medium text-muted-foreground">Reporter</th>
                <th scope="col" className="px-6 py-3 text-sm font-medium text-muted-foreground">Created</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((ticket) => (
                <tr key={ticket.id} className="border-b last:border-0 hover:bg-muted/50 transition-colors">
                  <td className="px-6 py-4">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ${
                        SEVERITY_COLORS[ticket.severity] ?? SEVERITY_COLORS['D']
                      }`}
                    >
                      {ticket.severity}
                    </span>
                  </td>
                  <td className="px-6 py-4 font-medium max-w-xs truncate">{ticket.title}</td>
                  <td className="px-6 py-4 text-sm capitalize text-muted-foreground">{ticket.status}</td>
                  <td className="px-6 py-4 text-sm text-muted-foreground">{ticket.reporterUpn}</td>
                  <td className="px-6 py-4 text-sm text-muted-foreground">
                    {new Date(ticket.createdAt).toLocaleDateString('en-SG')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

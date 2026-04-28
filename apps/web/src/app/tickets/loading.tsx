export default function TicketsLoading() {
  return (
    <main className="min-h-screen p-8" aria-busy="true" aria-label="Loading tickets">
      <div className="max-w-7xl mx-auto space-y-4">
        <div className="h-8 w-48 animate-pulse bg-muted rounded-lg" />
        <div className="h-64 animate-pulse bg-muted rounded-xl" />
      </div>
    </main>
  );
}

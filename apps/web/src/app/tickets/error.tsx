'use client';

export default function TicketsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="min-h-screen flex items-center justify-center p-8" role="alert">
      <div className="max-w-md text-center space-y-4">
        <div className="text-6xl" aria-hidden="true">⚠️</div>
        <h1 className="text-2xl font-bold">Could not load tickets</h1>
        <p className="text-muted-foreground">
          {error.digest ? `Error ID: ${error.digest}` : 'Please try again.'}
        </p>
        <button
          onClick={reset}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90"
        >
          Try again
        </button>
      </div>
    </main>
  );
}

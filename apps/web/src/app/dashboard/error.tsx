'use client';

/**
 * Error boundary for dashboard route.
 * Must be a client component per Next.js requirements.
 * WCAG: Descriptive error message, recovery action.
 */
import { useEffect } from 'react';

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function DashboardError({ error, reset }: ErrorProps) {
  useEffect(() => {
    // Log to Azure App Insights
    if (typeof window !== 'undefined') {
      console.error('[Dashboard Error]', error.message, error.digest);
    }
  }, [error]);

  return (
    <main className="min-h-screen flex items-center justify-center p-8" role="alert">
      <div className="max-w-md text-center space-y-4">
        <div className="text-6xl" aria-hidden="true">⚠️</div>
        <h1 className="text-2xl font-bold">Something went wrong</h1>
        <p className="text-muted-foreground">
          We couldn&apos;t load the dashboard. Our team has been notified.
        </p>
        {error.digest && (
          <p className="text-xs text-muted-foreground font-mono">
            Error ID: {error.digest}
          </p>
        )}
        <button
          onClick={reset}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity"
          aria-label="Try loading the dashboard again"
        >
          Try again
        </button>
      </div>
    </main>
  );
}

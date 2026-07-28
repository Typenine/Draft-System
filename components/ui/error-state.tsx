import React from 'react';
import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

interface ErrorStateProps {
  message?: string;
  fullPage?: boolean;
  retry?: () => void;
  homeLink?: boolean;
}

export default function ErrorState({ 
  message = 'Something went wrong. Please try again later.', 
  fullPage = false,
  retry,
  homeLink = false
}: ErrorStateProps) {
  const containerClasses = fullPage 
    ? 'flex flex-col items-center justify-center min-h-[50vh] w-full text-center px-4'
    : 'flex flex-col items-center justify-center py-12 w-full text-center px-4';

  return (
    <Card role="alert" aria-live="assertive" className="w-full">
      <CardHeader className="flex items-center justify-center">
        <CardTitle className="flex items-center gap-3">
          <svg 
            xmlns="http://www.w3.org/2000/svg" 
            className="h-6 w-6 text-[var(--danger)]" 
            fill="none" 
            viewBox="0 0 24 24" 
            stroke="currentColor"
            aria-hidden="true"
          >
            <path 
              strokeLinecap="round" 
              strokeLinejoin="round" 
              strokeWidth={2} 
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" 
            />
          </svg>
          Error
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className={containerClasses}>
          <p className="text-[var(--muted)]">{message}</p>
          <div className="mt-6 flex flex-col sm:flex-row gap-3">
            {retry && (
              <Button
                onClick={retry}
                variant="danger"
                aria-label="Retry loading the content"
              >
                <svg 
                  xmlns="http://www.w3.org/2000/svg" 
                  className="h-5 w-5"
                  fill="none" 
                  viewBox="0 0 24 24" 
                  stroke="currentColor"
                  aria-hidden="true"
                >
                  <path 
                    strokeLinecap="round" 
                    strokeLinejoin="round" 
                    strokeWidth={2} 
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" 
                  />
                </svg>
                Try Again
              </Button>
            )}
            {homeLink && (
              <Link
                href="/"
                className="inline-flex items-center gap-2 rounded-full font-medium px-3 py-1.5 evw-surface border border-[var(--border)] text-[var(--text)] hover:opacity-90 focus:outline-none focus:ring-2 ring-[var(--focus)] ring-offset-2 ring-offset-[var(--surface)]"
                aria-label="Return to homepage"
              >
                <svg 
                  xmlns="http://www.w3.org/2000/svg" 
                  className="h-5 w-5" 
                  fill="none" 
                  viewBox="0 0 24 24" 
                  stroke="currentColor"
                  aria-hidden="true"
                >
                  <path 
                    strokeLinecap="round" 
                    strokeLinejoin="round" 
                    strokeWidth={2} 
                    d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" 
                  />
                </svg>
                Return Home
              </Link>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}


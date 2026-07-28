import React from 'react';

interface LoadingStateProps {
  message?: string;
  fullPage?: boolean;
}

export default function LoadingState({ message = 'Loading...', fullPage = false }: LoadingStateProps) {
  const containerClasses = fullPage 
    ? 'flex flex-col items-center justify-center min-h-[50vh] w-full'
    : 'flex flex-col items-center justify-center py-12 w-full';

  return (
    <div className={containerClasses} role="status" aria-live="polite" aria-busy="true">
      <div className="animate-spin rounded-full h-10 w-10 border-2 border-[var(--accent)] border-t-transparent"></div>
      <p className="mt-4 text-[var(--muted)] font-medium">{message}</p>
    </div>
  );
}

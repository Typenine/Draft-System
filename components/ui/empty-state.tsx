import React from 'react';
import { Card, CardContent, CardTitle, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

interface EmptyStateProps {
  title: string;
  message: string;
  icon?: React.ReactNode;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export default function EmptyState({ title, message, icon, action }: EmptyStateProps) {
  return (
    <Card role="status" aria-live="polite" className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center justify-center gap-3">
          {icon || (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-6 w-6 text-[var(--muted)]"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
              />
            </svg>
          )}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-center justify-center py-6 w-full text-center px-4">
          <p className="text-[var(--muted)]">{message}</p>
          {action && (
            <Button onClick={action.onClick} className="mt-6" aria-label={action.label}>
              {action.label}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}


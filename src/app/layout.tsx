import type { Metadata, Viewport } from 'next';
import './globals.css';
import './entry-flow.css';
import './admin-enhancements.css';
import './setup-access-fix.css';
import './commissioner/moderation.css';

export const metadata: Metadata = {
  title: 'Draft System',
  description: 'Standalone live fantasy draft platform',
  applicationName: 'Draft System',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0f172a',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

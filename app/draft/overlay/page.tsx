'use client';

import { useEffect } from 'react';
import dynamic from 'next/dynamic';

const DraftOverlayLive = dynamic(() => import('@/components/draft-overlay/DraftOverlayLive'), { ssr: false });

/**
 * Full-screen presentation / broadcast view.
 * Hides site nav/footer and fills the full viewport.
 */
export default function DraftOverlayPage() {
  useEffect(() => {
    document.body.classList.add('draft-overlay-mode');
    // Hide all siblings of <main> (Navbar, Footer) so only the overlay renders
    const main = document.querySelector('main');
    const hidden: HTMLElement[] = [];
    if (main?.parentElement) {
      Array.from(main.parentElement.children).forEach(el => {
        if (el !== main && el instanceof HTMLElement) {
          hidden.push(el);
          el.style.display = 'none';
        }
      });
    }
    return () => {
      document.body.classList.remove('draft-overlay-mode');
      hidden.forEach(el => { el.style.display = ''; });
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[9999] bg-zinc-950" style={{ width: '100vw', height: '100dvh' }}>
      <DraftOverlayLive />
    </div>
  );
}

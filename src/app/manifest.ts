import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Draft System',
    short_name: 'Draft',
    description: 'Standalone live fantasy draft platform',
    start_url: '/',
    display: 'standalone',
    background_color: '#070b14',
    theme_color: '#0f172a',
    icons: [],
  };
}

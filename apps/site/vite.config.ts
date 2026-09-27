import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Served at the GitHub Pages root of the repo (…github.io/AEOS/); the docs
// site lives under /AEOS/docs/ (apps/docs).
export default defineConfig({
  base: process.env.AEOS_SITE_BASE ?? '/AEOS/',
  plugins: [react()],
  build: { outDir: 'dist' },
});

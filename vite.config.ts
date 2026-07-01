import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // GitHub Pages project sites are served from /<repo-name>/, not the domain root.
  // The deploy workflow sets BASE_PATH to "/<repo-name>/"; falls back to "/" for
  // local dev and other hosts (Vercel/Netlify/custom domain).
  base: process.env.BASE_PATH || '/',
})

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // One React only (the monorepo also has the phone app's older one), or hooks fail with "Invalid hook call".
  resolve: { dedupe: ['react', 'react-dom'] },
})

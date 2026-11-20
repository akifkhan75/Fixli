import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // The monorepo has more than one React (the phone app pins an older one). Libraries must use the
  // admin's own copy, or hooks fail with "Invalid hook call" and the page stays blank.
  resolve: { dedupe: ['react', 'react-dom'] },
})

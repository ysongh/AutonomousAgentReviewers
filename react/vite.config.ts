import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In dev, proxy backend traffic so the browser stays same-origin.
//   /submit → intake (4001)
//   /events → log-streamer SSE feed (4100)
//   /verify → log-streamer 0G read-through proxy (4100)
// Keeps CORS out of the picture and lets the React app call relative URLs.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/submit': {
        target: 'http://127.0.0.1:4001',
        changeOrigin: true,
      },
      '/events': {
        target: 'http://127.0.0.1:4100',
        changeOrigin: true,
      },
      '/verify': {
        target: 'http://127.0.0.1:4100',
        changeOrigin: true,
      },
    },
  },
})

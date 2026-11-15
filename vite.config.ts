import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API = `http://localhost:${process.env.PORT ?? 3000}`;

export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // listen on the LAN so phones can scan the QR code in dev
    port: 5173,
    proxy: {
      '/api': API,
      '/media': API,
      '/avatars': API,
      '/socket.io': { target: API, ws: true },
    },
  },
});

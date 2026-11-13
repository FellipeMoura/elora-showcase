import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: true,
    port: 5500,
    strictPort: true,
    // Permite qualquer subdomínio de localhost (`clinica-a.localhost`, etc.)
    // e wildcard nip.io pra acesso via IP local (`clinica-a.192.168.x.y.nip.io`)
    // de outros devices na mesma rede. `.app.br` libera teste local via
    // /etc/hosts apontando pra IP da VPS (cenário raro mas útil).
    allowedHosts: ['.localhost', '.nip.io', '.app.br'],
  },
  preview: {
    host: true,
    port: 5500,
    strictPort: true,
    allowedHosts: ['.localhost', '.nip.io', '.app.br'],
  },
})

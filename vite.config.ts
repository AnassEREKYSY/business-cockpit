import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { handle } from './api/quote.ts'

/** Serves /api/quote during `npm run dev`, like the Vercel function does in production. */
const quotes = (): Plugin => ({
  name: 'cockpit-quotes',
  configureServer(server) {
    server.middlewares.use('/api/quote', (req, res) => {
      void handle(new URL(req.originalUrl ?? req.url ?? '/', 'http://localhost')).then((r) => {
        res.statusCode = r.status
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify(r.body))
      })
    })
  },
})

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), quotes()],
})

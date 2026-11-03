import react from '@vitejs/plugin-react'
import { Readable } from 'node:stream'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { POST as assistant } from './api/assistant.ts'
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

/** Serves /api/assistant during `npm run dev` (streams the answer like the Vercel function). */
const assistantApi = (): Plugin => ({
  name: 'cockpit-assistant',
  configureServer(server) {
    // Server-only keys (OPENAI_API_KEY) from .env.local, never exposed to the browser bundle.
    Object.assign(process.env, { ...loadEnv(server.config.mode, process.cwd(), ''), ...process.env })
    server.middlewares.use('/api/assistant', (req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (c: Buffer) => chunks.push(c))
      req.on('end', () => {
        const headers = new Headers()
        for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v)
        const request = new Request('http://localhost/api/assistant', { method: req.method, headers, body: req.method === 'POST' ? Buffer.concat(chunks) : undefined })
        void assistant(request).then(
          (r) => {
            res.statusCode = r.status
            r.headers.forEach((v, k) => res.setHeader(k, v))
            if (r.body) Readable.fromWeb(r.body as import('node:stream/web').ReadableStream).pipe(res)
            else res.end()
          },
          (e: unknown) => {
            res.statusCode = 500
            res.end(String(e))
          },
        )
      })
    })
  },
})

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), quotes(), assistantApi()],
})

import { Container, getContainer } from '@cloudflare/containers'
import { containerEnvironment } from './environment'

interface Env {
  KAIRO_API: DurableObjectNamespace<KairoAPI>
  [key: string]: unknown
}

export class KairoAPI extends Container<Env> {
  defaultPort = 3000
  // Recap jobs run after the upload response and may take several minutes.
  // Keep the process alive well past the existing ten-minute recovery window.
  sleepAfter = '30m'
  enableInternet = true
  envVars = containerEnvironment(this.env)
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname
    if (!path.startsWith('/v1/')) return new Response('Not found', { status: 404 })
    try {
      // One instance preserves the current in-memory rate limiting and queue.
      const container = getContainer(env.KAIRO_API, 'api')
      await container.startAndWaitForPorts({ ports: 3000, cancellationOptions: { portReadyTimeoutMS: 90_000 } })
      const response = await container.fetch(request)
      const headers = new Headers(response.headers)
      headers.set('Cache-Control', 'no-store')
      headers.set('X-Robots-Tag', 'noindex, nofollow')
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
    } catch {
      // Do not expose startup details or secret values to callers.
      return Response.json({ message: 'Kairo API is starting or temporarily unavailable. Please retry.' }, {
        status: 503, headers: { 'Retry-After': '5', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' },
      })
    }
  },
} satisfies ExportedHandler<Env>

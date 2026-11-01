import { audienceRoutes, type AudienceEnv } from './audience-routes'
export { AudienceRoom } from './audience-room'

interface Env extends AudienceEnv { LOCAL_API_URL: string }

/** Development-only Worker: real rooms, with auth checked by the running Nest API. */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const response = await audienceRoutes(request, env, authRequest => {
        const url = new URL(authRequest.url)
        return fetch(new Request(new URL(url.pathname + url.search, env.LOCAL_API_URL), authRequest))
      })
      return response ?? new Response('Not found', { status: 404 })
    } catch {
      return Response.json({ message: 'Could not reach the local account server. Start the server on port 3000, then try again.' }, { status: 503 })
    }
  },
} satisfies ExportedHandler<Env>

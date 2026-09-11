import type { INestApplication } from '@nestjs/common'
import { json, urlencoded } from 'express'
import type { Request } from 'express'
import { LARGE_BODY_ROUTES } from './large-body-routes'

/** Everything not named in `LARGE_BODY_ROUTES`. Express's own default, made explicit. */
const DEFAULT_LIMIT = '100kb'

/**
 * Body parsing, with a few named routes allowed to be larger than the rest.
 *
 * A sermon transcript carries word-level timings and runs to a megabyte or
 * more. Raising the limit globally would hand every auth route a 12 MB request
 * to chew on, so width is granted per route — and the grant lives next to the
 * controller that needs it (`LARGE_BODY_ROUTES`), not as a regex buried here,
 * so versioning a route or adding a second upload does not silently drop it
 * back to 100kb.
 *
 * Called from `main.ts` AND from the e2e harness, which builds its own Nest
 * application — a limit configured in only one of those places would leave the
 * upload test failing with a 413 nobody can explain.
 */
export function applyBodyParsers(app: INestApplication): void {
  const parsers = LARGE_BODY_ROUTES.map((route) => ({
    matches: (req: Request) => req.method === route.method && route.path.test(req.path),
    parse: json({ limit: route.limit }),
  }))
  const normal = json({ limit: DEFAULT_LIMIT })

  app.use((req: Request, res: never, next: () => void) => {
    const match = parsers.find((parser) => parser.matches(req))
    return (match ? match.parse : normal)(req, res, next)
  })
  app.use(urlencoded({ extended: true, limit: DEFAULT_LIMIT }))
}

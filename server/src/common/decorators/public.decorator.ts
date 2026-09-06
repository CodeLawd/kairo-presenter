import { SetMetadata } from '@nestjs/common'

export const IS_PUBLIC_KEY = 'isPublic'

/** Opts a route out of the global JWT guard. Auth endpoints, health, webhooks. */
export const Public = (): MethodDecorator => SetMetadata(IS_PUBLIC_KEY, true)

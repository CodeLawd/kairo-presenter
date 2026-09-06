import { SetMetadata } from '@nestjs/common'

export const ALLOW_UNVERIFIED_KEY = 'allowUnverifiedEmail'

/**
 * Lets a route run for an account whose email is not confirmed yet.
 *
 * Only for the handful of things someone must be able to do in order to GET
 * verified — read their own session, ask for another link, sign out. Everything
 * else waits until the address is proven.
 */
export const AllowUnverified = (): MethodDecorator => SetMetadata(ALLOW_UNVERIFIED_KEY, true)

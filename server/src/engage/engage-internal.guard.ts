import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable } from '@nestjs/common'
import { createHash, timingSafeEqual } from 'node:crypto'
import { APP_CONFIG } from '../config/config.module'
import type { AppConfig } from '../config/env'

@Injectable()
export class EngageInternalGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const header = context.switchToHttp().getRequest().headers.authorization
    const expected = this.config.engageInternalSecret
    const actual = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : ''
    // Hash to fixed-size buffers before comparing, including mismatched lengths.
    const digest = (value: string): Buffer => createHash('sha256').update(value).digest()
    const matches = timingSafeEqual(digest(actual), digest(expected ?? ''))
    if (!expected || !actual || !matches) throw new ForbiddenException('Invalid internal credentials')
    return true
  }
}

import { Controller, Get } from '@nestjs/common'
import { InjectConnection } from '@nestjs/mongoose'
import { Connection } from 'mongoose'
import { Public } from '../common/decorators/public.decorator'

@Controller('v1/health')
export class HealthController {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  /** Render's health check. Reports the database rather than just "the process is up". */
  @Public()
  @Get()
  health(): { status: string; database: string } {
    const connected = this.connection.readyState === 1
    return { status: connected ? 'ok' : 'degraded', database: connected ? 'up' : 'down' }
  }
}

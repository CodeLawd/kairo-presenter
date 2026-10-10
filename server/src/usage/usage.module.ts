import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { Session, SessionSchema } from '../auth/schemas/session.schema'
import { UsageDay, UsageDaySchema } from './schemas/usage-day.schema'
import { UsageController } from './usage.controller'
import { UsageService } from './usage.service'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: UsageDay.name, schema: UsageDaySchema },
      // To keep each install's device record (app version) current.
      { name: Session.name, schema: SessionSchema },
    ]),
  ],
  controllers: [UsageController],
  providers: [UsageService],
  exports: [MongooseModule],
})
export class UsageModule {}

import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { AuthModule } from '../auth/auth.module'
import { OrgsModule } from '../orgs/orgs.module'
import { Session, SessionSchema } from '../auth/schemas/session.schema'
import { EmailToken, EmailTokenSchema } from '../auth/schemas/email-token.schema'
import {
  DeviceAuthRequest,
  DeviceAuthRequestSchema,
} from '../auth/schemas/device-auth-request.schema'
import { Sermon, SermonSchema } from '../sermons/schemas/sermon.schema'
import { CrashReport, CrashReportSchema } from '../crashes/schemas/crash-report.schema'
import { UsageDay, UsageDaySchema } from '../usage/schemas/usage-day.schema'
import { AccountController } from './account.controller'
import { AccountService } from './account.service'

@Module({
  imports: [
    AuthModule,
    // Organization, Membership, OrgSecrets and User models come with it.
    OrgsModule,
    // Every collection that holds something about a person — export reads
    // them, deletion clears them.
    MongooseModule.forFeature([
      { name: Session.name, schema: SessionSchema },
      { name: EmailToken.name, schema: EmailTokenSchema },
      { name: DeviceAuthRequest.name, schema: DeviceAuthRequestSchema },
      { name: Sermon.name, schema: SermonSchema },
      { name: CrashReport.name, schema: CrashReportSchema },
      { name: UsageDay.name, schema: UsageDaySchema },
    ]),
  ],
  controllers: [AccountController],
  providers: [AccountService],
})
export class AccountModule {}

import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { AuthModule } from '../auth/auth.module'
import { UsersModule } from '../users/users.module'
import { OrgsModule } from '../orgs/orgs.module'
import { DownloadsModule } from '../downloads/downloads.module'
import { UsageModule } from '../usage/usage.module'
import { Sermon, SermonSchema } from '../sermons/schemas/sermon.schema'
import { Session, SessionSchema } from '../auth/schemas/session.schema'
import { AdminController } from './admin.controller'
import { AdminService } from './admin.service'
import { UsageAdminService } from './usage-admin.service'
import { PlatformAdminGuard } from './platform-admin.guard'

@Module({
  imports: [
    UsersModule,
    OrgsModule,
    AuthModule,
    DownloadsModule,
    UsageModule,
    // Read-only counts for the overview.
    MongooseModule.forFeature([
      { name: Sermon.name, schema: SermonSchema },
      { name: Session.name, schema: SessionSchema },
    ]),
  ],
  controllers: [AdminController],
  providers: [AdminService, UsageAdminService, PlatformAdminGuard],
})
export class AdminModule {}

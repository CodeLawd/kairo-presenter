import { Module } from '@nestjs/common'
import { UsersModule } from '../users/users.module'
import { PlatformAdminGuard } from '../admin/platform-admin.guard'
import { LicensingService } from './licensing.service'
import { LicensingAdminController, LicensingController, ManagedController } from './licensing.controller'
@Module({ imports: [UsersModule], providers: [LicensingService, PlatformAdminGuard], controllers: [LicensingAdminController, LicensingController, ManagedController], exports: [LicensingService] })
export class LicensingModule {}

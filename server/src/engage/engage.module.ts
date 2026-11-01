import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { OrgsModule } from '../orgs/orgs.module'
import { MailModule } from '../mail/mail.module'
import { EngageInternalController, EngagementsController } from './engage.controller'
import { EngageInternalGuard } from './engage-internal.guard'
import { EngagementIndexService } from './engagement-index.service'
import { EngagementIndex, EngagementIndexSchema } from './engagement-index.schema'

@Module({
  imports: [OrgsModule, MailModule, MongooseModule.forFeature([{ name: EngagementIndex.name, schema: EngagementIndexSchema }])],
  controllers: [EngageInternalController, EngagementsController],
  providers: [EngageInternalGuard, EngagementIndexService],
})
export class EngageModule {}

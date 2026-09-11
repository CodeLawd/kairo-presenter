import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { OrgsModule } from '../orgs/orgs.module'
import { Sermon, SermonSchema } from './schemas/sermon.schema'
import { SermonsService } from './sermons.service'
import { SermonSummaryService } from './sermon-summary.service'
import { SermonGenerationService } from './sermon-generation.service'
import { SermonsController } from './sermons.controller'
import { PublicSermonsController } from './public-sermons.controller'

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Sermon.name, schema: SermonSchema }]),
    // For OrgsService (church name on the public page) and, in phase 2,
    // OrgSecretsService — the church's own LLM key.
    OrgsModule,
  ],
  controllers: [SermonsController, PublicSermonsController],
  providers: [SermonsService, SermonSummaryService, SermonGenerationService],
  exports: [SermonsService, SermonSummaryService],
})
export class SermonsModule {}

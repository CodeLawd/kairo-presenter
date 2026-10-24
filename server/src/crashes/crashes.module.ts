import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { CrashReport, CrashReportSchema } from './schemas/crash-report.schema'
import { CrashesController } from './crashes.controller'
import { CrashesService } from './crashes.service'

@Module({
  imports: [MongooseModule.forFeature([{ name: CrashReport.name, schema: CrashReportSchema }])],
  controllers: [CrashesController],
  providers: [CrashesService],
  exports: [MongooseModule],
})
export class CrashesModule {}

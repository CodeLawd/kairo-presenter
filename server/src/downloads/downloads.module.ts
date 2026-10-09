import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { DownloadEvent, DownloadEventSchema } from './schemas/download-event.schema'
import { DownloadsController } from './downloads.controller'

@Module({
  imports: [MongooseModule.forFeature([{ name: DownloadEvent.name, schema: DownloadEventSchema }])],
  controllers: [DownloadsController],
  exports: [MongooseModule],
})
export class DownloadsModule {}

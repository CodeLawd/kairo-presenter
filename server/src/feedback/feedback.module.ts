import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { Feedback, FeedbackSchema } from './schemas/feedback.schema'
import { FeedbackController } from './feedback.controller'
import { FeedbackService } from './feedback.service'

@Module({
  imports: [MongooseModule.forFeature([{ name: Feedback.name, schema: FeedbackSchema }])],
  controllers: [FeedbackController],
  providers: [FeedbackService],
  exports: [MongooseModule],
})
export class FeedbackModule {}

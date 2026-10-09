import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { HydratedDocument } from 'mongoose'

export type DownloadEventDocument = HydratedDocument<DownloadEvent>

export const DOWNLOAD_PLATFORMS = ['mac-arm64', 'mac-x64', 'windows-x64', 'linux-x64'] as const
export type DownloadPlatform = (typeof DOWNLOAD_PLATFORMS)[number]

/**
 * One installer download started from the website.
 *
 * Written by the website's /api/download route as it redirects to the GitHub
 * release file, so it counts people choosing to install Kairo — never the
 * in-app updater, which fetches from GitHub directly. Holds no personal data:
 * no IP, no account, only where the click came from.
 */
@Schema({ timestamps: { createdAt: true, updatedAt: false }, collection: 'download_events' })
export class DownloadEvent {
  @Prop({ type: String, enum: DOWNLOAD_PLATFORMS, required: true })
  platform!: DownloadPlatform

  /** Release version served, e.g. "1.0.2". Empty when no release had a file. */
  @Prop({ default: '' })
  version!: string

  /** Which page the button was on: home, dashboard, onboarding, direct. */
  @Prop({ default: 'direct' })
  source!: string

  /** ISO country code from the edge network, when known. */
  @Prop({ default: '' })
  country!: string

  /** False when there was no installer to send — the visitor saw "not available". */
  @Prop({ default: true })
  served!: boolean

  createdAt?: Date
}

export const DownloadEventSchema = SchemaFactory.createForClass(DownloadEvent)
DownloadEventSchema.index({ createdAt: -1 })

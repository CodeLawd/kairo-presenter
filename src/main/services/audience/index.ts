import { app } from 'electron'
import { AudienceService } from './service'
import { programService } from '../output/program-service'

export const audienceService = new AudienceService(programService, { sampleAvailable: !app.isPackaged && process.env.KAIRO_AUDIENCE_SAMPLE === '1' })
programService.onChange(state => { if (!state.question) audienceService.syncCleared() })

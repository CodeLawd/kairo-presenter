import type { TranscriptionAccess } from '../src/main/services/stt/deepgram'
import type { TranscriptionGrant } from '../src/lib/cloud/licensing'
export const grant = (id = 'session'): TranscriptionGrant => ({ accessToken: `ephemeral-${id}`, sessionId: id, expiresIn: 30, renewAfterSeconds: 60 })
export const fakeTranscriptionAccess: TranscriptionAccess = {
  transcription: async () => grant(), renewTranscription: async () => grant(), releaseTranscription: async () => undefined,
}

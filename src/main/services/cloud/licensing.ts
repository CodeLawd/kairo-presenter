import { cloudSession } from './session'
import { createSecureStore } from './secure-store'
import { LicensingService } from './license-service'

export const licensing = new LicensingService(cloudSession, createSecureStore(), import.meta.env.MAIN_VITE_LICENSE_PUBLIC_KEY || null)

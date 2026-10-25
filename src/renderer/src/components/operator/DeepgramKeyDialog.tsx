import { useEffect } from 'react'
import { ActivationDialog } from '@/components/account/ActivationDialog'
import { useLicense } from '@/stores/useLicenseStore'

/** Activation entry point shown when an operator starts live transcription. */
export function DeepgramKeyDialog({ open, onOpenChange, onSaved }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}): React.ReactElement {
  const license = useLicense()
  useEffect(() => {
    if (open && license?.activated && license.providers.deepgram) {
      onOpenChange(false)
      onSaved()
    }
  }, [open, license?.activated, license?.providers.deepgram, onOpenChange, onSaved])
  return <ActivationDialog
    open={open}
    onOpenChange={onOpenChange}
    title="Set up live transcription"
    description={license?.activated
      ? 'Live transcription isn’t available yet. It will start working once Kairo finishes setting it up.'
      : 'Activate this computer for your church to use live transcription.'}
  />
}

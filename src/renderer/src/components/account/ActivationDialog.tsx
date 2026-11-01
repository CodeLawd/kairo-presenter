import { Dialog } from 'radix-ui'
import LicensePanel from '@/components/account/LicensePanel'
import { MovableDialog } from '@/components/shared/MovableDialog'
import { X } from '@/icons'

/** The activation panel as a modal — from the header chip or a feature that needs activation. */
export function ActivationDialog({ open, onOpenChange, title = 'Activate this computer', description }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title?: string
  description?: string
}): React.ReactElement {
  return <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-black/35 animate-fade-in" />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <MovableDialog className="w-full max-w-md">
          <Dialog.Content className="relative w-full rounded-xl modal-glass p-6 text-white animate-spring-in">
            <div data-modal-drag className="pr-8">
              <Dialog.Title className="mb-2 text-[17px] font-semibold">{title}</Dialog.Title>
              <Dialog.Description className="mb-5 text-[13px] text-slate-400">
                {description ?? 'Turns on live transcription, scripture lookup and lyric tools.'}
              </Dialog.Description>
            </div>
            <LicensePanel bare />
            <Dialog.Close aria-label="Close" className="absolute right-3 top-3 grid size-7 place-items-center rounded-md text-slate-400 hover:bg-white/10 hover:text-white">
              <X size={14} aria-hidden="true" />
            </Dialog.Close>
          </Dialog.Content>
        </MovableDialog>
      </div>
    </Dialog.Portal>
  </Dialog.Root>
}

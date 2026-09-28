import { useEffect, useState } from 'react'

/** DOM id of the header's toolbar area, which routes can portal their controls into. */
export const HEADER_TOOLBAR_SLOT_ID = 'header-toolbar-slot'

/** The header toolbar element once mounted, for `createPortal`. */
export function useHeaderToolbarSlot(): HTMLElement | null {
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  useEffect(() => setSlot(document.getElementById(HEADER_TOOLBAR_SLOT_ID)), [])
  return slot
}

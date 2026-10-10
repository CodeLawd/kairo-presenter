import type { ReactElement, ReactNode } from 'react'
import { ContextMenu } from 'radix-ui'
import { cn } from '@/lib/utils'

const PANEL =
  'z-50 min-w-44 overflow-hidden rounded-lg bg-popover p-1 text-[13px] text-popover-foreground shadow-md ring-1 ring-foreground/10 animate-spring-in'
const ITEM =
  'relative flex cursor-default select-none items-center gap-2 rounded-md px-2 py-1.5 outline-none data-[highlighted]:bg-surface-tertiary'

export interface RowMenuItem {
  label: string
  icon?: ReactNode
  onSelect: () => void
  /** Deletes something: drawn in red, after a separator. */
  destructive?: boolean
}

/**
 * Right-click on a list row for what you can do to it — ProPresenter's way of
 * keeping rows clean instead of showing icons on hover.
 */
export function RowContextMenu({ items, children }: { items: RowMenuItem[]; children: ReactElement }): ReactElement {
  const safe = items.filter((item) => !item.destructive)
  const destructive = items.filter((item) => item.destructive)
  const row = (item: RowMenuItem): ReactElement => (
    <ContextMenu.Item key={item.label} className={cn(ITEM, item.destructive && 'text-red-400')} onSelect={item.onSelect}>
      {item.icon}
      {item.label}
    </ContextMenu.Item>
  )
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className={PANEL}>
          {safe.map(row)}
          {safe.length > 0 && destructive.length > 0 && <ContextMenu.Separator className="my-1 h-px bg-surface-border" />}
          {destructive.map(row)}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  )
}

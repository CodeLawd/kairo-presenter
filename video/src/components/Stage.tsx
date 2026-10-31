import { AbsoluteFill, useVideoConfig } from 'remotion'
import { brand } from '../tokens/tokens'

/**
 * Scenes are laid out in a fixed design space (1920×1080 landscape,
 * 1080×1920 portrait) and scaled to the render size, so the 4K master and
 * the 1080p export are the same frame.
 */
export function Stage({ children, background = brand.ink }: { children: React.ReactNode; background?: string }): React.ReactElement {
  const { width, height } = useVideoConfig()
  const portrait = height > width
  const designW = portrait ? 1080 : 1920
  const designH = portrait ? 1920 : 1080
  const scale = width / designW
  return (
    <AbsoluteFill style={{ background, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', left: 0, top: 0, width: designW, height: designH, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
        {children}
      </div>
    </AbsoluteFill>
  )
}

export const useDesign = (): { w: number; h: number; portrait: boolean } => {
  const { width, height } = useVideoConfig()
  const portrait = height > width
  return { w: portrait ? 1080 : 1920, h: portrait ? 1920 : 1080, portrait }
}

'use client'

import { useEffect, useRef } from 'react'

/**
 * Starts the installer download once the thank-you page is on screen. The API
 * route redirects to the release file, which the browser saves without leaving
 * this page; with no file for the platform it lands on /download instead.
 */
export function StartDownload({ platform, source }: { platform: string; source: string }): null {
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    window.location.assign(`/api/download/${platform}?source=${encodeURIComponent(source)}`)
  }, [platform, source])
  return null
}

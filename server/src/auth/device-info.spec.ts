import { inferDeviceFromUserAgent, mergeDeviceInfo, osLabel } from './device-info'

describe('inferDeviceFromUserAgent', () => {
  it('reads Electron Chromium user agents', () => {
    const ua =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_6_1) AppleWebKit/537.36 (KHTML, like Gecko) Kairo/0.1.0 Chrome/134.0.6998.44 Electron/35.1.2 Safari/537.36'
    expect(inferDeviceFromUserAgent(ua)).toEqual({
      os: 'darwin',
      osVersion: '15.6.1',
      arch: 'x64',
      appVersion: '0.1.0',
      electronVersion: '35.1.2',
    })
  })

  it('ignores axios default user agents', () => {
    expect(inferDeviceFromUserAgent('axios/1.7.9')).toEqual({})
  })
})

describe('mergeDeviceInfo', () => {
  it('lets a stored snapshot win over a user-agent guess', () => {
    const merged = mergeDeviceInfo(inferDeviceFromUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Electron/28.0.0'), {
      os: 'darwin',
      osVersion: '15.6.1',
      arch: 'arm64',
      hostname: 'booth.local',
    })
    expect(merged.arch).toBe('arm64')
    expect(merged.hostname).toBe('booth.local')
    expect(osLabel(merged.os)).toBe('macOS')
  })
})

import { promises as fs } from 'fs'
import { dirname, join } from 'path'
import { pathToFileURL } from 'url'
import { execFile } from 'child_process'
import { promisify } from 'util'
import type { PowerpointConverterId } from '@shared/documents'
import {
  findAppByBundleId,
  findAppByName,
  findLibreOfficeDesktopBinary,
  isKeynoteAppName,
  isLibreOfficeAppName,
  isPowerPointAppName,
  isWpsAppName,
} from './office-apps'

const run = promisify(execFile)
const CONVERT_MS = 120_000

export const POWERPOINT_CONVERTER_ORDER: readonly PowerpointConverterId[] = [
  'powerpoint',
  'wps',
  'keynote',
  'libreoffice',
]

export function escapeAppleScriptString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path)
    return true
  } catch {
    return false
  }
}

async function firstExisting(paths: readonly string[]): Promise<string | null> {
  for (const path of paths) {
    if (await exists(path)) return path
  }
  return null
}

async function commandOnPath(name: string): Promise<string | null> {
  try {
    const { stdout } = await run(process.platform === 'win32' ? 'where' : 'which', [name], {
      timeout: 5_000,
    })
    const found = stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean)
    return found || name
  } catch {
    return null
  }
}

export async function firstAvailableCommand(
  names: readonly string[],
  resolve: (name: string) => Promise<string | null> = commandOnPath,
): Promise<string | null> {
  for (const name of names) {
    const found = await resolve(name)
    if (found) return found
  }
  return null
}

/** Encodes an untrusted path as inert data for a PowerShell environment variable. */
export function encodePowerShellTransport(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64')
}

const POWERSHELL_DECODE_SOURCE =
  '[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:KAIRO_PPT_SOURCE_B64))'
const POWERSHELL_DECODE_DEST =
  '[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:KAIRO_PPT_DEST_B64))'

function powerpointPathEnv(source: string, destPdf: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    KAIRO_PPT_SOURCE_B64: encodePowerShellTransport(source),
    KAIRO_PPT_DEST_B64: encodePowerShellTransport(destPdf),
  }
}

async function assertPdf(path: string): Promise<void> {
  const header = Buffer.alloc(5)
  const handle = await fs.open(path, 'r')
  try {
    await handle.read(header, 0, 5, 0)
  } finally {
    await handle.close()
  }
  if (header.toString('utf8') !== '%PDF-') {
    throw new Error('Converter did not produce a PDF.')
  }
}

function programFiles(): string[] {
  return [
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
    process.env.ProgramW6432,
  ].filter((value): value is string => Boolean(value))
}

export async function detectPowerPoint(): Promise<string | null> {
  if (process.platform === 'darwin') {
    return (
      (await findAppByName(isPowerPointAppName))
      ?? (await findAppByBundleId('com.microsoft.Powerpoint'))
      ?? await firstExisting([
        '/Applications/Microsoft PowerPoint.app',
        '/Applications/Microsoft Office 2016/Microsoft PowerPoint.app',
        '/Applications/Microsoft Office 2019/Microsoft PowerPoint.app',
      ])
    )
  }
  if (process.platform === 'win32') {
    const named = programFiles().flatMap((root) => [
      join(root, 'Microsoft Office', 'root', 'Office16', 'POWERPNT.EXE'),
      join(root, 'Microsoft Office', 'root', 'Office15', 'POWERPNT.EXE'),
      join(root, 'Microsoft Office', 'Office16', 'POWERPNT.EXE'),
      join(root, 'Microsoft Office', 'Office15', 'POWERPNT.EXE'),
    ])
    return (await firstExisting(named)) ?? commandOnPath('POWERPNT.EXE')
  }
  return null
}

export async function detectWps(): Promise<string | null> {
  if (process.platform === 'darwin') {
    return (
      (await findAppByName(isWpsAppName))
      ?? (await findAppByBundleId('com.kingsoft.wpsoffice.mac.global'))
      ?? (await findAppByBundleId('com.kingsoft.wpsoffice.mac'))
      ?? await firstExisting([
        '/Applications/wpsoffice.app',
        '/Applications/WPS Office.app',
        '/Applications/WPS Office for Mac.app',
      ])
    )
  }
  if (process.platform === 'win32') {
    const named = [
      ...programFiles().flatMap((root) => [
        join(root, 'Kingsoft', 'WPS Office', 'office6', 'wpp.exe'),
        join(root, 'WPS Office', 'office6', 'wpp.exe'),
      ]),
      process.env.LOCALAPPDATA
        ? join(process.env.LOCALAPPDATA, 'Kingsoft', 'WPS Office', 'ksolaunch.exe')
        : '',
    ].filter(Boolean)
    return (await firstExisting(named)) ?? commandOnPath('wpp')
  }
  return firstAvailableCommand(['wpp', 'wps'])
}

export async function detectKeynote(): Promise<string | null> {
  if (process.platform !== 'darwin') return null
  return (
    (await findAppByName(isKeynoteAppName))
    ?? (await findAppByBundleId('com.apple.iWork.Keynote'))
    ?? await firstExisting(['/Applications/Keynote.app', '/System/Applications/Keynote.app'])
  )
}

export async function detectLibreOffice(): Promise<string | null> {
  if (process.platform === 'darwin') {
    const app = await findAppByName(isLibreOfficeAppName)
    const soffice = app
      ? join(app, 'Contents/MacOS/soffice')
      : '/Applications/LibreOffice.app/Contents/MacOS/soffice'
    if (await exists(soffice)) return soffice
  }
  if (process.platform === 'win32') {
    const named = programFiles().map((root) => join(root, 'LibreOffice', 'program', 'soffice.exe'))
    const found = await firstExisting(named)
    if (found) return found
  }
  if (process.platform === 'linux') {
    // PATH first (cheap); .desktop launchers catch non-PATH installs.
    const fromDesktop = await findLibreOfficeDesktopBinary()
    if (fromDesktop) {
      if (fromDesktop.startsWith('/')) return fromDesktop
      const viaPath = await commandOnPath(fromDesktop)
      if (viaPath) return viaPath
    }
  }
  return firstAvailableCommand(['soffice', 'libreoffice'])
}

export async function detectPowerpointConverters(): Promise<PowerpointConverterId[]> {
  const checks: Array<[PowerpointConverterId, () => Promise<string | null>]> = [
    ['powerpoint', detectPowerPoint],
    ['wps', detectWps],
    ['keynote', detectKeynote],
    ['libreoffice', detectLibreOffice],
  ]
  const found: PowerpointConverterId[] = []
  for (const [id, detect] of checks) {
    if (await detect()) found.push(id)
  }
  return found
}

async function osascript(source: string): Promise<void> {
  await run('osascript', ['-e', source], { timeout: CONVERT_MS, maxBuffer: 1024 * 1024 })
}

async function convertWithPowerPoint(source: string, destPdf: string): Promise<void> {
  if (process.platform === 'darwin') {
    const src = escapeAppleScriptString(source)
    const dest = escapeAppleScriptString(destPdf)
    const attempts = [
      `tell application "Microsoft PowerPoint"\nset thePres to open POSIX file "${src}"\nsave thePres in POSIX file "${dest}" as save as PDF\nclose thePres saving no\nend tell`,
      `tell application "Microsoft PowerPoint"\nopen POSIX file "${src}"\nsave active presentation in POSIX file "${dest}" as save as PDF\nclose active presentation saving no\nend tell`,
    ]
    let last: unknown
    for (const script of attempts) {
      try {
        await osascript(script)
        await assertPdf(destPdf)
        return
      } catch (error) {
        last = error
      }
    }
    throw last instanceof Error ? last : new Error('PowerPoint could not export this file as PDF.')
  }
  if (process.platform === 'win32') {
    const script = [
      '$ErrorActionPreference = "Stop"',
      `$src = ${POWERSHELL_DECODE_SOURCE}`,
      `$dest = ${POWERSHELL_DECODE_DEST}`,
      '$ppt = New-Object -ComObject PowerPoint.Application',
      'try {',
      '  $ppt.DisplayAlerts = 2',
      '  $pres = $ppt.Presentations.Open($src, $true, $false, $false)',
      '  $pres.SaveAs($dest, 32)',
      '  $pres.Close()',
      '} finally {',
      '  if ($ppt.Presentations.Count -eq 0) { $ppt.Quit() }',
      '}',
    ].join('; ')
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      timeout: CONVERT_MS,
      maxBuffer: 1024 * 1024,
      env: powerpointPathEnv(source, destPdf),
    })
    await assertPdf(destPdf)
    return
  }
  throw new Error('Microsoft PowerPoint conversion is not available on this system.')
}

async function convertWithKeynote(source: string, destPdf: string): Promise<void> {
  const src = escapeAppleScriptString(source)
  const dest = escapeAppleScriptString(destPdf)
  await osascript(
    `tell application "Keynote"\nset theDoc to open POSIX file "${src}"\nexport theDoc to POSIX file "${dest}" as PDF\nclose theDoc saving no\nend tell`,
  )
  await assertPdf(destPdf)
}

async function convertWithWps(source: string, destPdf: string, _app: string): Promise<void> {
  if (process.platform === 'darwin') {
    // The Mac app launches a GUI for any argv, including --help / --headless.
    throw new Error('skip')
  }
  if (process.platform === 'win32') {
    const script = [
      '$ErrorActionPreference = "Stop"',
      `$src = ${POWERSHELL_DECODE_SOURCE}`,
      `$dest = ${POWERSHELL_DECODE_DEST}`,
      'foreach ($prog in @("Kwpp.Application","wpp.Application","WPP.Application")) {',
      '  try {',
      '    $app = New-Object -ComObject $prog',
      '    $pres = $app.Presentations.Open($src)',
      '    $pres.SaveAs($dest, 32)',
      '    $pres.Close()',
      '    if ($app.Presentations.Count -eq 0) { $app.Quit() }',
      '    exit 0',
      '  } catch {}',
      '}',
      'throw "WPS Office could not convert this file."',
    ].join('; ')
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      timeout: CONVERT_MS,
      maxBuffer: 1024 * 1024,
      env: powerpointPathEnv(source, destPdf),
    })
    await assertPdf(destPdf)
    return
  }
  const cli = (await commandOnPath('wpp')) ?? (await commandOnPath('wps'))
  if (!cli) throw new Error('WPS Office is not available.')
  await run(cli, ['--headless', '--convert-to', 'pdf', '--outdir', dirname(destPdf), source], {
    timeout: CONVERT_MS,
    maxBuffer: 1024 * 1024,
  })
  await assertPdf(destPdf)
}

async function convertWithLibreOffice(source: string, destPdf: string, workDir: string, soffice: string): Promise<void> {
  await run(
    soffice,
    [
      `-env:UserInstallation=${pathToFileURL(join(workDir, 'profile')).href}`,
      '--headless',
      '--nologo',
      '--nolockcheck',
      '--convert-to',
      'pdf:impress_pdf_Export',
      '--outdir',
      workDir,
      source,
    ],
    { timeout: CONVERT_MS, maxBuffer: 1024 * 1024 },
  )
  if (!(await exists(destPdf))) throw new Error('LibreOffice did not write a PDF.')
  await assertPdf(destPdf)
  await fs.rm(join(workDir, 'profile'), { recursive: true, force: true })
}

export async function convertPowerPointToPdf(
  source: string,
  destPdf: string,
  workDir: string,
): Promise<PowerpointConverterId> {
  const attempts: Array<{ id: PowerpointConverterId; run: () => Promise<void> }> = [
    {
      id: 'powerpoint',
      run: async () => {
        if (!(await detectPowerPoint())) throw new Error('skip')
        await convertWithPowerPoint(source, destPdf)
      },
    },
    {
      id: 'wps',
      run: async () => {
        const app = await detectWps()
        if (!app) throw new Error('skip')
        await convertWithWps(source, destPdf, app)
      },
    },
    {
      id: 'keynote',
      run: async () => {
        if (!(await detectKeynote())) throw new Error('skip')
        await convertWithKeynote(source, destPdf)
      },
    },
    {
      id: 'libreoffice',
      run: async () => {
        const soffice = await detectLibreOffice()
        if (!soffice) throw new Error('skip')
        await convertWithLibreOffice(source, destPdf, workDir, soffice)
      },
    },
  ]

  const errors: string[] = []
  for (const attempt of attempts) {
    try {
      await attempt.run()
      return attempt.id
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message !== 'skip') errors.push(`${attempt.id}: ${message}`)
    }
  }
  if (errors.length === 0) {
    throw new Error(
      'PowerPoint import needs an app that can convert the deck: Microsoft PowerPoint, WPS Office, Keynote, or LibreOffice. Or export the deck to PDF and import that instead.',
    )
  }
  throw new Error(
    `Could not convert this PowerPoint file. Tried ${errors.map((item) => item.split(':')[0]).join(', ')}. The file may be protected or damaged — export it to PDF and import that instead.`,
  )
}

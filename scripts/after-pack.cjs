const fs = require('node:fs')
const path = require('node:path')

const ARCH_NAMES = {
  0: 'ia32',
  1: 'x64',
  2: 'armv7l',
  3: 'arm64',
  4: 'universal',
}

/** Remove optional NDI prebuilds that do not belong to this artifact. */
exports.default = async function afterPack(context) {
  const platform = context.electronPlatformName
  const arch = ARCH_NAMES[context.arch]
  if (!platform || !arch) {
    throw new Error(`Cannot prune NDI prebuilds for ${platform ?? 'unknown'}/${context.arch}`)
  }

  const resources = platform === 'darwin'
    ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
    : path.join(context.appOutDir, 'resources')
  const scope = path.join(resources, 'app.asar.unpacked', 'node_modules', '@grandi')
  if (!fs.existsSync(scope)) {
    throw new Error(`Packaged NDI prebuild directory is missing: ${scope}`)
  }

  const keep = `${platform}-${arch}`
  for (const name of fs.readdirSync(scope)) {
    if (name !== keep) fs.rmSync(path.join(scope, name), { recursive: true, force: true })
  }
  const target = path.join(scope, keep)
  if (!fs.existsSync(target)) {
    const source = path.join(context.packager.projectDir, 'node_modules', '@grandi', keep)
    if (!fs.existsSync(source)) {
      throw new Error(`Expected installed NDI prebuild is missing: @grandi/${keep}`)
    }
    fs.cpSync(source, target, { recursive: true })
  }
}

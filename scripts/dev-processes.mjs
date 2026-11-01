import { spawn, spawnSync } from 'node:child_process'

/** A development service owns its child process trees and shares one Ctrl+C. */
export function runDevProcesses(commands, { cwd = process.cwd(), graceMs = 5000 } = {}) {
  return new Promise(resolve => {
    const children = []
    const windows = process.platform === 'win32'
    let stopping = false
    let finished = false
    let exitCode = 0
    let timer
    let poll
    const alive = child => {
      if (!child.pid) return false
      if (windows) return child.exitCode === null && child.signalCode === null
      try { process.kill(-child.pid, 0); return true } catch { return false }
    }
    const killAll = signal => {
      for (const child of children) {
        if (!child.pid) continue
        if (windows) {
          spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
        } else {
          try { process.kill(-child.pid, signal) } catch (error) { if (error.code !== 'ESRCH') console.error(error.message) }
        }
      }
    }
    const finish = () => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      clearInterval(poll)
      process.removeListener('SIGINT', interrupt)
      process.removeListener('SIGTERM', terminate)
      resolve(exitCode)
    }
    const shutdown = code => {
      if (stopping) return
      stopping = true
      exitCode = code
      killAll('SIGTERM')
      const check = () => { if (children.every(child => !alive(child))) finish() }
      poll = setInterval(check, 25)
      timer = setTimeout(() => { killAll('SIGKILL'); finish() }, graceMs)
      check()
    }
    const interrupt = () => shutdown(0)
    const terminate = () => shutdown(0)
    process.once('SIGINT', interrupt)
    process.once('SIGTERM', terminate)
    for (const command of commands) {
      if (stopping) break
      console.log(`[server] Starting ${command.name}`)
      const child = spawn(command.command, command.args, { cwd, stdio: ['ignore', 'inherit', 'inherit'], detached: !windows, windowsHide: true })
      children.push(child)
      child.once('error', error => {
        console.error(`[server] ${command.name} could not start: ${error.message}`)
        shutdown(1)
      })
      child.once('exit', (code, signal) => {
        if (stopping) return
        console.error(`[server] ${command.name} stopped (${signal || code}); stopping the server.`)
        shutdown(code || 1)
      })
    }
    if (!commands.length) finish()
  })
}

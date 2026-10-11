/**
 * Loaded into every main-process test process (see test-main.mjs).
 *
 * 1. electron-log's file output is off: parallel test processes would all
 *    append to one main.log, and tests never read it.
 * 2. Exit once every test in the file has finished. On Windows CI the
 *    audio-relay file intermittently reported all its tests as passing and
 *    then never exited, hanging the release build. The timer is unref'd, so a
 *    file that exits normally never reaches it; it only ends a process that
 *    lingers after its last test, keeping the exit code tests recorded.
 */
try {
  require('electron-log/main').transports.file.level = false
} catch {
  // electron-log missing or reshaped: tests still run, with file logging on.
}

const LINGER_MS = 3000
// Only in the per-file child processes the runner starts (it sets
// NODE_TEST_CONTEXT there), never in the runner that waits on them.
if (process.env.NODE_TEST_CONTEXT) {
  require('node:test').after(() => {
    setTimeout(() => process.exit(), LINGER_MS).unref()
  })
}

/**
 * Loaded into every main-process test process (see test-main.mjs).
 *
 * Tests run as many parallel Electron-as-node processes, and with file logging
 * on they all append to the same main.log. On Windows that file contention
 * intermittently left a test file (audio-relay) unable to exit, hanging the
 * release build. Tests never read the log file, so it is turned off here;
 * console output is unchanged.
 */
try {
  require('electron-log/main').transports.file.level = false
} catch {
  // electron-log missing or reshaped: tests still run, with file logging on.
}

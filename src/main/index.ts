import { IMPORT_OPTIONS, type ImportKind } from "@shared/import-menu";
import { IPC } from "@shared/ipc";
import {
  app,
  BrowserWindow,
  Menu,
  nativeImage,
  shell,
  protocol,
  ipcMain,
} from "electron";
import { PRODUCT_NAME } from "@shared/brand";
import { join, resolve } from "path";
import { createReadStream, existsSync, realpathSync } from "fs";
import { stat } from "fs/promises";
import { Readable } from "stream";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";
import log from "electron-log/main";
import { configuredMediaPaths } from "@shared/overlay-outputs";
import { presentationMediaPaths } from "@shared/program";
import {
  mediaMimeType,
  parseByteRange,
  rangeResponseHeaders,
} from "@shared/pa-media-range";
import { PA_MEDIA_URL_PREFIX } from "@shared/overlay-template";
import { openKairoFiles, registerIpcHandlers } from "./ipc";
import { initDatabase, store } from "./db";
import { lyricsService } from "./services/lyrics";
import { workspaceService } from "./services/workspace";
import { scriptureService } from "./services/scripture";
import { initOfflineBibles } from "./services/scripture/offline-bibles";
import { ndiService } from "./services/ndi";
import { surfaceManager } from "./services/output/surface-manager";
import { getMainWindow, setMainWindow } from "./main-window";
import { cloudSession } from "./services/cloud/session";
import { sermonUploader } from "./services/service-records";
import { isPickedOverlayMediaAllowed } from "./services/ndi/media-allowlist";
import { isInsideRoot, mediaService } from "./services/media";
import { tracksService } from "./services/tracks";
import { updaterService } from "./services/updater";

log.initialize();
log.transports.file.level = "info";
log.transports.console.level = is.dev ? "debug" : "warn";
app.setName(PRODUCT_NAME);
log.info(`${PRODUCT_NAME} starting`, { version: app.getVersion() });

// pa-media:// — serves the overlay theme's background image/video to both the
// renderer (Theme editor preview; its http/file origin can't load file:// under
// webSecurity) and the offscreen NDI overlay window, through one code path.
// Must be declared before app ready; `stream: true` lets <video> play from it.
protocol.registerSchemesAsPrivileged([
  {
    scheme: "pa-media",
    privileges: {
      standard: false,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
      bypassCSP: true,
    },
  },
]);

/**
 * Whether `requested` sits inside the backgrounds folder the user picked.
 *
 * The dock indexes a whole directory, so its files cannot be enumerated into an
 * exact-path allowlist the way a hand-picked theme background is — a file
 * dropped in after the last scan has to play too. That makes this a PREFIX
 * test, and the two ways a prefix test leaks are closed here:
 *
 *   - both sides are realpath'd, so a symlink inside the folder cannot point at
 *     /etc and inherit the folder's permission;
 *   - the comparison requires a path separator after the root, so a sibling
 *     directory like `<root>-private` does not match.
 *
 * The root is only ever a directory the user chose in a native picker.
 */
function isUnderAllowedFolder(requested: string): boolean {
  const roots = [
    mediaService.allowedRoot(),
    tracksService.allowedRoot(),
  ].filter((root): root is string => !!root);
  for (const root of roots) {
    try {
      if (isInsideRoot(realpathSync(requested), realpathSync(root)))
        return true;
    } catch {
      // A path that cannot be resolved (missing, or a broken symlink) is not served.
    }
  }
  return false;
}

function registerPaMediaProtocol(): void {
  protocol.handle("pa-media", (request) => {
    try {
      if (!request.url.startsWith(PA_MEDIA_URL_PREFIX)) {
        return new Response("Bad request", { status: 400 });
      }
      // Strip #fragment / ?query (e.g. `#t=0.1`); the path itself is encoded.
      const encodedPath = request.url
        .slice(PA_MEDIA_URL_PREFIX.length)
        .split(/[?#]/)[0];
      const requested = resolve(decodeURIComponent(encodedPath));

      // Allowlist: only background media the user has already configured is
      // servable — the scheme must not become an arbitrary-file-read bridge.
      // Saved library themes count too, so the Theme editor can preview a stored
      // theme in a later session (the picked-media allowlist only survives the
      // session in which the file was chosen).
      const allowed = new Set(
        [
          ...configuredMediaPaths(store.get("overlay"), store.get("themeLibrary")),
          // Logo and prop images the operator picked for the program layers.
          ...presentationMediaPaths(store.get("presentation")),
        ].map((p) => resolve(p)),
      );
      if (
        !allowed.has(requested) &&
        !isPickedOverlayMediaAllowed(requested) &&
        !isUnderAllowedFolder(requested)
      ) {
        log.warn("[pa-media] Blocked non-configured path", { requested });
        return new Response("Forbidden", { status: 403 });
      }

      return serveLocalMedia(requested, request.headers.get("Range")).catch(
        (err) => {
          log.warn("[pa-media] Request failed", (err as Error).message);
          return new Response("Bad request", { status: 400 });
        },
      );
    } catch (err) {
      log.warn("[pa-media] Request failed", (err as Error).message);
      return new Response("Bad request", { status: 400 });
    }
  });
}

/** Byte-range responses so <video> can seek and play large MP4s. */
async function serveLocalMedia(
  filePath: string,
  rangeHeader: string | null,
): Promise<Response> {
  const info = await stat(filePath);
  if (!info.isFile()) return new Response("Not found", { status: 404 });
  const type = mediaMimeType(filePath);
  const range = parseByteRange(rangeHeader, info.size);
  if (rangeHeader && !range) {
    return new Response("Range not satisfiable", {
      status: 416,
      headers: { "Content-Range": `bytes */${info.size}` },
    });
  }
  const { status, headers } = rangeResponseHeaders(info.size, type, range);
  const stream = range
    ? createReadStream(filePath, { start: range.start, end: range.end })
    : createReadStream(filePath);
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    status,
    // CORS-readable so the program window's Web Audio graph (NDI sound) gets
    // real samples from a background video instead of silence. The allowlist
    // above still decides which files are served at all.
    headers: { ...headers, "Access-Control-Allow-Origin": "*" },
  });
}

let applicationWindow: BrowserWindow | null = null;
let importReady = false;
let pendingImport: ImportKind | null = null;

function deliverImport(): void {
  if (
    !importReady ||
    !pendingImport ||
    !applicationWindow ||
    applicationWindow.isDestroyed()
  )
    return;
  applicationWindow.webContents.send(IPC.APP.IMPORT_REQUESTED, pendingImport);
  pendingImport = null;
}

ipcMain.on(IPC.APP.IMPORT_READY, (event) => {
  if (event.sender !== applicationWindow?.webContents) return;
  importReady = true;
  deliverImport();
});

function requestMenuImport(kind: ImportKind): void {
  pendingImport = kind;
  if (!applicationWindow || applicationWindow.isDestroyed()) createWindow();
  applicationWindow?.show();
  applicationWindow?.focus();
  deliverImport();
}

function importMenuTemplate(): Electron.MenuItemConstructorOptions[] {
  const items: Electron.MenuItemConstructorOptions[] = [];
  let previousRoute: string | undefined;
  for (const option of IMPORT_OPTIONS) {
    // Kairo files have no route of their own and sit in a group by themselves.
    const group = option.route ?? option.kind;
    if (previousRoute && previousRoute !== group)
      items.push({ type: "separator" });
    items.push({
      label: option.label,
      click: () => requestMenuImport(option.kind),
    });
    previousRoute = group;
  }
  return items;
}

function setupApplicationMenu(): void {
  // Standard Edit roles (Select All, Copy, Paste, …) must live on the app menu
  // or their accelerators never reach focused inputs in Electron.
  const isMac = process.platform === "darwin";
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" as const },
              {
                label: "Check for Updates…",
                click: () => {
                  void updaterService.check();
                },
              },
              { type: "separator" as const },
              { role: "services" as const },
              { type: "separator" as const },
              { role: "hide" as const },
              { role: "hideOthers" as const },
              { role: "unhide" as const },
              { type: "separator" as const },
              { role: "quit" as const },
            ],
          },
        ]
      : []),
    {
      label: "File",
      submenu: [
        { label: "Import", submenu: importMenuTemplate() },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow(): void {
  const icon = nativeImage.createFromPath(
    join(__dirname, "../../resources/icon.png"),
  );
  if (process.platform === "darwin" && app.dock && !icon.isEmpty()) {
    app.dock.setIcon(icon);
  }

  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: PRODUCT_NAME,
    icon,
    autoHideMenuBar: false,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    // Opaque on every platform: a booth screen should look the same whatever
    // is behind the window, and the desktop bleeding through reads as noise.
    // Matches --surface so there is no flash before the first paint.
    backgroundColor: "#161616",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  applicationWindow = mainWindow;
  setMainWindow(mainWindow);
  importReady = false;
  mainWindow.webContents.on("did-start-loading", () => {
    importReady = false;
  });
  mainWindow.on("closed", () => {
    if (applicationWindow === mainWindow) {
      applicationWindow = null;
      setMainWindow(null);
      importReady = false;
    }
    // Projector windows (and the offscreen NDI renderer) are windows too, so
    // they would keep `window-all-closed` from ever firing. A program with no
    // controls must not stay up on the wall: on macOS close the screens until
    // the window comes back; elsewhere closing the window quits, as before.
    if (process.platform === "darwin") {
      surfaceManager.closeScreens();
    } else {
      app.quit();
    }
  });

  // Moving the controls onto (or off) a projector's display changes whether
  // that projector is a full-screen output or a rehearsal window.
  mainWindow.on("moved", () => surfaceManager.displaysChanged());

  mainWindow.on("ready-to-show", () => {
    mainWindow.show();
    log.info("Main window shown");
  });

  // A dead renderer leaves a blank window and, without these, no trace at all.
  // Reload so the operator gets their controls back mid-service — but stop
  // after a few crashes in a row so a crash on load cannot loop forever.
  const recentCrashes: number[] = [];
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    log.error("[MainWindow] Renderer process gone", details);
    if (details.reason === "clean-exit" || mainWindow.isDestroyed()) return;
    const now = Date.now();
    recentCrashes.push(now);
    while (recentCrashes.length > 0 && now - recentCrashes[0] > 60_000) recentCrashes.shift();
    if (recentCrashes.length > 3) {
      log.error("[MainWindow] Renderer keeps crashing — not reloading again");
      return;
    }
    mainWindow.webContents.reload();
  });
  mainWindow.on("unresponsive", () => log.warn("[MainWindow] Window unresponsive"));
  mainWindow.on("responsive", () => log.info("[MainWindow] Window responsive again"));
  // Renderer errors otherwise only reach DevTools, which is closed in a service.
  mainWindow.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    if (level >= 3) log.error("[Renderer]", message, `${sourceId}:${line}`);
  });

  // Coming back to the app is the moment someone expects to see a key they just
  // pasted on the website. Throttled, so alt-tabbing is not a request per flick.
  mainWindow.on("focus", () => {
    void cloudSession.pullOrgSecrets({ throttle: true });
    // Coming back to the app often means coming back online — a good moment to
    // retry a recap that could not be published from the booth.
    sermonUploader.wake();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

// ─── Opening .kairo files from Finder / Explorer ─────────────────────────────

function kairoPathsIn(argv: string[]): string[] {
  return argv.filter(
    (arg) => arg.toLowerCase().endsWith(".kairo") && existsSync(arg),
  );
}

function openKairoFromOutside(filePaths: string[]): void {
  if (filePaths.length === 0) return;
  openKairoFiles(filePaths);
  if (!app.isReady()) return; // shown once the window loads
  if (!applicationWindow || applicationWindow.isDestroyed()) createWindow();
  if (applicationWindow?.isMinimized()) applicationWindow.restore();
  applicationWindow?.show();
  applicationWindow?.focus();
}

// macOS delivers double-clicked files here — including the one that launched
// the app, which arrives before `ready`, so this must be registered first.
app.on("open-file", (event, filePath) => {
  event.preventDefault();
  openKairoFromOutside([filePath]);
});

// Windows and Linux pass the file on the command line, to a second process
// when Kairo is already running. One instance also keeps two copies from
// writing the same song library at once. Dev is exempt so a packaged Kairo
// can stay open beside it.
if (!is.dev) {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
  } else {
    app.on("second-instance", (_event, argv) => {
      const files = kairoPathsIn(argv);
      if (files.length > 0) openKairoFromOutside(files);
      else if (applicationWindow && !applicationWindow.isDestroyed()) {
        if (applicationWindow.isMinimized()) applicationWindow.restore();
        applicationWindow.focus();
      }
    });
  }
}
if (process.platform !== "darwin") openKairoFromOutside(kairoPathsIn(process.argv.slice(1)));

app.whenReady().then(async () => {
  electronApp.setAppUserModelId("com.kairo.app");
  setupApplicationMenu();

  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  initDatabase();
  registerPaMediaProtocol();
  // The Songs folder has to exist before the library opens — the lyrics
  // service rebuilds its database from that folder's contents.
  await workspaceService.ensure();
  await workspaceService.applyDefaultMediaFolder();
  lyricsService.open();
  scriptureService.open();
  scriptureService.setDefaultTranslation(
    store.get("scripture").defaultTranslation,
  );
  initOfflineBibles();
  registerIpcHandlers();

  // M0: start the NDI sender unconditionally on launch (hardcoded transparent
  // test frame until the overlay window pushes real content). A missing/broken
  // grandiose-mac native module logs and no-ops — never blocks app boot.
  ndiService.start().catch((err) => {
    log.error("[NDI] start() failed:", (err as Error).message);
  });

  // First ProPresenter handshake is the launch gate in the renderer — connecting
  // here would retry (and log timeouts) before the operator has confirmed PP is open.

  // Checks GitHub Releases in the background; a download is never started
  // without the operator asking for it.
  updaterService.init();

  createWindow();

  // After the main window exists, so the manager can tell which display holds
  // the controls. Opens every enabled, connected screen output.
  surfaceManager.init();
  void surfaceManager.reconcile();

  app.on("activate", () => {
    // Not `getAllWindows().length` — projector and NDI windows count there.
    if (!getMainWindow()) {
      createWindow();
      void surfaceManager.reconcile();
    }
  });
});

app.on("window-all-closed", () => {
  log.info("All windows closed");
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  surfaceManager.destroyAll();
  ndiService.stop().catch((err) => {
    log.error("[NDI] stop() failed during quit:", (err as Error).message);
  });
});

process.on("uncaughtException", (error) => {
  log.error("Uncaught exception:", error);
  try {
    // Lazy require: the crashing process must not depend on the module graph
    // being fully loaded, and resilience must stay out of the startup path.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { resilienceManager } = require("./services/resilience");
    resilienceManager.serializeState();
  } catch (err) {
    log.error("Failed to serialize state during uncaughtException:", err);
  }
});

process.on("unhandledRejection", (reason, promise) => {
  log.error("Unhandled rejection at:", promise, "reason:", reason);
  try {
    // Same lazy require as above — see comment on uncaughtException.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { resilienceManager } = require("./services/resilience");
    resilienceManager.serializeState();
  } catch (err) {
    log.error("Failed to serialize state during unhandledRejection:", err);
  }
});

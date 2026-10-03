// @ts-check
// Electron main process: window, app:// protocol for the game files, and save IPC.
import { app, BrowserWindow, ipcMain, net, protocol } from 'electron';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, normalize, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SRC_DIR = fileURLToPath(new URL('../src/', import.meta.url));
const PRELOAD = fileURLToPath(new URL('./preload.cjs', import.meta.url));
/** Mirrors SAVE_FILES in src/platform/platform.js. */
const SAVE_FILES = new Set(['settings.json', 'profile.json', 'run.json']);

// Serve the game from app://game/ rather than file:// so ES modules and fetch() work normally.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

/** @param {string} name */
function savePath(name) {
  if (!SAVE_FILES.has(name)) throw new Error(`Refusing to access unknown save file "${name}"`);
  return join(app.getPath('userData'), name);
}

function registerIpc() {
  ipcMain.handle('platform:load', async (_e, name) => {
    try {
      return await readFile(savePath(name), 'utf8');
    } catch (err) {
      if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') return null;
      throw err;
    }
  });
  ipcMain.handle('platform:save', async (_e, name, text) => {
    if (typeof text !== 'string') throw new TypeError('save: text must be a string');
    const target = savePath(name);
    await mkdir(app.getPath('userData'), { recursive: true });
    // Atomic write: a crash mid-save never leaves a truncated file.
    await writeFile(`${target}.tmp`, text, 'utf8');
    await rename(`${target}.tmp`, target);
  });
  ipcMain.handle('platform:remove', async (_e, name) => {
    await rm(savePath(name), { force: true });
  });
  ipcMain.on('platform:quit', () => app.quit());
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 1280,
    minHeight: 720,
    backgroundColor: '#0b0a09',
    title: 'AetherCore',
    autoHideMenuBar: true,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  // No application menu: Alt is a game key (Exploded View) and would otherwise reveal it.
  win.removeMenu();
  win.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools();
  });
  win.loadURL('app://game/index.html');
}

app.whenReady().then(() => {
  protocol.handle('app', (request) => {
    const { pathname } = new URL(request.url);
    const file = normalize(join(SRC_DIR, decodeURIComponent(pathname)));
    if (!file.startsWith(SRC_DIR.endsWith(sep) ? SRC_DIR : SRC_DIR + sep)) {
      return new Response('Forbidden', { status: 403 });
    }
    return net.fetch(pathToFileURL(file).toString());
  });
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

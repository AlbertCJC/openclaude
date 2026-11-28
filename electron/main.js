// Desktop shell: runs the Next.js server in-process on a free localhost port and opens it in a window.
const { app, BrowserWindow, shell, Menu, ipcMain, dialog } = require('electron');
const http = require('http');
const path = require('path');

const fs = require('fs');
const crypto = require('crypto');
const { authorized } = require('./auth');

const TOKEN = crypto.randomBytes(32).toString('hex'); // per launch; handed to the window as an httpOnly cookie

const dev = !app.isPackaged && process.env.NODE_ENV !== 'production';
process.env.OPENCLAUDE_DATA = app.getPath('userData'); // config.json with API keys lives here, per-user

// GUI apps have no console on Windows: mirror logs to <userData>/main.log.
const LOG = path.join(app.getPath('userData'), 'main.log');
const log = (...a) => {
  const line = `${new Date().toISOString()} ${a.map(x => (x instanceof Error ? x.stack : String(x))).join(' ')}\n`;
  try { fs.mkdirSync(path.dirname(LOG), { recursive: true }); fs.appendFileSync(LOG, line); } catch {}
  process.stdout.write(line);
};
process.on('uncaughtException', e => log('uncaught', e));
process.on('unhandledRejection', e => log('unhandled', e));
log('start', app.getVersion(), 'packaged=' + app.isPackaged);

async function startServer() {
  const next = require('next');
  const nextApp = next({ dev, dir: path.join(__dirname, '..') });
  await nextApp.prepare();
  const handle = nextApp.getRequestHandler();
  const server = http.createServer((req, res) => {
    if (!authorized(req, TOKEN, server.address().port)) { // every path, so no URL-normalisation tricks around an /api prefix
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      return res.end('forbidden');
    }
    handle(req, res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); // localhost only, random free port
  return `http://127.0.0.1:${server.address().port}`;
}

async function createWindow() {
  const url = await startServer();
  const win = new BrowserWindow({
    width: 1280, height: 820, title: 'OpenClaude', backgroundColor: '#262624',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, 'preload.js') },
  });
  win.webContents.setWindowOpenHandler(({ url: u }) => {
    if (/^https?:\/\//.test(u)) shell.openExternal(u);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, u) => { if (!u.startsWith(url)) { e.preventDefault(); shell.openExternal(u); } });
  win.webContents.on('did-fail-load', (_e, code, desc, u) => log('fail', code, desc, u));
  win.webContents.on('did-finish-load', () => log('loaded', win.webContents.getURL()));
  ipcMain.removeHandler('pick-folder');
  ipcMain.handle('pick-folder', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  await win.webContents.session.cookies.set({ url, name: 'oc_token', value: TOKEN, httpOnly: true, sameSite: 'strict' });
  await win.loadURL(url);
}

if (!app.requestSingleInstanceLock()) { log('another instance holds the lock; quitting'); app.quit(); }
else {
  Menu.setApplicationMenu(null);
  app.whenReady().then(createWindow).catch(e => { log('startup failed', e); app.quit(); });
  app.on('window-all-closed', () => app.quit());
}

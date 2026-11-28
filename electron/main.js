// Desktop shell: runs the Next.js server in-process on a free localhost port and opens it in a window.
const { app, BrowserWindow, shell, Menu, ipcMain, dialog } = require('electron');
const http = require('http');
const path = require('path');

const fs = require('fs');
const crypto = require('crypto');
const { authorized } = require('./auth');

const TOKEN = crypto.randomBytes(32).toString('hex'); // per launch; handed to the window as an httpOnly cookie
process.env.OC_ADMIN = crypto.randomBytes(32).toString('hex'); // per launch; never leaves this process. Lets main write protected config.
const PROTECTED = ['hooks', 'allowBash', 'trustedWorkspaces', 'mcpServers', 'custom']; // keep in sync with lib/config.ts

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
  // Protected settings (hooks, allowBash, ...) can run commands, so the user confirms them in a native dialog the page can't fake.
  ipcMain.removeHandler('confirm-config');
  ipcMain.handle('confirm-config', async (e, patch) => {
    if (!e.senderFrame || !e.senderFrame.url.startsWith(url + '/')) throw new Error('forbidden');
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('bad patch');
    const headers = { cookie: `oc_token=${TOKEN}`, 'content-type': 'application/json' };
    const cur = await (await fetch(`${url}/api/config`, { headers })).json();
    const changed = PROTECTED.filter(k => k in patch && JSON.stringify(patch[k]) !== JSON.stringify(cur[k]));
    if (changed.length) {
      const diff = changed.map(k => `${k}\n  was: ${JSON.stringify(cur[k])}\n  now: ${JSON.stringify(patch[k])}`).join('\n\n');
      const { response } = await dialog.showMessageBox(win, {
        type: 'warning', title: 'Confirm settings change', buttons: ['Cancel', 'Apply'], defaultId: 0, cancelId: 0, noLink: true,
        message: `Change ${changed.join(', ')}? These settings let the agent run commands or send API keys to another server.`,
        detail: diff.length > 1500 ? `${diff.slice(0, 1500)}\n…` : diff,
      });
      if (response !== 1) return null;
      headers['x-oc-admin'] = process.env.OC_ADMIN;
    }
    const r = await fetch(`${url}/api/config`, { method: 'PUT', headers, body: JSON.stringify(patch) });
    const body = await r.json();
    if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
    return body;
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

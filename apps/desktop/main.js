// Kestrel for Mac: one window on the live site. Links to other sites open in the default browser, so the window stays
// Kestrel. The user agent says KestrelDesktop so the site hides Google sign-in (Google blocks it in embedded browsers).
const { app, BrowserWindow, shell, Menu } = require('electron');
const path = require('path');

const SITE = process.env.KESTREL_URL || 'https://kestrel.jakecapmeil.workers.dev';
const origin = new URL(SITE).origin;
// Sign-in and email confirmation go through Supabase, so its pages may load in the window too.
const allowed = (url) => { try { const u = new URL(url); return u.origin === origin || u.hostname.endsWith('.supabase.co'); } catch { return false; } };

function open() {
  const win = new BrowserWindow({
    width: 1280, height: 860, minWidth: 380, minHeight: 600,
    title: 'Kestrel', backgroundColor: '#0d0d0f', titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 16 },
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  win.webContents.setUserAgent(`${win.webContents.getUserAgent()} KestrelDesktop/${app.getVersion()}`);
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!allowed(url)) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); } });
  win.webContents.on('did-fail-load', (e, code, desc, url, isMain) => { if (isMain && code !== -3) win.loadFile(path.join(__dirname, 'offline.html')); });
  // Camera and microphone (food photos, Speak), geolocation (Record): only for Kestrel's own pages.
  win.webContents.session.setPermissionRequestHandler((wc, permission, done) => done(allowed(wc.getURL()) && ['media', 'geolocation', 'notifications', 'clipboard-sanitized-write'].includes(permission)));
  win.loadURL(SITE);
}

Menu.setApplicationMenu(Menu.buildFromTemplate([
  { role: 'appMenu' }, { role: 'editMenu' },
  { label: 'View', submenu: [{ role: 'reload' }, { role: 'togglefullscreen' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }] },
  { role: 'windowMenu' },
]));
app.whenReady().then(() => { open(); app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) open(); }); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

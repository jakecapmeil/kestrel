// Kestrel for Mac: one window on the live site. Links to other sites open in the default browser, so the window stays
// Kestrel. The user agent says KestrelDesktop so the site hides Google sign-in (Google blocks it in embedded browsers).
const { app, BrowserWindow, shell, Menu, nativeTheme, dialog, net } = require('electron');
const path = require('path');

const SITE = process.env.KESTREL_URL || 'https://kestrel.jakecapmeil.workers.dev';
const origin = new URL(SITE).origin;
// Sign-in and email confirmation go through Supabase, so its pages may load in the window too.
const allowed = (url) => { try { const u = new URL(url); return u.origin === origin || u.hostname.endsWith('.supabase.co'); } catch { return false; } };

// Updates. The site inside the window is always the live one, so most changes arrive without a new app. When the shell itself
// changes, a new .dmg goes on GitHub Releases (tag mac-vX.Y.Z); the app checks there and offers the download. It can't install
// silently: macOS only lets signed apps replace themselves, and this one is unsigned (see docs/native-apps.md).
const RELEASES = 'https://api.github.com/repos/jakecapmeil/kestrel/releases?per_page=20';
const newer = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
async function checkForUpdate(manual) {
  try {
    const res = await net.fetch(RELEASES, { headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) throw new Error('GitHub answered ' + res.status);
    const rel = (await res.json()).find((r) => !r.draft && !r.prerelease && /^mac-v\d+\.\d+\.\d+$/.test(r.tag_name));
    const version = rel?.tag_name.slice(5);
    const dmg = rel?.assets.find((a) => a.name.endsWith('.dmg') && a.name.includes(process.arch === 'arm64' ? 'arm64' : 'x64')) || rel?.assets.find((a) => a.name.endsWith('.dmg'));
    if (rel && dmg && newer(version, app.getVersion())) {
      const { response } = await dialog.showMessageBox({ type: 'info', message: `Kestrel ${version} is available`, detail: `You have ${app.getVersion()}. Download the new version, open it, and drag Kestrel to Applications to replace this one.`, buttons: ['Download', 'Later'], defaultId: 0, cancelId: 1 });
      if (response === 0) shell.openExternal(dmg.browser_download_url);
    } else if (manual) dialog.showMessageBox({ type: 'info', message: 'Kestrel is up to date', detail: `Version ${app.getVersion()}.`, buttons: ['OK'] });
  } catch (e) { if (manual) dialog.showMessageBox({ type: 'warning', message: 'Couldn’t check for updates', detail: String(e.message || e), buttons: ['OK'] }); }
}

function open() {
  const win = new BrowserWindow({
    width: 1280, height: 860, minWidth: 380, minHeight: 600,
    title: 'Kestrel', backgroundColor: nativeTheme.shouldUseDarkColors ? '#0d0d0f' : '#f5f2ea', titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 16 },
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
  { label: app.name, submenu: [{ role: 'about' }, { label: 'Check for Updates…', click: () => checkForUpdate(true) }, { type: 'separator' }, { role: 'services' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] }, { role: 'editMenu' },
  { label: 'View', submenu: [{ role: 'reload' }, { role: 'togglefullscreen' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }] },
  { role: 'windowMenu' },
]));
app.whenReady().then(() => { open(); if (app.isPackaged) { setTimeout(() => checkForUpdate(false), 5000); setInterval(() => checkForUpdate(false), 6 * 3600e3); } app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) open(); }); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

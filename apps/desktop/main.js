// Kestrel for Mac: one window on the live site. Links to other sites open in the default browser, so the window stays
// Kestrel. The user agent says KestrelDesktop so the site hides Google sign-in (Google blocks it in embedded browsers).
const { app, BrowserWindow, shell, Menu, nativeTheme, dialog, net } = require('electron');
const path = require('path');
const http = require('http');

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

// Google sign-in runs in the default browser (Google blocks embedded windows). The code comes back to this app in one
// of two ways, and the page inside the window finishes the sign-in (it holds the PKCE verifier):
//  1. Loopback (RFC 8252 §7.3, what gh, gcloud and VS Code do): while a sign-in is pending, the app listens on
//     127.0.0.1 at a random port. The port rides along in the /?appauth=start address, and the site in the browser
//     sends the code to http://127.0.0.1:<port>/auth-callback. No URL scheme, so it can't reach the wrong copy of the app.
//  2. kestrel://auth-callback?code=..., the fallback, which macOS hands to whichever Kestrel.app owns the scheme.
let main = null;
let pendingAuth = null; // a callback that arrived before the window was ready
app.setAsDefaultProtocolClient('kestrel');
// One Kestrel at a time, so a kestrel:// link never starts a second copy that has no sign-in in progress.
const firstCopy = app.requestSingleInstanceLock();
if (!firstCopy) app.quit();
app.on('second-instance', () => { if (main && !main.isDestroyed()) { if (main.isMinimized()) main.restore(); main.show(); main.focus(); } });

function deliverAuth(url) {
  if (!main || main.isDestroyed() || main.webContents.isLoading()) { pendingAuth = url; return; }
  pendingAuth = null;
  main.webContents.executeJavaScript(`window.kestrelAuthCallback ? (window.kestrelAuthCallback(${JSON.stringify(url)}), true) : false`)
    .then((ok) => { if (!ok) pendingAuth = url; }).catch(() => { pendingAuth = url; });
  if (main.isMinimized()) main.restore();
  main.show(); main.focus(); app.focus({ steal: true });
}
app.on('open-url', (e, url) => {
  e.preventDefault();
  if (/^kestrel:\/\/auth-callback/.test(url)) deliverAuth(url);
});

let loop = null;
let loopTimer = null;
const DONE_PAGE = (ok) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kestrel</title>
<body style="font:16px -apple-system,system-ui,sans-serif;background:#f5f2ea;color:#1b1b1d;display:grid;place-items:center;min-height:90vh;margin:0">
<div style="text-align:center;max-width:360px;padding:24px"><h2 style="margin:0 0 8px">${ok ? 'Signed in' : 'Sign-in didn’t finish'}</h2>
<p style="margin:0;color:#555">${ok ? 'You can close this tab and go back to the Kestrel app.' : 'Go back to the Kestrel app and try Continue with Google again.'}</p></div></body>`;
// Listens for ten minutes after a sign-in starts; returns the port.
function startLoopback() {
  return new Promise((resolve) => {
    clearTimeout(loopTimer);
    loopTimer = setTimeout(stopLoopback, 10 * 60e3);
    if (loop) return resolve(loop.address().port);
    loop = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://127.0.0.1');
      if (req.method !== 'GET' || u.pathname !== '/auth-callback') { res.writeHead(404); res.end(); return; }
      const ok = u.searchParams.has('code');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(DONE_PAGE(ok));
      if (ok || u.searchParams.has('error')) { deliverAuth('kestrel://auth-callback' + u.search); setTimeout(stopLoopback, 2000); }
    });
    loop.on('error', () => { loop = null; resolve(0); });
    loop.listen(0, '127.0.0.1', () => resolve(loop.address().port));
  });
}
function stopLoopback() { clearTimeout(loopTimer); if (loop) { loop.close(); loop = null; } }

function open() {
  const win = new BrowserWindow({
    width: 1280, height: 860, minWidth: 380, minHeight: 600,
    title: 'Kestrel', backgroundColor: nativeTheme.shouldUseDarkColors ? '#0d0d0f' : '#f5f2ea', titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 16 },
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  win.webContents.setUserAgent(`${win.webContents.getUserAgent()} KestrelDesktop/${app.getVersion()}`);
  win.webContents.setWindowOpenHandler(({ url }) => {
    // A Google sign-in: add the loopback port so the browser can hand the code straight back.
    if (url.startsWith(origin + '/?appauth=start')) startLoopback().then((port) => shell.openExternal(port ? `${url}&port=${port}` : url));
    else if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('did-finish-load', () => { if (pendingAuth) setTimeout(() => pendingAuth && deliverAuth(pendingAuth), 1500); });
  win.webContents.on('will-navigate', (e, url) => { if (!allowed(url)) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); } });
  win.webContents.on('did-fail-load', (e, code, desc, url, isMain) => { if (isMain && code !== -3) win.loadFile(path.join(__dirname, 'offline.html')); });
  // Camera and microphone (food photos, Speak), geolocation (Record): only for Kestrel's own pages.
  win.webContents.session.setPermissionRequestHandler((wc, permission, done) => done(allowed(wc.getURL()) && ['media', 'geolocation', 'notifications', 'clipboard-sanitized-write'].includes(permission)));
  main = win;
  win.loadURL(SITE);
}

Menu.setApplicationMenu(Menu.buildFromTemplate([
  { label: app.name, submenu: [{ role: 'about' }, { label: 'Check for Updates…', click: () => checkForUpdate(true) }, { type: 'separator' }, { role: 'services' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] }, { role: 'editMenu' },
  { label: 'View', submenu: [{ role: 'reload' }, { role: 'togglefullscreen' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }] },
  { role: 'windowMenu' },
]));
app.whenReady().then(() => { if (!firstCopy) return; open(); if (app.isPackaged) { setTimeout(() => checkForUpdate(false), 5000); setInterval(() => checkForUpdate(false), 6 * 3600e3); } app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) open(); }); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

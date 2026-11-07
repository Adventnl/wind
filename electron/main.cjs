const {
  app,
  BrowserWindow,
  protocol,
  net,
  session,
  desktopCapturer,
  Menu,
  shell,
} = require('electron');
const { join, resolve, sep } = require('node:path');
const { pathToFileURL } = require('node:url');
const { mkdirSync } = require('node:fs');
const { execFileSync } = require('node:child_process');

// On this Linux machine, fail closed if the rotational data mount is missing.
if (process.platform === 'linux') {
  const storage = '/srv/storage';
  try {
    const mount = execFileSync('findmnt', ['-n', '-o', 'TARGET,SOURCE', '-T', storage], {
      encoding: 'utf8',
    })
      .trim()
      .split(/\s+/);
    const rotation = execFileSync('lsblk', ['-dn', '-o', 'ROTA', mount[1]], {
      encoding: 'utf8',
    }).trim();
    if (mount[0] !== storage || rotation !== '1')
      throw new Error('Storage must be a mounted rotational HDD.');
    const userData = resolve(process.env.WIND_DATA_DIR || join(storage, 'data/wind-desktop'));
    if (!userData.startsWith(storage + sep)) throw new Error('App data must stay on the HDD.');
    mkdirSync(userData, { recursive: true });
    app.setPath('userData', userData);
    app.setPath('sessionData', userData);
    app.commandLine.appendSwitch('disk-cache-dir', join(storage, 'cache/wind/desktop'));
  } catch (error) {
    console.error('Wind requires the /srv/storage HDD mount:', error.message);
    app.exit(1);
  }
}
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'wind',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
let main;
app.whenReady().then(() => {
  const root = resolve(__dirname, '../dist');
  protocol.handle('wind', (request) => {
    const url = new URL(request.url);
    if (url.host !== 'app') return new Response('Forbidden', { status: 403 });
    const file = resolve(
      root,
      '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname),
    );
    if (!file.startsWith(root + sep)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).href).then((response) => {
      const headers = new Headers(response.headers);
      headers.set(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' https: wss: http://localhost:* ws://localhost:* http://127.0.0.1:* ws://127.0.0.1:*; img-src 'self' data: blob:; media-src 'self' blob: https:; frame-src https://www.youtube-nocookie.com https://player.vimeo.com; object-src 'none'",
      );
      return new Response(response.body, { status: response.status, headers });
    });
  });
  const trusted = (origin) => origin === 'wind://app' || origin?.startsWith('wind://app/');
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => {
    callback(
      trusted(contents.getURL()) && ['media', 'display-capture', 'fullscreen'].includes(permission),
    );
  });
  session.defaultSession.setPermissionCheckHandler(
    (contents, permission, origin) =>
      trusted(origin) && ['media', 'display-capture', 'fullscreen'].includes(permission),
  );
  session.defaultSession.setDisplayMediaRequestHandler(
    async (request, callback) => {
      if (!trusted(request.securityOrigin)) return callback({});
      try {
        const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
        let answered = false;
        const choose = (video) => {
          if (!answered) {
            answered = true;
            callback(video ? { video } : {});
          }
        };
        const menu = Menu.buildFromTemplate([
          { label: 'Choose what to share', enabled: false },
          { type: 'separator' },
          ...sources.map((source) => ({ label: source.name, click: () => choose(source) })),
          { type: 'separator' },
          { label: 'Cancel', click: () => choose() },
        ]);
        menu.popup({ window: main, callback: () => choose() });
      } catch {
        callback({});
      }
    },
    { useSystemPicker: true },
  );
  const create = () => {
    main = new BrowserWindow({
      width: 1440,
      height: 940,
      minWidth: 380,
      minHeight: 600,
      title: 'Wind',
      backgroundColor: '#16191d',
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
      },
    });
    main.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//.test(url)) void shell.openExternal(url);
      return { action: 'deny' };
    });
    main.webContents.on('will-navigate', (event, url) => {
      if (!trusted(url)) event.preventDefault();
    });
    void main.loadURL('wind://app/');
  };
  create();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) create();
  });
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

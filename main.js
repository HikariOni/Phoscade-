const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fsp = require('fs').promises;

const SMOKE = !!process.env.SMOKE;

/* export / secuencia PNG: el renderer manda los frames ya codificados
   (ArrayBuffer PNG) y aqui se guardan en la carpeta elegida. */
ipcMain.handle('save-png-sequence', async (_event, payload) => {
  const rawName = (payload && payload.name) || 'dither-seq';
  const name = String(rawName).replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '_').slice(0, 64) || 'dither-seq';
  const items = (payload && payload.items && payload.items.length) ? payload.items : [];
  const res = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: path.join(app.getPath('downloads'), name)
  });
  if (res.canceled || !res.filePaths.length) return { canceled: true };
  const dir = res.filePaths[0];
  const digits = Math.max(4, String(items.length).length);
  let count = 0;
  for (const it of items) {
    const idx = (it && it.index) != null ? Math.max(0, it.index | 0) : count;
    const label = String(idx).padStart(digits, '0');
    await fsp.writeFile(path.join(dir, name + '.' + label + '.png'), Buffer.from(it.bytes));
    count++;
  }
  return { canceled: false, count, dir };
});

function createWindow() {
  const t0 = Date.now();
  const win = new BrowserWindow({
    width: 1560,
    height: 980,
    minWidth: 1080,
    minHeight: 680,
    show: false,
    backgroundColor: '#070a13',
    title: 'Dither Studio',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  });

  win.once('ready-to-show', () => {
    console.log(`[boot] ready-to-show en ${Date.now() - t0} ms`);
    win.show();
  });

  win.loadFile(path.join(__dirname, 'src', 'index.html'));

  win.webContents.on('console-message', (event, ...args) => {
    const level = typeof args[0] === 'object' ? args[0].level : args[0];
    const message = typeof args[0] === 'object' ? args[0].message : args[1];
    if (SMOKE || level === 2 || level === 3 || level === 'error') {
      console.log(`[renderer] ${message}`);
    }
  });

  if (SMOKE) {
    win.webContents.on('did-finish-load', () => {
      setTimeout(() => {
        console.log('SMOKE_OK');
        app.exit(0);
      }, 2500);
    });
    win.webContents.on('render-process-gone', (_e, d) => {
      console.log('SMOKE_CRASH:' + d.reason);
      app.exit(1);
    });
  }
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
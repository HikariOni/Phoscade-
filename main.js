const { app, BrowserWindow } = require('electron');
const path = require('path');

const SMOKE = !!process.env.SMOKE;

function createWindow() {
  const win = new BrowserWindow({
    width: 1560,
    height: 980,
    minWidth: 1080,
    minHeight: 680,
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
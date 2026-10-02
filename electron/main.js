import { app, BrowserWindow, dialog, shell } from 'electron';
import path from 'node:path';
import { createService } from '../src/service.js';
import { createApp } from '../src/app.js';

if (process.env.TICKER_USERDATA) app.setPath('userData', process.env.TICKER_USERDATA);

const isHttps = (target) => /^https:\/\//.test(target);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let win = null;
  let service = null;

  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => service?.stop());

  app.whenReady().then(async () => {
    service = createService({ settingsFile: path.join(app.getPath('userData'), 'settings.json') });
    const server = createApp(service);
    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
    } catch (err) {
      dialog.showErrorBox('Ticker de Ações', `Não foi possível arrancar o servidor interno: ${err.message}`);
      app.quit();
      return;
    }
    const url = `http://127.0.0.1:${server.address().port}/`;
    service.start();

    win = new BrowserWindow({
      width: 1200,
      height: 900,
      backgroundColor: '#0b0e14',
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    win.webContents.setWindowOpenHandler(({ url: target }) => {
      if (isHttps(target)) shell.openExternal(target);
      return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (event, target) => {
      if (target.startsWith(url)) return;
      event.preventDefault();
      if (isHttps(target)) shell.openExternal(target);
    });

    if (process.env.TICKER_SMOKE) {
      win.webContents.once('did-finish-load', async () => {
        const info = await win.webContents.executeJavaScript(
          'document.title + "|" + Boolean(document.getElementById("add-btn"))',
        );
        console.log(`SMOKE-OK ${info}`);
        app.quit();
      });
    }
    win.loadURL(url);
  });
}

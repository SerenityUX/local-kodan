const { BrowserWindow, ipcMain } = require('electron');
const path = require('path');

let manageWindow = null;

function createManageWindow(type) {
  if (manageWindow) {
    manageWindow.focus();
    return;
  }

  manageWindow = new BrowserWindow({
    width: 600,
    height: 400,
    title: type === 'baseModel' ? 'Manage Base Models' : 'Manage LoRa Modules',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  manageWindow.loadFile(path.join(__dirname, '../public/manage.html'));

  manageWindow.webContents.on('did-finish-load', () => {
    manageWindow.webContents.send('set-manage-type', type);
  });

  manageWindow.on('closed', () => {
    manageWindow = null;
  });
}

module.exports = { createManageWindow };
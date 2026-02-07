const { app, BrowserWindow } = require('electron');
const path = require('path');
const TerminalManager = require('./terminal-manager');
const { SSHManager } = require('./ssh-manager');
const CredentialStore = require('./credential-store');
const { registerHandlers } = require('./ipc-handlers');

app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

let mainWindow;
let terminalManager;
let sshManager;
let credentialStore;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 600,
    minHeight: 400,
    frame: false,
    backgroundColor: '#0f1117',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      devTools: !app.isPackaged ? true : false,
    },
    icon: path.join(__dirname, '..', '..', 'assets', 'icon.png'),
  });

  terminalManager = new TerminalManager();
  credentialStore = new CredentialStore();
  sshManager = new SSHManager(credentialStore);

  registerHandlers(mainWindow, terminalManager, sshManager, credentialStore);

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('maximize', () => {
    mainWindow.webContents.send('window:maximize-change', true);
  });

  mainWindow.on('unmaximize', () => {
    mainWindow.webContents.send('window:maximize-change', false);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(createWindow);

app.on('before-quit', () => {
  if (terminalManager) terminalManager.closeAll();
  if (sshManager) sshManager.closeAll();
});

app.on('window-all-closed', () => {
  app.quit();
});

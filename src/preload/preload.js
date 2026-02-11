const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,

  createTerminal: (cols, rows) => ipcRenderer.invoke('terminal:create', cols, rows),
  createSSHTerminal: (profileId, cols, rows) => ipcRenderer.invoke('terminal:create-ssh', profileId, cols, rows),
  writeTerminal: (id, data) => ipcRenderer.send('terminal:input', id, data),
  resizeTerminal: (id, cols, rows) => ipcRenderer.send('terminal:resize', id, cols, rows),
  closeTerminal: (id) => ipcRenderer.send('terminal:close', id),

  onTerminalOutput: (callback) => {
    const listener = (_event, id, data) => callback(id, data);
    ipcRenderer.on('terminal:output', listener);
    return () => ipcRenderer.removeListener('terminal:output', listener);
  },

  onTerminalExit: (callback) => {
    const listener = (_event, id, exitCode) => callback(id, exitCode);
    ipcRenderer.on('terminal:exit', listener);
    return () => ipcRenderer.removeListener('terminal:exit', listener);
  },

  getSSHProfiles: () => ipcRenderer.invoke('ssh:get-profiles'),
  saveSSHProfile: (profile) => ipcRenderer.invoke('ssh:save-profile', profile),
  deleteSSHProfile: (id) => ipcRenderer.invoke('ssh:delete-profile', id),
  testSSHConnection: (profile) => ipcRenderer.invoke('ssh:test-connection', profile),

  selectFile: () => ipcRenderer.invoke('dialog:select-file'),
  selectFolder: () => ipcRenderer.invoke('dialog:select-folder'),
  readDirectory: (dirPath) => ipcRenderer.invoke('dialog:read-directory', dirPath),
  uploadToSSH: (profileId, localPath, remotePath, selectedFiles) => ipcRenderer.invoke('ssh:upload', profileId, localPath, remotePath, selectedFiles),

  onUploadProgress: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('ssh:upload-progress', listener);
    return () => ipcRenderer.removeListener('ssh:upload-progress', listener);
  },

  runGitHubSetup: (config) => ipcRenderer.invoke('github:run-setup', config),
  saveGitHubConfig: (config) => ipcRenderer.invoke('github:save-config', config),
  getGitHubConfigs: () => ipcRenderer.invoke('github:get-configs'),
  deleteGitHubConfig: (id) => ipcRenderer.invoke('github:delete-config', id),
  validateGitHubPAT: (pat) => ipcRenderer.invoke('github:validate-pat', pat),
  onGitHubSetupProgress: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('github:setup-progress', listener);
    return () => ipcRenderer.removeListener('github:setup-progress', listener);
  },

  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  maximizeWindow: () => ipcRenderer.send('window:maximize'),
  closeWindow: () => ipcRenderer.send('window:close'),

  onMaximizeChange: (callback) => {
    const listener = (_event, isMaximized) => callback(isMaximized);
    ipcRenderer.on('window:maximize-change', listener);
    return () => ipcRenderer.removeListener('window:maximize-change', listener);
  },
});

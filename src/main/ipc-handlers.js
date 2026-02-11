const { ipcMain, dialog } = require('electron');
const fs = require('fs');
const path = require('path');

function registerHandlers(mainWindow, terminalManager, sshManager, credentialStore, githubSetup) {
  ipcMain.handle('terminal:create', async (_event, cols, rows) => {
    const terminal = terminalManager.create(cols, rows);

    terminal.proc.onData((data) => {
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send('terminal:output', terminal.id, data);
      }
    });

    terminal.proc.onExit(({ exitCode }) => {
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send('terminal:exit', terminal.id, exitCode);
      }
    });

    return terminal.id;
  });

  ipcMain.handle('terminal:create-ssh', async (_event, profileId, cols, rows) => {
    const terminal = await sshManager.create(profileId, cols, rows);

    terminal.on('data', (data) => {
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send('terminal:output', terminal.id, data);
      }
    });

    terminal.on('close', () => {
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send('terminal:exit', terminal.id, 0);
      }
    });

    return terminal.id;
  });

  ipcMain.on('terminal:input', (_event, id, data) => {
    if (!terminalManager.write(id, data)) {
      sshManager.write(id, data);
    }
  });

  ipcMain.on('terminal:resize', (_event, id, cols, rows) => {
    if (!terminalManager.resize(id, cols, rows)) {
      sshManager.resize(id, cols, rows);
    }
  });

  ipcMain.on('terminal:close', (_event, id) => {
    if (!terminalManager.close(id)) {
      sshManager.close(id);
    }
  });

  ipcMain.handle('ssh:get-profiles', async () => {
    return credentialStore.getProfiles();
  });

  ipcMain.handle('ssh:save-profile', async (_event, profile) => {
    return credentialStore.saveProfile(profile);
  });

  ipcMain.handle('ssh:delete-profile', async (_event, id) => {
    credentialStore.deleteProfile(id);
    return true;
  });

  ipcMain.handle('ssh:test-connection', async (_event, profile) => {
    try {
      await sshManager.testConnection(profile);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('dialog:select-file', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('dialog:select-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('dialog:read-directory', async (_event, dirPath) => {
    const maxFiles = 5000;
    const maxDepth = 10;
    let fileCount = 0;
    let dirCount = 0;
    let truncated = false;

    function walk(absPath, relPath, depth) {
      if (depth > maxDepth) {
        return { name: path.basename(absPath), relativePath: relPath, isDir: true, children: [] };
      }
      let entries;
      try {
        entries = fs.readdirSync(absPath, { withFileTypes: true });
      } catch {
        return { name: path.basename(absPath), relativePath: relPath, isDir: true, children: [] };
      }
      entries.sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      const children = [];
      for (const entry of entries) {
        const childAbs = path.join(absPath, entry.name);
        const childRel = relPath ? relPath + '/' + entry.name : entry.name;
        if (entry.isDirectory()) {
          dirCount++;
          children.push(walk(childAbs, childRel, depth + 1));
        } else {
          fileCount++;
          if (fileCount <= maxFiles) {
            children.push({ name: entry.name, relativePath: childRel, isDir: false, children: [] });
          } else {
            truncated = true;
          }
        }
      }
      return { name: path.basename(absPath), relativePath: relPath, isDir: true, children };
    }

    const tree = walk(dirPath, '', 0);
    return { tree, totalFiles: fileCount, totalDirs: dirCount, truncated };
  });

  ipcMain.handle('ssh:upload', async (_event, profileId, localPath, remotePath, selectedFiles) => {
    try {
      const result = await sshManager.upload(profileId, localPath, remotePath, (progress) => {
        if (!mainWindow.isDestroyed()) {
          mainWindow.webContents.send('ssh:upload-progress', progress);
        }
      }, selectedFiles);
      return { success: true, uploaded: result.uploaded };
    } catch (err) {
      return { success: false, error: err.message || String(err) };
    }
  });

  // GitHub setup handlers

  ipcMain.handle('github:run-setup', async (_event, config) => {
    try {
      const result = await githubSetup.runSetup(config.profileId, config, (progress) => {
        if (!mainWindow.isDestroyed()) {
          mainWindow.webContents.send('github:setup-progress', progress);
        }
      }, config.startFromStep || 0);
      return result;
    } catch (err) {
      return { success: false, error: err.message || String(err) };
    }
  });

  ipcMain.handle('github:save-config', async (_event, config) => {
    return credentialStore.saveGitHubConfig(config);
  });

  ipcMain.handle('github:get-configs', async () => {
    return credentialStore.getGitHubConfigs();
  });

  ipcMain.handle('github:delete-config', async (_event, id) => {
    credentialStore.deleteGitHubConfig(id);
    return true;
  });

  ipcMain.handle('github:validate-pat', async (_event, { pat }) => {
    return githubSetup.validatePAT(pat);
  });

  ipcMain.on('window:minimize', () => {
    if (!mainWindow.isDestroyed()) mainWindow.minimize();
  });

  ipcMain.on('window:maximize', () => {
    if (mainWindow.isDestroyed()) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });

  ipcMain.on('window:close', () => {
    if (!mainWindow.isDestroyed()) mainWindow.close();
  });
}

module.exports = { registerHandlers };

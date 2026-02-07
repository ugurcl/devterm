const { Client } = require('ssh2');
const { v4: uuidv4 } = require('uuid');
const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');

class SSHTerminal extends EventEmitter {
  constructor(id, client, stream) {
    super();
    this.id = id;
    this.client = client;
    this.stream = stream;
  }

  write(data) {
    try { this.stream.write(data); } catch (_) {}
  }

  resize(cols, rows) {
    this.stream.setWindow(rows, cols, 0, 0);
  }

  close() {
    this.stream.end();
    this.client.end();
  }
}

class SSHManager {
  constructor(credentialStore) {
    this.sessions = new Map();
    this.credentialStore = credentialStore;
  }

  async create(profileId, cols, rows) {
    const profile = this.credentialStore.getProfile(profileId);
    if (!profile) throw new Error('SSH profile not found');

    const decrypted = this.credentialStore.decryptCredentials(profile);

    return new Promise((resolve, reject) => {
      const client = new Client();
      const id = uuidv4().slice(0, 8);

      client.on('ready', () => {
        client.shell({ cols, rows, term: 'xterm-256color' }, (err, stream) => {
          if (err) {
            client.end();
            reject(err);
            return;
          }

          const terminal = new SSHTerminal(id, client, stream);

          stream.on('data', (data) => terminal.emit('data', data.toString()));
          stream.on('close', () => {
            this.sessions.delete(id);
            terminal.emit('close');
          });

          this.sessions.set(id, terminal);
          resolve(terminal);
        });
      });

      client.on('error', (err) => reject(err));

      const connectConfig = {
        host: decrypted.host,
        port: decrypted.port || 22,
        username: decrypted.username,
      };

      if (decrypted.authType === 'key') {
        try {
          connectConfig.privateKey = fs.readFileSync(decrypted.privateKeyPath);
        } catch (err) {
          reject(new Error('Cannot read private key: ' + err.message));
          return;
        }
        if (decrypted.passphrase) connectConfig.passphrase = decrypted.passphrase;
      } else {
        connectConfig.password = decrypted.password;
      }

      client.connect(connectConfig);
    });
  }

  async testConnection(profile) {
    return new Promise((resolve, reject) => {
      const client = new Client();

      client.on('ready', () => {
        client.end();
        resolve(true);
      });

      client.on('error', (err) => reject(err));

      const connectConfig = {
        host: profile.host,
        port: profile.port || 22,
        username: profile.username,
        readyTimeout: 10000,
      };

      if (profile.authType === 'key') {
        try {
          connectConfig.privateKey = fs.readFileSync(profile.privateKeyPath);
        } catch (err) {
          reject(new Error('Cannot read private key: ' + err.message));
          return;
        }
        if (profile.passphrase) connectConfig.passphrase = profile.passphrase;
      } else {
        connectConfig.password = profile.password;
      }

      client.connect(connectConfig);
    });
  }

  write(id, data) {
    const session = this.sessions.get(id);
    if (!session) return false;
    session.write(data);
    return true;
  }

  resize(id, cols, rows) {
    const session = this.sessions.get(id);
    if (!session) return false;
    session.resize(cols, rows);
    return true;
  }

  close(id) {
    const session = this.sessions.get(id);
    if (!session) return false;
    session.close();
    this.sessions.delete(id);
    return true;
  }

  closeAll() {
    this.sessions.forEach((session) => session.close());
    this.sessions.clear();
  }

  async upload(profileId, localPath, remotePath, onProgress, selectedFiles) {
    const profile = this.credentialStore.getProfile(profileId);
    if (!profile) throw new Error('SSH profile not found');

    const decrypted = this.credentialStore.decryptCredentials(profile);
    const stats = fs.statSync(localPath);
    const isDir = stats.isDirectory();

    if (remotePath.endsWith('/')) {
      remotePath = remotePath + path.basename(localPath);
    }

    const fileSet = (selectedFiles && isDir) ? new Set(selectedFiles) : null;
    let dirPrefixes = null;
    if (fileSet) {
      dirPrefixes = new Set();
      for (const rel of fileSet) {
        const parts = rel.split('/');
        let prefix = '';
        for (let i = 0; i < parts.length - 1; i++) {
          prefix += (i > 0 ? '/' : '') + parts[i];
          dirPrefixes.add(prefix);
        }
      }
    }

    const totalFiles = isDir ? this._countFiles(localPath, fileSet, localPath) : 1;
    const state = { uploaded: 0, total: totalFiles };

    return new Promise((resolve, reject) => {
      const client = new Client();

      client.on('ready', () => {
        client.sftp(async (err, sftp) => {
          if (err) { client.end(); reject(err); return; }
          try {
            if (isDir) {
              await this._uploadDir(sftp, localPath, remotePath, onProgress, state, fileSet, dirPrefixes, localPath);
            } else {
              const remoteDir = remotePath.substring(0, remotePath.lastIndexOf('/'));
              if (remoteDir) await this._mkdirpSftp(sftp, remoteDir);
              await this._uploadFile(sftp, localPath, remotePath);
              state.uploaded = 1;
              if (onProgress) onProgress({ uploaded: 1, total: 1, file: path.basename(localPath) });
            }
            client.end();
            resolve({ success: true, uploaded: state.uploaded });
          } catch (uploadErr) {
            client.end();
            reject(uploadErr);
          }
        });
      });

      client.on('error', reject);

      const connectConfig = {
        host: decrypted.host,
        port: decrypted.port || 22,
        username: decrypted.username,
        readyTimeout: 15000,
      };

      if (decrypted.authType === 'key') {
        try {
          connectConfig.privateKey = fs.readFileSync(decrypted.privateKeyPath);
        } catch (err) {
          reject(new Error('Cannot read private key: ' + err.message));
          return;
        }
        if (decrypted.passphrase) connectConfig.passphrase = decrypted.passphrase;
      } else {
        connectConfig.password = decrypted.password;
      }

      client.connect(connectConfig);
    });
  }

  _countFiles(dirPath, fileSet, basePath) {
    let count = 0;
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        count += this._countFiles(fullPath, fileSet, basePath);
      } else {
        if (fileSet) {
          const rel = path.relative(basePath, fullPath).replace(/\\/g, '/');
          if (!fileSet.has(rel)) continue;
        }
        count++;
      }
    }
    return count;
  }

  _uploadFile(sftp, localPath, remotePath) {
    return new Promise((resolve, reject) => {
      sftp.fastPut(localPath, remotePath, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async _uploadDir(sftp, localDir, remoteDir, onProgress, state, fileSet, dirPrefixes, basePath) {
    await this._mkdirpSftp(sftp, remoteDir);
    const entries = fs.readdirSync(localDir, { withFileTypes: true });
    for (const entry of entries) {
      const localFull = path.join(localDir, entry.name);
      const remoteFull = remoteDir + '/' + entry.name;
      if (entry.isDirectory()) {
        if (dirPrefixes) {
          const dirRel = path.relative(basePath, localFull).replace(/\\/g, '/');
          if (!dirPrefixes.has(dirRel)) continue;
        }
        await this._uploadDir(sftp, localFull, remoteFull, onProgress, state, fileSet, dirPrefixes, basePath);
      } else {
        if (fileSet) {
          const rel = path.relative(basePath, localFull).replace(/\\/g, '/');
          if (!fileSet.has(rel)) continue;
        }
        await this._uploadFile(sftp, localFull, remoteFull);
        state.uploaded++;
        if (onProgress) onProgress({ uploaded: state.uploaded, total: state.total, file: entry.name });
      }
    }
  }

  async _mkdirpSftp(sftp, dir) {
    if (!dir || dir === '/') return;
    const parts = dir.split('/').filter(Boolean);
    let current = '';
    for (const part of parts) {
      current += '/' + part;
      await new Promise((resolve) => {
        sftp.mkdir(current, (err) => resolve());
      });
    }
  }
}

module.exports = { SSHManager, SSHTerminal };

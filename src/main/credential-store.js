const { safeStorage, app } = require('electron');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

class CredentialStore {
  constructor() {
    this.filePath = path.join(app.getPath('userData'), 'ssh-profiles.json');
  }

  _loadRaw() {
    if (!fs.existsSync(this.filePath)) return [];
    try {
      return JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
    } catch {
      return [];
    }
  }

  _saveRaw(profiles) {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(profiles, null, 2), { mode: 0o600 });
  }

  _encrypt(text) {
    if (!text) return '';
    if (!safeStorage.isEncryptionAvailable()) return text;
    return safeStorage.encryptString(text).toString('base64');
  }

  _decrypt(encoded) {
    if (!encoded) return '';
    if (!safeStorage.isEncryptionAvailable()) return encoded;
    try {
      return safeStorage.decryptString(Buffer.from(encoded, 'base64'));
    } catch {
      return encoded;
    }
  }

  getProfiles() {
    return this._loadRaw().map(p => ({
      id: p.id,
      name: p.name,
      host: p.host,
      port: p.port,
      username: p.username,
      authType: p.authType,
      color: p.color || '#7aa2f7',
    }));
  }

  getProfile(id) {
    return this._loadRaw().find(p => p.id === id) || null;
  }

  decryptCredentials(profile) {
    if (!profile) return null;
    const result = { ...profile };
    if (profile.password) result.password = this._decrypt(profile.password);
    if (profile.passphrase) result.passphrase = this._decrypt(profile.passphrase);
    return result;
  }

  saveProfile(profile) {
    const profiles = this._loadRaw();
    const encrypted = { ...profile };

    if (profile.password) encrypted.password = this._encrypt(profile.password);
    if (profile.passphrase) encrypted.passphrase = this._encrypt(profile.passphrase);

    if (!profile.id) {
      encrypted.id = uuidv4().slice(0, 8);
      profiles.push(encrypted);
    } else {
      const idx = profiles.findIndex(p => p.id === profile.id);
      if (idx !== -1) profiles[idx] = encrypted;
      else profiles.push(encrypted);
    }

    this._saveRaw(profiles);
    return encrypted.id;
  }

  deleteProfile(id) {
    const profiles = this._loadRaw().filter(p => p.id !== id);
    this._saveRaw(profiles);
  }
}

module.exports = CredentialStore;

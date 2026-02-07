const fs = require('fs');
const os = require('os');

const mockTestDir = require('path').join(os.tmpdir(), 'devterm-test-' + process.pid);

jest.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from('enc:' + s),
    decryptString: (b) => b.toString().replace('enc:', ''),
  },
  app: {
    getPath: () => mockTestDir,
  },
}));

const CredentialStore = require('../src/main/credential-store');

describe('CredentialStore', () => {
  let store;

  beforeEach(() => {
    store = new CredentialStore();
    if (!fs.existsSync(mockTestDir)) fs.mkdirSync(mockTestDir, { recursive: true });
    if (fs.existsSync(store.filePath)) fs.unlinkSync(store.filePath);
  });

  afterAll(() => {
    try {
      if (fs.existsSync(store.filePath)) fs.unlinkSync(store.filePath);
      if (fs.existsSync(mockTestDir)) fs.rmdirSync(mockTestDir);
    } catch {}
  });

  test('returns empty profiles when no file exists', () => {
    const profiles = store.getProfiles();
    expect(profiles).toEqual([]);
  });

  test('saves and retrieves a profile', () => {
    const id = store.saveProfile({
      name: 'Test Server',
      host: '192.168.1.1',
      port: 22,
      username: 'root',
      authType: 'password',
      password: 'secret123',
      color: '#ff0000',
    });

    expect(id).toBeTruthy();

    const profiles = store.getProfiles();
    expect(profiles.length).toBe(1);
    expect(profiles[0].name).toBe('Test Server');
    expect(profiles[0].host).toBe('192.168.1.1');
    expect(profiles[0].password).toBeUndefined();
  });

  test('encrypts password on save', () => {
    store.saveProfile({
      name: 'Encrypted',
      host: '10.0.0.1',
      port: 22,
      username: 'admin',
      authType: 'password',
      password: 'mypassword',
    });

    const raw = JSON.parse(fs.readFileSync(store.filePath, 'utf-8'));
    expect(raw[0].password).not.toBe('mypassword');
  });

  test('decrypts credentials', () => {
    store.saveProfile({
      name: 'Decrypt Test',
      host: '10.0.0.2',
      port: 22,
      username: 'user',
      authType: 'password',
      password: 'secret',
    });

    const profile = store.getProfile(store.getProfiles()[0].id);
    const decrypted = store.decryptCredentials(profile);
    expect(decrypted.password).toBe('secret');
  });

  test('deletes a profile', () => {
    store.saveProfile({ name: 'A', host: 'a', username: 'a', authType: 'password' });
    store.saveProfile({ name: 'B', host: 'b', username: 'b', authType: 'password' });

    expect(store.getProfiles().length).toBe(2);

    const idToDelete = store.getProfiles()[0].id;
    store.deleteProfile(idToDelete);

    expect(store.getProfiles().length).toBe(1);
  });

  test('updates existing profile', () => {
    const id = store.saveProfile({
      name: 'Original',
      host: '10.0.0.1',
      username: 'root',
      authType: 'password',
    });

    store.saveProfile({
      id,
      name: 'Updated',
      host: '10.0.0.2',
      username: 'admin',
      authType: 'password',
    });

    const profiles = store.getProfiles();
    expect(profiles.length).toBe(1);
    expect(profiles[0].name).toBe('Updated');
    expect(profiles[0].host).toBe('10.0.0.2');
  });

  test('returns null for unknown profile', () => {
    expect(store.getProfile('nonexistent')).toBeNull();
  });
});

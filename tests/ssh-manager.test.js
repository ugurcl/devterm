jest.mock('ssh2', () => {
  const { EventEmitter } = require('events');
  class MockClient extends EventEmitter {
    connect() {
      setTimeout(() => this.emit('ready'), 10);
    }
    shell(opts, callback) {
      const stream = new (require('events').EventEmitter)();
      stream.write = jest.fn();
      stream.end = jest.fn();
      stream.setWindow = jest.fn();
      callback(null, stream);
      this._stream = stream;
    }
    sftp(callback) {
      const sftp = {
        fastPut: jest.fn((_l, _r, cb) => cb(null)),
        mkdir: jest.fn((_p, cb) => cb(null)),
      };
      callback(null, sftp);
      this._sftp = sftp;
    }
    end() {}
  }
  return { Client: MockClient };
});

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  readFileSync: jest.fn(() => 'fake-key-content'),
  statSync: jest.fn(() => ({ isDirectory: () => false })),
  readdirSync: jest.fn(() => []),
}));

const { SSHManager } = require('../src/main/ssh-manager');

describe('SSHManager', () => {
  let manager;
  let mockStore;

  beforeEach(() => {
    mockStore = {
      getProfile: jest.fn((id) => ({
        id,
        name: 'Test',
        host: '192.168.1.1',
        port: 22,
        username: 'root',
        authType: 'password',
        password: 'encrypted',
      })),
      decryptCredentials: jest.fn((profile) => ({
        ...profile,
        password: 'decrypted-password',
      })),
    };
    manager = new SSHManager(mockStore);
  });

  afterEach(() => {
    manager.closeAll();
  });

  test('creates an SSH session', async () => {
    const terminal = await manager.create('test-id', 80, 24);
    expect(terminal).toBeDefined();
    expect(terminal.id).toBeTruthy();
  });

  test('write returns false for unknown session', () => {
    expect(manager.write('nonexistent', 'test')).toBe(false);
  });

  test('write returns true for active session', async () => {
    const terminal = await manager.create('test-id', 80, 24);
    expect(manager.write(terminal.id, 'hello')).toBe(true);
  });

  test('resize returns false for unknown session', () => {
    expect(manager.resize('nonexistent', 120, 40)).toBe(false);
  });

  test('resize calls setWindow on stream', async () => {
    const terminal = await manager.create('test-id', 80, 24);
    expect(manager.resize(terminal.id, 120, 40)).toBe(true);
  });

  test('close returns false for unknown session', () => {
    expect(manager.close('nonexistent')).toBe(false);
  });

  test('close removes session', async () => {
    const terminal = await manager.create('test-id', 80, 24);
    expect(manager.close(terminal.id)).toBe(true);
    expect(manager.write(terminal.id, 'test')).toBe(false);
  });

  test('closeAll clears all sessions', async () => {
    await manager.create('id-1', 80, 24);
    await manager.create('id-2', 80, 24);
    manager.closeAll();
    expect(manager.sessions.size).toBe(0);
  });

  test('throws for unknown profile', async () => {
    mockStore.getProfile.mockReturnValue(null);
    await expect(manager.create('unknown', 80, 24)).rejects.toThrow('not found');
  });

  test('uses decrypted credentials', async () => {
    await manager.create('test-id', 80, 24);
    expect(mockStore.decryptCredentials).toHaveBeenCalled();
  });

  test('upload throws for unknown profile', async () => {
    mockStore.getProfile.mockReturnValue(null);
    await expect(manager.upload('unknown', '/local/file.txt', '/remote/file.txt')).rejects.toThrow('not found');
  });

  test('uploads single file', async () => {
    const fs = require('fs');
    fs.statSync.mockReturnValue({ isDirectory: () => false });
    const onProgress = jest.fn();
    const result = await manager.upload('test-id', '/local/file.txt', '/remote/file.txt', onProgress);
    expect(result.success).toBe(true);
    expect(result.uploaded).toBe(1);
    expect(onProgress).toHaveBeenCalledWith({ uploaded: 1, total: 1, file: 'file.txt' });
  });

  test('uploads directory with files', async () => {
    const fs = require('fs');
    fs.statSync.mockReturnValue({ isDirectory: () => true });
    fs.readdirSync.mockReturnValue([
      { name: 'a.txt', isDirectory: () => false },
      { name: 'b.txt', isDirectory: () => false },
    ]);
    const onProgress = jest.fn();
    const result = await manager.upload('test-id', '/local/dir', '/remote/dir', onProgress);
    expect(result.success).toBe(true);
    expect(result.uploaded).toBe(2);
    expect(onProgress).toHaveBeenCalledTimes(2);
  });
});

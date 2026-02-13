jest.mock('ssh2', () => {
  const { EventEmitter } = require('events');
  class MockClient extends EventEmitter {
    connect() {
      setTimeout(() => this.emit('ready'), 10);
    }
    exec(command, callback) {
      const stream = new EventEmitter();
      stream.stderr = new EventEmitter();
      // Try exact match first, then partial match on command prefix
      let result = MockClient._execResults?.[command];
      if (!result) {
        for (const [key, val] of Object.entries(MockClient._execResults || {})) {
          if (command.startsWith(key) || command.includes(key)) {
            result = val;
            break;
          }
        }
      }
      if (!result) result = MockClient._defaultExecResult || { stdout: '', stderr: '', exitCode: 0 };
      callback(null, stream);
      setTimeout(() => {
        if (result.stdout) stream.emit('data', Buffer.from(result.stdout));
        if (result.stderr) stream.stderr.emit('data', Buffer.from(result.stderr));
        stream.emit('close', result.exitCode);
      }, 5);
    }
    end() {}
    static _execResults = {};
    static _defaultExecResult = null;
  }
  return { Client: MockClient };
});

jest.mock('https', () => {
  const { EventEmitter } = require('events');
  return {
    request: jest.fn((options, callback) => {
      const req = new EventEmitter();
      req.write = jest.fn();
      req.end = jest.fn();
      req.setTimeout = jest.fn();
      const mockResponse = require('https')._mockResponse || { statusCode: 201, body: '{}' };
      setTimeout(() => {
        const res = new EventEmitter();
        res.statusCode = mockResponse.statusCode;
        callback(res);
        res.emit('data', mockResponse.body);
        res.emit('end');
      }, 5);
      return req;
    }),
    _mockResponse: { statusCode: 201, body: '{}' },
  };
});

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  readFileSync: jest.fn(() => 'fake-key-content'),
}));

const GitHubSetup = require('../src/main/github-setup');
const { Client } = require('ssh2');
const https = require('https');

describe('GitHubSetup', () => {
  let setup;
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
    setup = new GitHubSetup(mockStore);
    Client._execResults = {};
    Client._defaultExecResult = null;
    https._mockResponse = { statusCode: 201, body: '{"id":1}' };
  });

  test('converts HTTPS repo URL to SSH format', () => {
    expect(setup._convertRepoUrl('https://github.com/user/repo'))
      .toBe('git@github.com:user/repo.git');
    expect(setup._convertRepoUrl('https://github.com/user/repo.git'))
      .toBe('git@github.com:user/repo.git');
  });

  test('keeps SSH repo URL as-is', () => {
    expect(setup._convertRepoUrl('git@github.com:user/repo.git'))
      .toBe('git@github.com:user/repo.git');
  });

  test('adds .git suffix to SSH URL without it', () => {
    expect(setup._convertRepoUrl('git@github.com:user/repo'))
      .toBe('git@github.com:user/repo.git');
  });

  test('handles trailing slashes in repo URL', () => {
    expect(setup._convertRepoUrl('https://github.com/user/repo/'))
      .toBe('git@github.com:user/repo.git');
    expect(setup._convertRepoUrl('https://github.com/user/repo///'))
      .toBe('git@github.com:user/repo.git');
  });

  test('validates a valid PAT', async () => {
    https._mockResponse = { statusCode: 200, body: '{"login":"testuser"}' };
    const result = await setup.validatePAT('ghp_testtoken');
    expect(result.valid).toBe(true);
    expect(result.username).toBe('testuser');
  });

  test('rejects an invalid PAT', async () => {
    https._mockResponse = { statusCode: 401, body: '{"message":"Bad credentials"}' };
    const result = await setup.validatePAT('ghp_invalid');
    expect(result.valid).toBe(false);
  });

  test('full setup succeeds with all steps', async () => {
    Client._execResults = {
      'test -f ~/.ssh/github_devterm && echo EXISTS || echo NOT_FOUND': {
        stdout: 'NOT_FOUND', stderr: '', exitCode: 0,
      },
      'mkdir -p ~/.ssh && chmod 700 ~/.ssh': {
        stdout: '', stderr: '', exitCode: 0,
      },
      'ssh-keygen': { stdout: 'key generated', stderr: '', exitCode: 0 },
      'cat ~/.ssh/github_devterm.pub': {
        stdout: 'ssh-ed25519 AAAAC3Nz test@example.com', stderr: '', exitCode: 0,
      },
      'git config': { stdout: '', stderr: '', exitCode: 0 },
      'ssh-keyscan': { stdout: '', stderr: '', exitCode: 0 },
      'grep -q': { stdout: '', stderr: '', exitCode: 1 },
      'chmod 600': { stdout: '', stderr: '', exitCode: 0 },
      'ssh -T': { stdout: "You've successfully authenticated", stderr: '', exitCode: 1 },
      'GIT_SSH_COMMAND': { stdout: 'Cloning into', stderr: '', exitCode: 0 },
    };

    const onProgress = jest.fn();
    https._mockResponse = { statusCode: 201, body: '{"id":1}' };

    const result = await setup.runSetup('test-id', {
      repoUrl: 'https://github.com/user/repo',
      pat: 'ghp_test',
      gitUserName: 'Test User',
      gitUserEmail: 'test@example.com',
      keyTitle: 'DevTerm Test',
    }, onProgress);

    expect(result.success).toBe(true);
    expect(result.steps).toHaveLength(6);
    expect(onProgress).toHaveBeenCalled();
  });

  test('throws for unknown profile', async () => {
    mockStore.getProfile.mockReturnValue(null);
    await expect(
      setup.runSetup('unknown', {
        repoUrl: 'https://github.com/user/repo',
        pat: 'ghp_test',
        gitUserName: 'Test',
        gitUserEmail: 'test@test.com',
        keyTitle: 'Test',
      }, jest.fn())
    ).rejects.toThrow('not found');
  });

  test('handles GitHub API 422 (key exists)', async () => {
    Client._execResults = {
      'test -f ~/.ssh/github_devterm && echo EXISTS || echo NOT_FOUND': {
        stdout: 'NOT_FOUND', stderr: '', exitCode: 0,
      },
      'mkdir -p ~/.ssh && chmod 700 ~/.ssh': {
        stdout: '', stderr: '', exitCode: 0,
      },
      'ssh-keygen': { stdout: 'key generated', stderr: '', exitCode: 0 },
      'cat ~/.ssh/github_devterm.pub': {
        stdout: 'ssh-ed25519 AAAAC3Nz test@example.com', stderr: '', exitCode: 0,
      },
      'git config': { stdout: '', stderr: '', exitCode: 0 },
      'ssh-keyscan': { stdout: '', stderr: '', exitCode: 0 },
      'grep -q': { stdout: '', stderr: '', exitCode: 1 },
      'chmod 600': { stdout: '', stderr: '', exitCode: 0 },
      'ssh -T': { stdout: "You've successfully authenticated", stderr: '', exitCode: 1 },
      'GIT_SSH_COMMAND': { stdout: 'Cloning into', stderr: '', exitCode: 0 },
    };
    https._mockResponse = {
      statusCode: 422,
      body: '{"message":"Validation Failed","errors":[{"message":"key is already in use"}]}',
    };

    const onProgress = jest.fn();
    const result = await setup.runSetup('test-id', {
      repoUrl: 'https://github.com/user/repo',
      pat: 'ghp_test',
      gitUserName: 'Test User',
      gitUserEmail: 'test@example.com',
      keyTitle: 'DevTerm Test',
    }, onProgress);

    expect(result.success).toBe(true);
    const step3 = result.steps[2];
    expect(step3.status).toBe('success');
    expect(step3.output).toContain('already exists');
  });

  test('skips key generation if key already exists', async () => {
    Client._execResults = {
      'test -f ~/.ssh/github_devterm && echo EXISTS || echo NOT_FOUND': {
        stdout: 'EXISTS', stderr: '', exitCode: 0,
      },
      'cat ~/.ssh/github_devterm.pub': {
        stdout: 'ssh-ed25519 AAAAC3Nz test@example.com', stderr: '', exitCode: 0,
      },
      'git config': { stdout: '', stderr: '', exitCode: 0 },
      'ssh-keyscan': { stdout: '', stderr: '', exitCode: 0 },
      'grep -q': { stdout: '', stderr: '', exitCode: 1 },
      'chmod 600': { stdout: '', stderr: '', exitCode: 0 },
      'ssh -T': { stdout: "You've successfully authenticated", stderr: '', exitCode: 1 },
      'GIT_SSH_COMMAND': { stdout: 'Cloning into', stderr: '', exitCode: 0 },
    };
    https._mockResponse = { statusCode: 201, body: '{"id":1}' };

    const onProgress = jest.fn();
    const result = await setup.runSetup('test-id', {
      repoUrl: 'https://github.com/user/repo',
      pat: 'ghp_test',
      gitUserName: 'Test User',
      gitUserEmail: 'test@example.com',
      keyTitle: 'DevTerm Test',
    }, onProgress);

    expect(result.success).toBe(true);
    const step1 = result.steps[0];
    expect(step1.output).toContain('already exists');
  });
});

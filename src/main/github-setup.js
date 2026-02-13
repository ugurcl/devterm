const { Client } = require('ssh2');
const https = require('https');
const fs = require('fs');

const STEPS = [
  'Generating SSH key pair',
  'Reading public key',
  'Adding key to GitHub',
  'Configuring git identity',
  'Verifying GitHub connection',
  'Cloning repository',
];

class GitHubSetup {
  constructor(credentialStore) {
    this.credentialStore = credentialStore;
  }

  _shellEscape(str) {
    return "'" + String(str).replace(/'/g, "'\\''") + "'";
  }

  async runSetup(profileId, config, onProgress, startFromStep = 0) {
    const { repoUrl, pat, gitUserName, gitUserEmail, keyTitle } = config;
    const sshRepoUrl = this._convertRepoUrl(repoUrl);

    const profile = this.credentialStore.getProfile(profileId);
    if (!profile) throw new Error('SSH profile not found');
    const decrypted = this.credentialStore.decryptCredentials(profile);

    const client = await this._connectSSH(decrypted);
    const results = [];

    try {
      for (let i = 0; i < STEPS.length; i++) {
        if (i < startFromStep) {
          results.push({ step: i, name: STEPS[i], status: 'skipped' });
          continue;
        }

        onProgress({ step: i, total: STEPS.length, status: 'running', message: STEPS[i] });

        try {
          let result;

          switch (i) {
            case 0:
              result = await this._stepGenerateKey(client, gitUserEmail);
              break;
            case 1:
              result = await this._stepReadPublicKey(client);
              break;
            case 2: {
              const pubKey = results[1] && results[1].output ? results[1].output : null;
              if (!pubKey) {
                throw new Error('Public key not available. Cannot skip key reading step.');
              }
              result = await this._stepAddKeyToGitHub(pat, pubKey, keyTitle);
              break;
            }
            case 3:
              result = await this._stepConfigureGit(client, gitUserName, gitUserEmail);
              break;
            case 4:
              result = await this._stepVerifyConnection(client);
              break;
            case 5:
              result = await this._stepCloneRepo(client, sshRepoUrl);
              break;
          }

          results.push({ step: i, name: STEPS[i], status: 'success', output: result });
          onProgress({ step: i, total: STEPS.length, status: 'success', message: STEPS[i], output: result });
        } catch (err) {
          results.push({ step: i, name: STEPS[i], status: 'error', output: err.message });
          onProgress({ step: i, total: STEPS.length, status: 'error', message: STEPS[i], output: err.message });

          for (let j = i + 1; j < STEPS.length; j++) {
            results.push({ step: j, name: STEPS[j], status: 'skipped' });
            onProgress({ step: j, total: STEPS.length, status: 'skipped', message: STEPS[j] });
          }

          return { success: false, failedStep: i, steps: results };
        }
      }
    } finally {
      client.end();
    }

    return { success: true, steps: results };
  }

  async _stepGenerateKey(client, email) {
    const check = await this._execCommand(client, 'test -f ~/.ssh/github_devterm && echo EXISTS || echo NOT_FOUND');
    if (check.stdout.trim() === 'EXISTS') {
      return 'Key already exists, skipping generation';
    }
    await this._execCommand(client, 'mkdir -p ~/.ssh && chmod 700 ~/.ssh');
    const safeEmail = this._shellEscape(email);
    const result = await this._execCommand(client, `ssh-keygen -t ed25519 -C ${safeEmail} -f ~/.ssh/github_devterm -N ""`);
    if (result.exitCode !== 0) throw new Error(result.stderr || 'ssh-keygen failed');
    return 'SSH key pair generated';
  }

  async _stepReadPublicKey(client) {
    const result = await this._execCommand(client, 'cat ~/.ssh/github_devterm.pub');
    if (result.exitCode !== 0) throw new Error(result.stderr || 'Could not read public key');
    const key = result.stdout.trim();
    if (!key) throw new Error('Public key file is empty');
    return key;
  }

  async _stepAddKeyToGitHub(pat, publicKey, title) {
    const response = await this._githubAPI('POST', '/user/keys', pat, {
      title: title || 'DevTerm',
      key: publicKey,
    });

    if (response.statusCode === 201) {
      return 'Key added to GitHub successfully';
    } else if (response.statusCode === 422) {
      let body;
      try { body = JSON.parse(response.body); } catch { body = {}; }
      if (body.errors && body.errors.some(e => e.message && e.message.includes('already in use'))) {
        return 'Key already exists on GitHub';
      }
      throw new Error(body.message || 'GitHub API validation error');
    } else if (response.statusCode === 401) {
      throw new Error('Invalid or expired Personal Access Token');
    } else if (response.statusCode === 403) {
      throw new Error('PAT lacks required scope (admin:public_key) or rate limited');
    } else {
      throw new Error(`GitHub API error: ${response.statusCode} - ${response.body}`);
    }
  }

  async _stepConfigureGit(client, name, email) {
    const safeName = this._shellEscape(name);
    const safeEmail = this._shellEscape(email);
    const result = await this._execCommand(client,
      `git config --global user.name ${safeName} && git config --global user.email ${safeEmail}`
    );
    if (result.exitCode !== 0) {
      if (result.stderr.includes('not found') || result.stderr.includes('command not found')) {
        throw new Error('git is not installed on this server');
      }
      throw new Error(result.stderr || 'git config failed');
    }
    return `Configured as ${name} <${email}>`;
  }

  async _stepVerifyConnection(client) {
    const keyscan = await this._execCommand(client, 'ssh-keyscan -t ed25519,rsa github.com >> ~/.ssh/known_hosts 2>/dev/null');
    if (keyscan.exitCode !== 0) {
      console.warn('[GitHubSetup] ssh-keyscan failed, continuing anyway');
    }

    await this._execCommand(client,
      'grep -q "IdentityFile ~/.ssh/github_devterm" ~/.ssh/config 2>/dev/null || printf "\\nHost github.com\\n  IdentityFile ~/.ssh/github_devterm\\n  IdentitiesOnly yes\\n" >> ~/.ssh/config'
    );
    await this._execCommand(client, 'chmod 600 ~/.ssh/config 2>/dev/null');

    const result = await this._execCommand(client,
      'ssh -T -i ~/.ssh/github_devterm -o StrictHostKeyChecking=no git@github.com 2>&1 || true'
    );
    const output = result.stdout + result.stderr;
    if (output.includes('successfully authenticated') || output.includes('You\'ve successfully authenticated')) {
      return 'GitHub SSH connection verified';
    }
    if (output.includes('Permission denied')) {
      throw new Error('GitHub SSH verification failed: Permission denied. The key may not be properly added.');
    }
    return 'Connection attempted - ' + output.trim().substring(0, 200);
  }

  async _stepCloneRepo(client, repoUrl) {
    const safeUrl = this._shellEscape(repoUrl);
    const result = await this._execCommand(client,
      `GIT_SSH_COMMAND="ssh -i ~/.ssh/github_devterm -o IdentitiesOnly=yes" git clone ${safeUrl}`,
      30000
    );
    if (result.exitCode !== 0) {
      if (result.stderr.includes('already exists')) {
        return 'Repository directory already exists';
      }
      throw new Error(result.stderr || 'git clone failed');
    }
    return 'Repository cloned successfully';
  }

  async validatePAT(pat) {
    try {
      const response = await this._githubAPI('GET', '/user', pat);
      if (response.statusCode === 200) {
        let user;
        try { user = JSON.parse(response.body); } catch { user = {}; }
        return { valid: true, username: user.login || 'unknown' };
      }
      return { valid: false, error: `HTTP ${response.statusCode}` };
    } catch (err) {
      return { valid: false, error: err.message };
    }
  }

  _convertRepoUrl(url) {
    const cleaned = url.replace(/\/+$/, '');
    const httpsMatch = cleaned.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/);
    if (httpsMatch) {
      return `git@github.com:${httpsMatch[1]}/${httpsMatch[2]}.git`;
    }
    if (cleaned.startsWith('git@github.com:')) {
      return cleaned.endsWith('.git') ? cleaned : cleaned + '.git';
    }
    return cleaned;
  }

  _connectSSH(decryptedProfile) {
    return new Promise((resolve, reject) => {
      const client = new Client();

      client.on('ready', () => resolve(client));
      client.on('error', (err) => reject(new Error('SSH connection failed: ' + err.message)));

      const connectConfig = {
        host: decryptedProfile.host,
        port: decryptedProfile.port || 22,
        username: decryptedProfile.username,
        readyTimeout: 15000,
      };

      if (decryptedProfile.authType === 'key') {
        try {
          connectConfig.privateKey = fs.readFileSync(decryptedProfile.privateKeyPath);
        } catch (err) {
          reject(new Error('Cannot read private key: ' + err.message));
          return;
        }
        if (decryptedProfile.passphrase) connectConfig.passphrase = decryptedProfile.passphrase;
      } else {
        connectConfig.password = decryptedProfile.password;
      }

      client.connect(connectConfig);
    });
  }

  _execCommand(client, command, timeout = 15000) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        if (activeStream) {
          try { activeStream.close(); } catch (_) {}
        }
        reject(new Error('Command timed out: ' + command.substring(0, 50)));
      }, timeout);

      let activeStream = null;

      client.exec(command, (err, stream) => {
        if (err) {
          clearTimeout(timer);
          if (!settled) { settled = true; reject(err); }
          return;
        }

        activeStream = stream;
        let stdout = '';
        let stderr = '';

        stream.on('data', (data) => { stdout += data.toString(); });
        stream.stderr.on('data', (data) => { stderr += data.toString(); });

        stream.on('close', (code) => {
          clearTimeout(timer);
          if (!settled) { settled = true; resolve({ exitCode: code || 0, stdout, stderr }); }
        });
      });
    });
  }

  _githubAPI(method, endpoint, pat, body) {
    return new Promise((resolve, reject) => {
      const postData = body ? JSON.stringify(body) : null;

      const options = {
        hostname: 'api.github.com',
        path: endpoint,
        method,
        headers: {
          'Authorization': `Bearer ${pat}`,
          'Accept': 'application/vnd.github+json',
          'User-Agent': 'DevTerm-App',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      };

      if (postData) {
        options.headers['Content-Type'] = 'application/json';
        options.headers['Content-Length'] = Buffer.byteLength(postData);
      }

      const maxResponseSize = 1024 * 1024; // 1MB
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
          if (data.length > maxResponseSize) {
            res.destroy();
            reject(new Error('GitHub API response too large'));
          }
        });
        res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
      });

      req.on('error', reject);
      req.setTimeout(15000, () => {
        req.destroy();
        reject(new Error('GitHub API request timed out'));
      });

      if (postData) req.write(postData);
      req.end();
    });
  }
}

module.exports = GitHubSetup;

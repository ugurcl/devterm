class GitHubPanel {
  constructor(modalElement) {
    this.modal = modalElement;
    this._progressCleanup = null;
    this._lastFailedStep = null;
    this._initUI();
  }

  _initUI() {
    document.getElementById('github-close').addEventListener('click', () => this.close());

    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal) this.close();
    });

    document.getElementById('github-pat-toggle').addEventListener('click', () => {
      const input = document.getElementById('github-pat');
      input.type = input.type === 'password' ? 'text' : 'password';
    });

    document.getElementById('github-validate').addEventListener('click', () => this._validatePAT());
    document.getElementById('github-start').addEventListener('click', () => this._startSetup());
  }

  async open(preselectedProfileId) {
    const profiles = await window.electronAPI.getSSHProfiles();
    const select = document.getElementById('github-profile-select');
    select.innerHTML = '';

    if (profiles.length === 0) {
      const opt = document.createElement('option');
      opt.textContent = 'No SSH profiles - add one first';
      opt.disabled = true;
      select.appendChild(opt);
    } else {
      profiles.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = `${p.name} (${p.host})`;
        if (preselectedProfileId && p.id === preselectedProfileId) opt.selected = true;
        select.appendChild(opt);
      });
    }

    document.getElementById('github-repo-url').value = '';
    document.getElementById('github-pat').value = '';
    document.getElementById('github-pat').type = 'password';
    document.getElementById('github-user-name').value = '';
    document.getElementById('github-user-email').value = '';
    document.getElementById('github-key-title').value = '';
    document.getElementById('github-validate-result').textContent = '';
    document.getElementById('github-validate-result').className = 'github-validate-result';
    document.getElementById('github-status').textContent = '';
    document.getElementById('github-status').className = 'github-status';
    document.getElementById('github-start').disabled = false;
    document.getElementById('github-start').textContent = 'Start Setup';

    const stepList = document.getElementById('github-step-list');
    stepList.style.display = 'none';
    stepList.innerHTML = '';

    this._lastFailedStep = null;
    this.modal.classList.add('open');
  }

  close() {
    this.modal.classList.remove('open');
    if (this._progressCleanup) {
      this._progressCleanup();
      this._progressCleanup = null;
    }
  }

  async _validatePAT() {
    const pat = document.getElementById('github-pat').value.trim();
    const resultEl = document.getElementById('github-validate-result');

    if (!pat) {
      resultEl.textContent = 'Enter a PAT first';
      resultEl.className = 'github-validate-result error';
      return;
    }

    resultEl.textContent = 'Validating...';
    resultEl.className = 'github-validate-result';

    const result = await window.electronAPI.validateGitHubPAT(pat);
    if (result.valid) {
      resultEl.textContent = 'Valid - ' + result.username;
      resultEl.className = 'github-validate-result success';
    } else {
      resultEl.textContent = 'Invalid: ' + (result.error || 'Unknown error');
      resultEl.className = 'github-validate-result error';
    }
  }

  _validateInputs() {
    const profileId = document.getElementById('github-profile-select').value;
    const repoUrl = document.getElementById('github-repo-url').value.trim();
    const pat = document.getElementById('github-pat').value.trim();
    const userName = document.getElementById('github-user-name').value.trim();
    const userEmail = document.getElementById('github-user-email').value.trim();

    if (!profileId) return 'Select a target server';
    if (!repoUrl) return 'Enter a repository URL';
    if (!repoUrl.match(/^(https?:\/\/github\.com\/|git@github\.com:)/)) {
      return 'Invalid GitHub repository URL';
    }
    if (!pat) return 'Enter a Personal Access Token';
    if (!userName) return 'Enter a git user name';
    if (!userEmail || !userEmail.includes('@')) return 'Enter a valid email';
    return null;
  }

  _renderStepList() {
    const steps = [
      'Generating SSH key pair',
      'Reading public key',
      'Adding key to GitHub',
      'Configuring git identity',
      'Verifying GitHub connection',
      'Cloning repository',
    ];

    const stepList = document.getElementById('github-step-list');
    stepList.innerHTML = '';
    stepList.style.display = 'block';

    steps.forEach((label, i) => {
      const step = document.createElement('div');
      step.className = 'github-step pending';
      step.id = `github-step-${i}`;
      step.innerHTML = `
        <div class="github-step-icon">${i + 1}</div>
        <div class="github-step-content">
          <div class="github-step-label">${label}</div>
          <div class="github-step-output"></div>
        </div>
      `;
      stepList.appendChild(step);
    });
  }

  _updateStep(data) {
    const stepEl = document.getElementById(`github-step-${data.step}`);
    if (!stepEl) return;

    stepEl.className = `github-step ${data.status}`;
    const iconEl = stepEl.querySelector('.github-step-icon');
    const outputEl = stepEl.querySelector('.github-step-output');

    if (data.status === 'running') {
      iconEl.textContent = '...';
    } else if (data.status === 'success') {
      iconEl.textContent = '\u2713';
    } else if (data.status === 'error') {
      iconEl.textContent = '\u2717';
    } else if (data.status === 'skipped') {
      iconEl.textContent = '-';
    }

    if (data.output) {
      outputEl.textContent = data.output.substring(0, 500);
    }
  }

  async _startSetup() {
    const error = this._validateInputs();
    const statusEl = document.getElementById('github-status');

    if (error) {
      statusEl.textContent = error;
      statusEl.className = 'github-status error';
      return;
    }

    statusEl.textContent = '';
    statusEl.className = 'github-status';

    const startBtn = document.getElementById('github-start');
    startBtn.disabled = true;
    startBtn.textContent = 'Running...';

    this._renderStepList();

    this._progressCleanup = window.electronAPI.onGitHubSetupProgress((data) => {
      this._updateStep(data);
    });

    const config = {
      profileId: document.getElementById('github-profile-select').value,
      repoUrl: document.getElementById('github-repo-url').value.trim(),
      pat: document.getElementById('github-pat').value.trim(),
      gitUserName: document.getElementById('github-user-name').value.trim(),
      gitUserEmail: document.getElementById('github-user-email').value.trim(),
      keyTitle: document.getElementById('github-key-title').value.trim() || 'DevTerm',
      startFromStep: this._lastFailedStep || 0,
    };

    try {
      const result = await window.electronAPI.runGitHubSetup(config);

      if (result.success) {
        await window.electronAPI.saveGitHubConfig({
          profileId: config.profileId,
          repoUrl: config.repoUrl,
          pat: config.pat,
          gitUserName: config.gitUserName,
          gitUserEmail: config.gitUserEmail,
          keyTitle: config.keyTitle,
        });
        this._lastFailedStep = null;
        statusEl.textContent = 'Setup completed successfully!';
        statusEl.className = 'github-status success';
        startBtn.textContent = 'Done';
      } else {
        this._lastFailedStep = result.failedStep;
        const failedStep = result.steps ? result.steps.find(s => s.status === 'error') : null;
        statusEl.textContent = 'Setup failed' + (failedStep ? ': ' + failedStep.output : '');
        statusEl.className = 'github-status error';
        startBtn.textContent = 'Retry from failed step';
        startBtn.disabled = false;
      }
    } catch (err) {
      statusEl.textContent = 'Error: ' + (err.message || err);
      statusEl.className = 'github-status error';
      startBtn.textContent = 'Retry';
      startBtn.disabled = false;
    }

    if (this._progressCleanup) {
      this._progressCleanup();
      this._progressCleanup = null;
    }
  }
}

window.GitHubPanel = GitHubPanel;

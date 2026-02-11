class SSHPanel {
  constructor(container, onConnect) {
    this.container = container;
    this.onConnect = onConnect;
    this.profiles = [];
    this._treeData = null;
    this._checkedFiles = null;
    this._initUI();
  }

  _initUI() {
    const closeBtn = this.container.querySelector('#ssh-close');
    closeBtn.addEventListener('click', () => this.toggle(false));

    const addBtn = this.container.querySelector('#ssh-add');
    addBtn.addEventListener('click', () => this._showForm());

    const saveBtn = this.container.querySelector('#ssh-save');
    saveBtn.addEventListener('click', () => this._saveProfile());

    const cancelBtn = this.container.querySelector('#ssh-cancel');
    cancelBtn.addEventListener('click', () => this._hideForm());

    const testBtn = this.container.querySelector('#ssh-test');
    testBtn.addEventListener('click', () => this._testConnection());

    const authType = this.container.querySelector('#ssh-auth-type');
    authType.addEventListener('change', () => {
      const isKey = authType.value === 'key';
      this.container.querySelector('.ssh-password-field').style.display = isKey ? 'none' : 'block';
      this.container.querySelector('.ssh-key-field').style.display = isKey ? 'block' : 'none';
    });

    this._initUploadModal();
    this._loadProfiles();
  }

  _initUploadModal() {
    const modal = document.getElementById('upload-modal');
    this._uploadModal = modal;
    this._uploadCleanup = null;

    modal.querySelector('#upload-close').addEventListener('click', () => this._closeUpload());

    modal.querySelector('#upload-browse-file').addEventListener('click', async () => {
      const filePath = await window.electronAPI.selectFile();
      if (filePath) {
        modal.querySelector('#upload-local-path').value = filePath;
        this._hideFileTree();
      }
    });

    modal.querySelector('#upload-browse-folder').addEventListener('click', async () => {
      const folderPath = await window.electronAPI.selectFolder();
      if (folderPath) {
        modal.querySelector('#upload-local-path').value = folderPath;
        await this._loadFileTree(folderPath);
      }
    });

    modal.querySelector('#upload-start').addEventListener('click', () => this._startUpload());

    modal.querySelector('#upload-tree-check-all').addEventListener('click', () => this._treeSetAll(true));
    modal.querySelector('#upload-tree-uncheck-all').addEventListener('click', () => this._treeSetAll(false));
    modal.querySelector('#upload-tree-collapse').addEventListener('click', () => this._treeCollapseAll());

    modal.addEventListener('click', (e) => {
      if (e.target === modal) this._closeUpload();
    });
  }

  _openUpload(profileId) {
    const modal = this._uploadModal;
    const select = modal.querySelector('#upload-profile-select');
    select.innerHTML = '';

    this.profiles.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name + ' (' + p.username + '@' + p.host + ')';
      if (p.id === profileId) opt.selected = true;
      select.appendChild(opt);
    });

    if (this.profiles.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'No SSH profiles';
      opt.disabled = true;
      select.appendChild(opt);
    }

    modal.querySelector('#upload-local-path').value = '';
    modal.querySelector('#upload-remote-path').value = '';
    modal.querySelector('#upload-status').textContent = '';
    modal.querySelector('#upload-status').className = 'upload-status';
    modal.querySelector('#upload-progress-area').style.display = 'none';
    modal.querySelector('#upload-progress-fill').style.width = '0';
    modal.querySelector('#upload-start').disabled = false;
    this._hideFileTree();
    modal.classList.add('open');
  }

  _closeUpload() {
    this._uploadModal.classList.remove('open');
    this._hideFileTree();
    if (this._uploadCleanup) {
      this._uploadCleanup();
      this._uploadCleanup = null;
    }
  }

  async _loadFileTree(folderPath) {
    const container = document.getElementById('upload-tree-container');
    const treeEl = document.getElementById('upload-tree');
    const infoEl = document.getElementById('upload-tree-info');

    container.style.display = 'block';
    treeEl.innerHTML = '<div class="upload-tree-loading">Reading directory...</div>';
    infoEl.textContent = '';
    infoEl.className = 'upload-tree-info';

    try {
      const result = await window.electronAPI.readDirectory(folderPath);
      this._treeData = result.tree;
      this._checkedFiles = new Set();

      this._walkTree(result.tree, (node) => {
        if (!node.isDir) this._checkedFiles.add(node.relativePath);
      });

      let infoText = result.totalFiles + ' files, ' + result.totalDirs + ' folders';
      if (result.truncated) {
        infoText += ' (truncated)';
        infoEl.className = 'upload-tree-info warning';
      }
      infoEl.textContent = infoText;

      treeEl.innerHTML = '';
      this._renderTreeNode(treeEl, result.tree, -1);
    } catch {
      treeEl.innerHTML = '<div class="upload-tree-loading">Failed to read directory</div>';
    }
  }

  _hideFileTree() {
    document.getElementById('upload-tree-container').style.display = 'none';
    this._treeData = null;
    this._checkedFiles = null;
  }

  _walkTree(node, callback) {
    callback(node);
    if (node.children) {
      for (const child of node.children) this._walkTree(child, callback);
    }
  }

  _renderTreeNode(parentEl, node, depth) {
    if (depth === -1) {
      for (const child of node.children) this._renderTreeNode(parentEl, child, 0);
      return;
    }

    const row = document.createElement('div');
    row.className = 'tree-node';

    for (let i = 0; i < depth; i++) {
      const indent = document.createElement('span');
      indent.className = 'tree-node-indent';
      row.appendChild(indent);
    }

    const toggle = document.createElement('span');
    toggle.className = 'tree-node-toggle';
    toggle.textContent = node.isDir ? '\u25B6' : '';
    row.appendChild(toggle);

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'tree-node-checkbox';
    checkbox.checked = node.isDir ? this._isDirChecked(node) : this._checkedFiles.has(node.relativePath);
    checkbox.indeterminate = node.isDir ? this._isDirPartial(node) : false;
    row.appendChild(checkbox);

    const icon = document.createElement('span');
    icon.className = 'tree-node-icon ' + (node.isDir ? 'folder' : 'file');
    icon.textContent = node.isDir ? '\uD83D\uDCC1' : '\uD83D\uDCC4';
    row.appendChild(icon);

    const name = document.createElement('span');
    name.className = 'tree-node-name';
    if (!node.isDir && !this._checkedFiles.has(node.relativePath)) name.classList.add('unchecked');
    name.textContent = node.name;
    row.appendChild(name);

    parentEl.appendChild(row);

    let childrenEl = null;
    if (node.isDir && node.children.length > 0) {
      childrenEl = document.createElement('div');
      childrenEl.className = 'tree-children collapsed';
      parentEl.appendChild(childrenEl);
      for (const child of node.children) this._renderTreeNode(childrenEl, child, depth + 1);
    }

    if (node.isDir) {
      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const exp = toggle.classList.contains('expanded');
        toggle.classList.toggle('expanded', !exp);
        if (childrenEl) childrenEl.classList.toggle('collapsed', exp);
      });
    }

    checkbox.addEventListener('change', () => {
      if (node.isDir) {
        this._walkTree(node, (n) => {
          if (!n.isDir) {
            if (checkbox.checked) this._checkedFiles.add(n.relativePath);
            else this._checkedFiles.delete(n.relativePath);
          }
        });
      } else {
        if (checkbox.checked) this._checkedFiles.add(node.relativePath);
        else this._checkedFiles.delete(node.relativePath);
      }
      this._refreshTree();
    });

    row.addEventListener('click', (e) => {
      if (e.target === checkbox || e.target === toggle) return;
      if (node.isDir) {
        toggle.click();
      } else {
        checkbox.checked = !checkbox.checked;
        checkbox.dispatchEvent(new Event('change'));
      }
    });
  }

  _isDirChecked(node) {
    let all = true;
    this._walkTree(node, (n) => {
      if (!n.isDir && !this._checkedFiles.has(n.relativePath)) all = false;
    });
    return all;
  }

  _isDirPartial(node) {
    let has = false, miss = false;
    this._walkTree(node, (n) => {
      if (!n.isDir) {
        if (this._checkedFiles.has(n.relativePath)) has = true;
        else miss = true;
      }
    });
    return has && miss;
  }

  _refreshTree() {
    const treeEl = document.getElementById('upload-tree');
    treeEl.innerHTML = '';
    if (this._treeData) this._renderTreeNode(treeEl, this._treeData, 0);
  }

  _treeSetAll(checked) {
    if (!this._treeData) return;
    this._checkedFiles = new Set();
    if (checked) {
      this._walkTree(this._treeData, (n) => {
        if (!n.isDir) this._checkedFiles.add(n.relativePath);
      });
    }
    this._refreshTree();
  }

  _treeCollapseAll() {
    const treeEl = document.getElementById('upload-tree');
    treeEl.querySelectorAll('.tree-node-toggle.expanded').forEach(t => t.classList.remove('expanded'));
    treeEl.querySelectorAll('.tree-children').forEach(c => c.classList.add('collapsed'));
  }

  async _startUpload() {
    const modal = this._uploadModal;
    const profileId = modal.querySelector('#upload-profile-select').value;
    const localPath = modal.querySelector('#upload-local-path').value.trim();
    const remotePath = modal.querySelector('#upload-remote-path').value.trim();
    const statusEl = modal.querySelector('#upload-status');
    const startBtn = modal.querySelector('#upload-start');
    const progressArea = modal.querySelector('#upload-progress-area');
    const progressFill = modal.querySelector('#upload-progress-fill');
    const progressText = modal.querySelector('#upload-progress-text');

    if (!profileId || !localPath || !remotePath) {
      statusEl.textContent = 'Please fill all fields';
      statusEl.className = 'upload-status error';
      return;
    }

    let selectedFiles = null;
    if (this._checkedFiles && this._treeData) {
      if (this._checkedFiles.size === 0) {
        statusEl.textContent = 'No files selected';
        statusEl.className = 'upload-status error';
        return;
      }
      selectedFiles = Array.from(this._checkedFiles);
    }

    startBtn.disabled = true;
    statusEl.textContent = 'Uploading...';
    statusEl.className = 'upload-status';
    progressArea.style.display = 'block';
    progressFill.style.width = '0';
    progressText.textContent = 'Starting...';

    this._uploadCleanup = window.electronAPI.onUploadProgress((data) => {
      const pct = Math.round((data.uploaded / data.total) * 100);
      progressFill.style.width = pct + '%';
      progressText.textContent = data.uploaded + ' / ' + data.total + ' files - ' + data.file;
    });

    const result = await window.electronAPI.uploadToSSH(profileId, localPath, remotePath, selectedFiles);

    if (result.success) {
      progressFill.style.width = '100%';
      statusEl.textContent = result.uploaded + ' file(s) uploaded successfully';
      statusEl.className = 'upload-status success';
    } else {
      statusEl.textContent = result.error || 'Upload failed';
      statusEl.className = 'upload-status error';
    }

    startBtn.disabled = false;

    if (this._uploadCleanup) {
      this._uploadCleanup();
      this._uploadCleanup = null;
    }
  }

  async _loadProfiles() {
    this.profiles = await window.electronAPI.getSSHProfiles();
    this._renderProfiles();
  }

  _renderProfiles() {
    const list = this.container.querySelector('.ssh-profiles-list');
    list.innerHTML = '';

    if (this.profiles.length === 0) {
      list.innerHTML = '<div class="ssh-empty">No saved servers</div>';
      return;
    }

    this.profiles.forEach(profile => {
      const item = document.createElement('div');
      item.className = 'ssh-profile-item';
      item.innerHTML = `
        <div class="ssh-profile-info">
          <span class="ssh-profile-dot" style="background:${/^#[0-9a-fA-F]{3,8}$/.test(profile.color) ? profile.color : '#7aa2f7'}"></span>
          <div>
            <div class="ssh-profile-name">${this._esc(profile.name)}</div>
            <div class="ssh-profile-host">${this._esc(profile.username)}@${this._esc(profile.host)}:${profile.port || 22}</div>
          </div>
        </div>
        <div class="ssh-profile-actions">
          <button class="ssh-profile-btn ssh-connect-btn" data-id="${profile.id}" title="Connect">&#x25B6;</button>
          <button class="ssh-profile-btn ssh-upload-btn" data-id="${profile.id}" title="Upload">&#x2191;</button>
          <button class="ssh-profile-btn ssh-github-btn" data-id="${profile.id}" title="GitHub Setup">&#x1F4BB;</button>
          <button class="ssh-profile-btn ssh-delete-btn" data-id="${profile.id}" title="Delete">&#x2715;</button>
        </div>
      `;

      item.querySelector('.ssh-connect-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        this.onConnect(profile.id, profile.name, profile.color);
      });

      item.querySelector('.ssh-upload-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        this._openUpload(profile.id);
      });

      item.querySelector('.ssh-github-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        if (window.DevTerm && window.DevTerm.githubPanel) {
          window.DevTerm.githubPanel.open(profile.id);
        }
      });

      item.querySelector('.ssh-delete-btn').addEventListener('click', async (e) => {
        e.stopPropagation();
        await window.electronAPI.deleteSSHProfile(profile.id);
        this._loadProfiles();
      });

      list.appendChild(item);
    });
  }

  _showForm(profile) {
    this.container.querySelector('.ssh-form').style.display = 'block';
    this.container.querySelector('#ssh-add').style.display = 'none';

    if (profile) {
      this.container.querySelector('#ssh-form-id').value = profile.id;
      this.container.querySelector('#ssh-name').value = profile.name;
      this.container.querySelector('#ssh-host').value = profile.host;
      this.container.querySelector('#ssh-port').value = profile.port || 22;
      this.container.querySelector('#ssh-username').value = profile.username;
      this.container.querySelector('#ssh-auth-type').value = profile.authType || 'password';
      this.container.querySelector('#ssh-color').value = profile.color || '#7aa2f7';
    } else {
      this.container.querySelector('#ssh-form-id').value = '';
      this.container.querySelector('#ssh-name').value = '';
      this.container.querySelector('#ssh-host').value = '';
      this.container.querySelector('#ssh-port').value = '22';
      this.container.querySelector('#ssh-username').value = '';
      this.container.querySelector('#ssh-password').value = '';
      this.container.querySelector('#ssh-key-path').value = '';
      this.container.querySelector('#ssh-auth-type').value = 'password';
      this.container.querySelector('#ssh-color').value = '#7aa2f7';
    }

    const isKey = this.container.querySelector('#ssh-auth-type').value === 'key';
    this.container.querySelector('.ssh-password-field').style.display = isKey ? 'none' : 'block';
    this.container.querySelector('.ssh-key-field').style.display = isKey ? 'block' : 'none';
  }

  _hideForm() {
    this.container.querySelector('.ssh-form').style.display = 'none';
    this.container.querySelector('#ssh-add').style.display = 'block';
    this.container.querySelector('.ssh-test-result').textContent = '';
  }

  _cleanHost(raw) {
    return raw.replace(/^(https?|ssh|ftp):\/\//i, '').replace(/\/+$/, '').trim();
  }

  async _saveProfile() {
    const profile = {
      name: this.container.querySelector('#ssh-name').value.trim(),
      host: this._cleanHost(this.container.querySelector('#ssh-host').value),
      port: Math.min(65535, Math.max(1, parseInt(this.container.querySelector('#ssh-port').value, 10) || 22)),
      username: this.container.querySelector('#ssh-username').value.trim(),
      authType: this.container.querySelector('#ssh-auth-type').value,
      color: this.container.querySelector('#ssh-color').value,
    };

    if (!profile.name || !profile.host || !profile.username) return;

    const id = this.container.querySelector('#ssh-form-id').value;
    if (id) profile.id = id;

    if (profile.authType === 'password') {
      profile.password = this.container.querySelector('#ssh-password').value;
    } else {
      profile.privateKeyPath = this.container.querySelector('#ssh-key-path').value.trim();
    }

    await window.electronAPI.saveSSHProfile(profile);
    this._hideForm();
    this._loadProfiles();
  }

  async _testConnection() {
    const resultEl = this.container.querySelector('.ssh-test-result');
    resultEl.textContent = 'Testing...';
    resultEl.className = 'ssh-test-result';

    const profile = {
      host: this._cleanHost(this.container.querySelector('#ssh-host').value),
      port: Math.min(65535, Math.max(1, parseInt(this.container.querySelector('#ssh-port').value, 10) || 22)),
      username: this.container.querySelector('#ssh-username').value.trim(),
      authType: this.container.querySelector('#ssh-auth-type').value,
    };

    if (profile.authType === 'password') {
      profile.password = this.container.querySelector('#ssh-password').value;
    } else {
      profile.privateKeyPath = this.container.querySelector('#ssh-key-path').value.trim();
    }

    const result = await window.electronAPI.testSSHConnection(profile);

    if (result.success) {
      resultEl.textContent = 'Connection successful';
      resultEl.className = 'ssh-test-result success';
    } else {
      resultEl.textContent = result.error || 'Connection failed';
      resultEl.className = 'ssh-test-result error';
    }
  }

  openUploadModal(profileId) {
    this._loadProfiles().then(() => this._openUpload(profileId));
  }

  toggle(force) {
    const overlay = document.getElementById('overlay');
    const isOpen = force !== undefined ? !force : this.container.classList.contains('open');
    this.container.classList.toggle('open', !isOpen);
    overlay.classList.toggle('open', !isOpen);
    if (!isOpen) this._loadProfiles();
  }

  _esc(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }
}

window.SSHPanel = SSHPanel;

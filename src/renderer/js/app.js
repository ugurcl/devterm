const LAYOUT_PANE_COUNT = {
  'single': 1, 'split-v': 2, 'split-h': 2,
  'left2-right1': 3, 'left1-right2': 3, 'top1-bottom2': 3, 'top2-bottom1': 3,
  'quad': 4,
};
const DEFAULT_LABELS = ['Terminal 1', 'Terminal 2', 'Terminal 3', 'Terminal 4'];

class DevTermApp {
  constructor() {
    this.bridge = new TerminalBridge();
    this.panes = [];
    this.activeIndex = 0;
    this.currentLayout = 'single';
    this.container = document.getElementById('pane-container');
    this.statusDot = document.getElementById('status-dot');
    this.statusText = document.getElementById('status-text');
    this.paneCount = document.getElementById('pane-count');
    this.sshPanel = null;
  }

  async init() {
    ThemeManager.initTheme();
    initTitlebar();

    this.bridge.onStatusChange = (status) => {
      this.statusDot.className = 'statusbar-dot' + (status === 'disconnected' ? ' disconnected' : '');
      this.statusText.textContent = status === 'connected' ? 'Ready' : 'Disconnected';
    };

    this.bridge.init();

    this._initToolbar();
    initShortcuts(this);

    const cmdPanel = document.getElementById('commands-panel');
    const overlay = document.getElementById('overlay');
    CommandsManager.initCommandsPanel(cmdPanel, (command) => {
      this._runInActivePane(command);
    });

    document.getElementById('commands-close').addEventListener('click', () => this.toggleCommands(false));
    overlay.addEventListener('click', () => {
      this.toggleCommands(false);
      if (this.sshPanel) this.sshPanel.toggle(false);
    });

    const sshContainer = document.getElementById('ssh-panel');
    this.sshPanel = new SSHPanel(sshContainer, (profileId, name, color) => {
      this._createSSHPane(profileId, name, color);
      this.sshPanel.toggle(false);
    });

    await this.setLayout('single');
  }

  _initToolbar() {
    const layouts = ['single', 'split-v', 'split-h', 'left2-right1', 'left1-right2', 'top1-bottom2', 'top2-bottom1', 'quad'];
    layouts.forEach(l => {
      const btn = document.getElementById('btn-' + l);
      if (btn) btn.addEventListener('click', () => this.setLayout(l));
    });

    const themeSelect = document.getElementById('theme-select');
    ThemeManager.THEMES.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t;
      opt.textContent = t.charAt(0).toUpperCase() + t.slice(1);
      if (t === ThemeManager.getTheme()) opt.selected = true;
      themeSelect.appendChild(opt);
    });
    themeSelect.addEventListener('change', () => ThemeManager.setTheme(themeSelect.value));

    const fontRange = document.getElementById('font-range');
    const fontLabel = document.getElementById('font-label');
    fontRange.value = ThemeManager.getFontSize();
    fontLabel.textContent = fontRange.value + 'px';
    fontRange.addEventListener('input', () => {
      fontLabel.textContent = fontRange.value + 'px';
      ThemeManager.setFontSize(parseInt(fontRange.value, 10));
    });

    document.getElementById('btn-commands').addEventListener('click', () => this.toggleCommands());
    document.getElementById('btn-ssh').addEventListener('click', () => this.toggleSSH());
    document.getElementById('btn-upload').addEventListener('click', () => this.openUpload());
  }

  _updatePaneCount() {
    const count = this.panes.length;
    this.paneCount.textContent = count + (count === 1 ? ' pane' : ' panes');
  }

  async setLayout(layout) {
    const needed = LAYOUT_PANE_COUNT[layout];
    this.currentLayout = layout;

    document.querySelectorAll('.toolbar button[data-layout]').forEach(b => b.classList.remove('active'));
    const activeBtn = document.getElementById('btn-' + layout);
    if (activeBtn) activeBtn.classList.add('active');

    while (this.panes.length < needed) {
      await this._createPane();
    }

    while (this.panes.length > needed) {
      this._removePane(this.panes.length - 1);
    }

    this.container.className = 'pane-container layout-' + layout;

    if (this.activeIndex >= this.panes.length) this.activeIndex = 0;
    this._updateActiveHighlight();
    this._updatePaneCount();
    this._fitAll();
  }

  async _createPane(label) {
    const index = this.panes.length;
    const paneEl = document.createElement('div');
    paneEl.className = 'pane';

    const displayLabel = (label || DEFAULT_LABELS[index] || 'Terminal ' + (index + 1)).replace(/"/g, '&quot;');

    paneEl.innerHTML = `
      <div class="pane-header">
        <div class="pane-left">
          <span class="pane-number">${index + 1}</span>
          <input class="pane-label" value="${displayLabel}" spellcheck="false">
        </div>
        <div class="pane-actions">
          <button class="pane-action-btn close-btn" title="Close pane">&#x2715;</button>
        </div>
      </div>
      <div class="pane-terminal" id="pane-term-${index}"></div>
    `;

    this.container.appendChild(paneEl);

    const termContainer = paneEl.querySelector('.pane-terminal');
    const term = new Terminal({
      fontSize: ThemeManager.getFontSize(),
      theme: ThemeManager.getXtermTheme(),
      cursorBlink: true,
      allowTransparency: true,
      fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', Consolas, monospace",
    });

    const fitAddon = new FitAddon.FitAddon();
    const webLinksAddon = new WebLinksAddon.WebLinksAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.open(termContainer);

    setTimeout(() => fitAddon.fit(), 50);

    let terminalId;
    try {
      terminalId = await this.bridge.createTerminal(term.cols, term.rows);
    } catch (err) {
      term.write('\x1b[31mFailed to create terminal: ' + (err.message || err) + '\x1b[0m\r\n');
      paneEl.remove();
      term.dispose();
      return index;
    }

    this.bridge.registerTerminal(terminalId, {
      onData: (data) => term.write(data),
      onExit: () => {
        term.write('\r\n\x1b[31m[Process exited]\x1b[0m\r\n');
      },
    });

    term.onData((data) => {
      this.bridge.sendInput(terminalId, data);
    });

    term.onResize(({ cols, rows }) => {
      this.bridge.resizeTerminal(terminalId, cols, rows);
    });

    paneEl.addEventListener('click', () => {
      const idx = this.panes.findIndex(p => p.element === paneEl);
      if (idx !== -1) this.focusPane(idx);
    });

    paneEl.querySelector('.close-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = this.panes.findIndex(p => p.element === paneEl);
      if (idx !== -1) this.closeActivePane(idx);
    });

    this.panes.push({
      element: paneEl,
      terminal: term,
      fitAddon,
      terminalId,
    });

    this._updatePaneCount();
    return index;
  }

  async _createSSHPane(profileId, name, color) {
    const index = this.panes.length;
    const needed = index + 1;

    if (needed > 4) {
      this._showNotification('Maximum 4 panes. Close a pane first.');
      return;
    }

    const safeColor = /^#[0-9a-fA-F]{3,8}$/.test(color) ? color : '#7aa2f7';
    const safeName = (name || '').replace(/"/g, '&quot;').replace(/</g, '&lt;');

    const paneEl = document.createElement('div');
    paneEl.className = 'pane';

    paneEl.innerHTML = `
      <div class="pane-header">
        <div class="pane-left">
          <span class="pane-number" style="background:${safeColor}">${index + 1}</span>
          <input class="pane-label" value="SSH: ${safeName}" spellcheck="false">
        </div>
        <div class="pane-actions">
          <span class="pane-ssh-badge">SSH</span>
          <button class="pane-action-btn upload-btn" title="Upload file">&#x2191;</button>
          <button class="pane-action-btn close-btn" title="Close pane">&#x2715;</button>
        </div>
      </div>
      <div class="pane-terminal" id="pane-term-${index}"></div>
    `;

    this.container.appendChild(paneEl);

    const termContainer = paneEl.querySelector('.pane-terminal');
    const term = new Terminal({
      fontSize: ThemeManager.getFontSize(),
      theme: ThemeManager.getXtermTheme(),
      cursorBlink: true,
      allowTransparency: true,
      fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', Consolas, monospace",
    });

    const fitAddon = new FitAddon.FitAddon();
    const webLinksAddon = new WebLinksAddon.WebLinksAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.open(termContainer);

    setTimeout(() => fitAddon.fit(), 50);

    let terminalId;
    try {
      terminalId = await this.bridge.createSSHTerminal(profileId, term.cols, term.rows);
    } catch (err) {
      term.write('\x1b[31mSSH Connection Failed: ' + err.message + '\x1b[0m\r\n');
      this.panes.push({ element: paneEl, terminal: term, fitAddon, terminalId: null });
      this._updateLayout(needed);
      return;
    }

    this.bridge.registerTerminal(terminalId, {
      onData: (data) => term.write(data),
      onExit: () => {
        term.write('\r\n\x1b[33m[SSH Disconnected]\x1b[0m\r\n');
      },
    });

    term.onData((data) => {
      this.bridge.sendInput(terminalId, data);
    });

    term.onResize(({ cols, rows }) => {
      this.bridge.resizeTerminal(terminalId, cols, rows);
    });

    paneEl.addEventListener('click', () => {
      const idx = this.panes.findIndex(p => p.element === paneEl);
      if (idx !== -1) this.focusPane(idx);
    });

    paneEl.querySelector('.upload-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.sshPanel) this.sshPanel.openUploadModal(profileId);
    });

    paneEl.querySelector('.close-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = this.panes.findIndex(p => p.element === paneEl);
      if (idx !== -1) this.closeActivePane(idx);
    });

    this.panes.push({
      element: paneEl,
      terminal: term,
      fitAddon,
      terminalId,
      isSSH: true,
      profileId,
    });

    this._updateLayout(needed);
  }

  _updateLayout(paneCount) {
    const layoutByCount = { 1: 'single', 2: 'split-v', 3: 'left1-right2', 4: 'quad' };
    this.currentLayout = layoutByCount[paneCount] || 'quad';
    this.container.className = 'pane-container layout-' + this.currentLayout;

    document.querySelectorAll('.toolbar button[data-layout]').forEach(b => b.classList.remove('active'));
    const activeBtn = document.getElementById('btn-' + this.currentLayout);
    if (activeBtn) activeBtn.classList.add('active');

    this._updatePaneCount();
    this._fitAll();
  }

  _removePane(index) {
    const pane = this.panes[index];
    if (!pane) return;
    if (pane.terminalId) this.bridge.closeTerminal(pane.terminalId);
    pane.terminal.dispose();
    pane.element.remove();
    this.panes.splice(index, 1);
    this._updatePaneCount();
  }

  focusPane(index) {
    if (index < 0 || index >= this.panes.length) return;
    this.activeIndex = index;
    this._updateActiveHighlight();
    try { this.panes[index].terminal.focus(); } catch (_) {}
  }

  closeActivePane(index) {
    const idx = index !== undefined ? index : this.activeIndex;
    if (this.panes.length <= 1) return;
    this._removePane(idx);
    this._renumberPanes();

    const count = this.panes.length;
    if (count === 1) {
      this.currentLayout = 'single';
    } else if (count === 2) {
      this.currentLayout = 'split-v';
    } else if (count === 3) {
      this.currentLayout = 'left1-right2';
    }
    this.container.className = 'pane-container layout-' + this.currentLayout;

    document.querySelectorAll('.toolbar button[data-layout]').forEach(b => b.classList.remove('active'));
    const activeBtn = document.getElementById('btn-' + this.currentLayout);
    if (activeBtn) activeBtn.classList.add('active');

    if (this.activeIndex >= this.panes.length) this.activeIndex = this.panes.length - 1;
    this._updateActiveHighlight();
    this._updatePaneCount();
    this._fitAll();
  }

  _renumberPanes() {
    this.panes.forEach((pane, i) => {
      pane.element.querySelector('.pane-number').textContent = i + 1;
    });
  }

  _updateActiveHighlight() {
    this.panes.forEach((p, i) => {
      p.element.classList.toggle('active', i === this.activeIndex);
    });
  }

  _fitAll() {
    setTimeout(() => {
      this.panes.forEach(p => {
        try { p.fitAddon.fit(); } catch {}
      });
    }, 100);
  }

  _runInActivePane(command) {
    const pane = this.panes[this.activeIndex];
    if (pane && pane.terminalId) {
      this.bridge.sendInput(pane.terminalId, command + '\r');
    }
  }

  toggleCommands(force) {
    const panel = document.getElementById('commands-panel');
    const overlay = document.getElementById('overlay');
    const isOpen = force !== undefined ? !force : panel.classList.contains('open');
    panel.classList.toggle('open', !isOpen);
    overlay.classList.toggle('open', !isOpen);
  }

  toggleSSH(force) {
    if (this.sshPanel) this.sshPanel.toggle(force);
  }

  openUpload() {
    if (!this.sshPanel) return;
    const activePane = this.panes[this.activeIndex];
    const preselect = (activePane && activePane.profileId) ? activePane.profileId : undefined;
    this.sshPanel.openUploadModal(preselect);
  }

  applyThemeToTerminals() {
    setTimeout(() => {
      const theme = ThemeManager.getXtermTheme();
      this.panes.forEach(p => {
        p.terminal.options.theme = theme;
      });
    }, 50);
  }

  _showNotification(msg) {
    let el = document.getElementById('notification');
    if (!el) {
      el = document.createElement('div');
      el.id = 'notification';
      el.className = 'notification';
      document.getElementById('app').appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(this._notifTimer);
    this._notifTimer = setTimeout(() => el.classList.remove('show'), 3000);
  }

  applyFontSize(size) {
    this.panes.forEach(p => {
      p.terminal.options.fontSize = size;
      try { p.fitAddon.fit(); } catch {}
    });
  }
}

window.addEventListener('resize', () => {
  if (window.DevTerm) window.DevTerm._fitAll();
});

window.addEventListener('beforeunload', () => {
  if (window.DevTerm) window.DevTerm.bridge.destroy();
});

document.addEventListener('DOMContentLoaded', async () => {
  const app = new DevTermApp();
  window.DevTerm = app;
  await app.init();
});

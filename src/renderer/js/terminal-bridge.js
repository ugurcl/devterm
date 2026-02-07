class TerminalBridge {
  constructor() {
    this.terminals = new Map();
    this.onStatusChange = null;
    this._cleanups = [];
  }

  init() {
    const cleanOutput = window.electronAPI.onTerminalOutput((id, data) => {
      const handler = this.terminals.get(id);
      if (handler) handler.onData(data);
    });

    const cleanExit = window.electronAPI.onTerminalExit((id, exitCode) => {
      const handler = this.terminals.get(id);
      if (handler && handler.onExit) handler.onExit(exitCode);
      this.terminals.delete(id);
    });

    this._cleanups.push(cleanOutput, cleanExit);
    if (this.onStatusChange) this.onStatusChange('connected');
  }

  async createTerminal(cols, rows) {
    return window.electronAPI.createTerminal(cols, rows);
  }

  async createSSHTerminal(profileId, cols, rows) {
    return window.electronAPI.createSSHTerminal(profileId, cols, rows);
  }

  registerTerminal(terminalId, handlers) {
    this.terminals.set(terminalId, handlers);
  }

  sendInput(terminalId, data) {
    window.electronAPI.writeTerminal(terminalId, data);
  }

  resizeTerminal(terminalId, cols, rows) {
    window.electronAPI.resizeTerminal(terminalId, cols, rows);
  }

  closeTerminal(terminalId) {
    window.electronAPI.closeTerminal(terminalId);
    this.terminals.delete(terminalId);
  }

  destroy() {
    this._cleanups.forEach(fn => fn());
  }
}

window.TerminalBridge = TerminalBridge;

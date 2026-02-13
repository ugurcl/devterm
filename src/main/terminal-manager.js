const pty = require('node-pty');
const { v4: uuidv4 } = require('uuid');
const config = require('./config');

class TerminalManager {
  constructor() {
    this.terminals = new Map();
  }

  create(cols = 80, rows = 24) {
    if (this.terminals.size >= config.MAX_TERMINALS) {
      throw new Error(`Maximum ${config.MAX_TERMINALS} terminals reached`);
    }

    const id = uuidv4().slice(0, 8);
    const shell = config.SHELL;
    let args = [];
    if (config.PLATFORM === 'win32') {
      const code = 'function prompt { $E=[char]27; "${E}[32m${env:USERNAME}${E}[0m@${E}[34m$(Split-Path -Leaf $PWD)${E}[0m ${E}[33m`$${E}[0m " }';
      const encoded = Buffer.from(code, 'utf16le').toString('base64');
      args = ['-NoLogo', '-NoExit', '-EncodedCommand', encoded];
    }

    const proc = pty.spawn(shell, args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: config.HOME_DIR,
      env: process.env,
      useConpty: false,
    });

    const terminal = { id, proc, createdAt: Date.now() };
    this.terminals.set(id, terminal);

    return terminal;
  }

  write(id, data) {
    const terminal = this.terminals.get(id);
    if (!terminal) return false;
    terminal.proc.write(data);
    return true;
  }

  resize(id, cols, rows) {
    const terminal = this.terminals.get(id);
    if (!terminal) return false;
    try {
      terminal.proc.resize(cols, rows);
    } catch (err) {
      console.warn(`[TerminalManager] resize failed for ${id}:`, err.message);
    }
    return true;
  }

  close(id) {
    const terminal = this.terminals.get(id);
    if (!terminal) return false;

    try {
      terminal.proc.kill();
    } catch (err) {
      console.warn(`[TerminalManager] kill failed for ${id}:`, err.message);
    }

    this.terminals.delete(id);
    return true;
  }

  get(id) {
    return this.terminals.get(id) || null;
  }

  getStats() {
    return {
      totalTerminals: this.terminals.size,
    };
  }

  closeAll() {
    const ids = [...this.terminals.keys()];
    ids.forEach(id => this.close(id));
  }
}

module.exports = TerminalManager;

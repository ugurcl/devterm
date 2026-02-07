const os = require('os');

function getDefaultShell() {
  if (process.platform === 'win32') return 'powershell.exe';
  return process.env.SHELL || '/bin/bash';
}

module.exports = {
  MAX_TERMINALS: 8,
  SHELL: getDefaultShell(),
  PLATFORM: process.platform,
  HOME_DIR: os.homedir(),
};

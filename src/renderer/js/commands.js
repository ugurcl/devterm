const STORAGE_KEY = 'devterm-commands';

const DEFAULT_COMMANDS = [
  // Node.js
  { name: 'npm start', command: 'npm start' },
  { name: 'npm run dev', command: 'npm run dev' },
  { name: 'npm install', command: 'npm install' },
  { name: 'npm test', command: 'npm test' },
  { name: 'npm run build', command: 'npm run build' },
  { name: 'npm outdated', command: 'npm outdated' },
  { name: 'node version', command: 'node -v && npm -v' },
  { name: 'npm audit', command: 'npm audit' },
  // Python
  { name: 'python version', command: 'python --version' },
  { name: 'pip install -r', command: 'pip install -r requirements.txt' },
  { name: 'pip freeze', command: 'pip freeze' },
  { name: 'python manage.py runserver', command: 'python manage.py runserver' },
  { name: 'pytest', command: 'pytest -v' },
  { name: 'venv create', command: 'python -m venv venv' },
  { name: 'venv activate', command: 'source venv/bin/activate' },
  { name: 'pip list outdated', command: 'pip list --outdated' },
  // Git
  { name: 'git status', command: 'git status' },
  { name: 'git log', command: 'git log --oneline -10' },
  { name: 'git pull', command: 'git pull' },
  { name: 'git branch', command: 'git branch -a' },
  { name: 'git diff', command: 'git diff' },
  // Docker
  { name: 'docker ps', command: 'docker ps' },
  { name: 'docker-compose up', command: 'docker-compose up' },
  { name: 'docker images', command: 'docker images' },
  // System
  { name: 'disk usage', command: 'df -h' },
  { name: 'memory usage', command: 'free -h' },
  { name: 'running processes', command: 'ps aux --sort=-%mem | head -15' },
];

function loadCommands() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try { return JSON.parse(saved); } catch { }
  }
  return [...DEFAULT_COMMANDS];
}

function saveCommands(commands) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(commands));
}

function addCommand(name, command) {
  const commands = loadCommands();
  commands.push({ name, command });
  saveCommands(commands);
  return commands;
}

function removeCommand(index) {
  const commands = loadCommands();
  commands.splice(index, 1);
  saveCommands(commands);
  return commands;
}

function renderCommands(container, onRun) {
  const commands = loadCommands();
  const list = container.querySelector('.commands-list');
  list.innerHTML = '';

  commands.forEach((cmd, i) => {
    const item = document.createElement('div');
    item.className = 'command-item';
    item.innerHTML = `
      <div>
        <div class="command-name">${_esc(cmd.name)}</div>
        <div class="command-text">${_esc(cmd.command)}</div>
      </div>
      <button class="command-delete" data-index="${i}">&times;</button>
    `;

    item.addEventListener('click', (e) => {
      if (e.target.classList.contains('command-delete')) {
        removeCommand(parseInt(e.target.dataset.index, 10));
        renderCommands(container, onRun);
        return;
      }
      onRun(cmd.command);
    });

    list.appendChild(item);
  });
}

function initCommandsPanel(container, onRun) {
  const nameInput = container.querySelector('#cmd-name');
  const cmdInput = container.querySelector('#cmd-command');
  const addBtn = container.querySelector('#cmd-add');

  addBtn.addEventListener('click', () => {
    const name = nameInput.value.trim();
    const command = cmdInput.value.trim();
    if (!name || !command) return;
    addCommand(name, command);
    nameInput.value = '';
    cmdInput.value = '';
    renderCommands(container, onRun);
  });

  renderCommands(container, onRun);
}

function _esc(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

window.CommandsManager = { loadCommands, addCommand, removeCommand, renderCommands, initCommandsPanel };

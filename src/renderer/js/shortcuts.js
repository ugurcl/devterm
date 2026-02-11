function initShortcuts(app) {
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === '\\') {
      e.preventDefault();
      app.setLayout('split-v');
      return;
    }

    if (e.ctrlKey && e.key === '-') {
      e.preventDefault();
      app.setLayout('split-h');
      return;
    }

    if (e.ctrlKey && e.shiftKey && e.key === 'T') {
      e.preventDefault();
      app.setLayout('quad');
      return;
    }

    if (e.ctrlKey && e.key >= '1' && e.key <= '4') {
      e.preventDefault();
      const idx = parseInt(e.key, 10) - 1;
      app.focusPane(idx);
      return;
    }

    if (e.ctrlKey && e.key === 'w') {
      e.preventDefault();
      app.closeActivePane();
      return;
    }

    if (e.ctrlKey && e.key === 'b') {
      e.preventDefault();
      app.toggleCommands();
      return;
    }

    if (e.ctrlKey && e.shiftKey && e.key === 'S') {
      e.preventDefault();
      app.toggleSSH();
      return;
    }

    if (e.ctrlKey && e.shiftKey && e.key === 'U') {
      e.preventDefault();
      app.openUpload();
      return;
    }

    if (e.ctrlKey && e.shiftKey && e.key === 'G') {
      e.preventDefault();
      app.openGitHub();
      return;
    }
  });
}

window.initShortcuts = initShortcuts;

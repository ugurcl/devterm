function initTitlebar() {
  document.getElementById('btn-minimize').addEventListener('click', () => {
    window.electronAPI.minimizeWindow();
  });

  document.getElementById('btn-maximize').addEventListener('click', () => {
    window.electronAPI.maximizeWindow();
  });

  document.getElementById('btn-close').addEventListener('click', () => {
    window.electronAPI.closeWindow();
  });

  window.electronAPI.onMaximizeChange((isMaximized) => {
    const btn = document.getElementById('btn-maximize');
    btn.innerHTML = isMaximized ? '&#x29C9;' : '&#x25A1;';
  });
}

window.initTitlebar = initTitlebar;

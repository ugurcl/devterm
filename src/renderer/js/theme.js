const THEMES = ['dark', 'monokai', 'dracula', 'nord', 'solarized', 'gruvbox'];
const DEFAULT_THEME = 'dark';
const DEFAULT_FONT_SIZE = 14;

function getTheme() {
  return localStorage.getItem('devterm-theme') || DEFAULT_THEME;
}

function setTheme(name) {
  if (!THEMES.includes(name)) return;
  document.documentElement.setAttribute('data-theme', name);
  localStorage.setItem('devterm-theme', name);
  if (window.DevTerm) window.DevTerm.applyThemeToTerminals();
}

function getFontSize() {
  return parseInt(localStorage.getItem('devterm-font-size'), 10) || DEFAULT_FONT_SIZE;
}

function setFontSize(size) {
  size = Math.max(10, Math.min(24, size));
  localStorage.setItem('devterm-font-size', String(size));
  if (window.DevTerm) window.DevTerm.applyFontSize(size);
}

function getXtermTheme() {
  const style = getComputedStyle(document.documentElement);
  const get = (prop) => style.getPropertyValue(prop).trim();
  return {
    background: get('--terminal-bg'),
    foreground: get('--terminal-fg'),
    cursor: get('--terminal-cursor'),
    selectionBackground: get('--terminal-selection'),
    black: get('--terminal-black'),
    red: get('--terminal-red'),
    green: get('--terminal-green'),
    yellow: get('--terminal-yellow'),
    blue: get('--terminal-blue'),
    magenta: get('--terminal-magenta'),
    cyan: get('--terminal-cyan'),
    white: get('--terminal-white'),
    brightBlack: get('--terminal-bright-black'),
    brightRed: get('--terminal-bright-red'),
    brightGreen: get('--terminal-bright-green'),
    brightYellow: get('--terminal-bright-yellow'),
    brightBlue: get('--terminal-bright-blue'),
    brightMagenta: get('--terminal-bright-magenta'),
    brightCyan: get('--terminal-bright-cyan'),
    brightWhite: get('--terminal-bright-white'),
  };
}

function initTheme() {
  setTheme(getTheme());
}

window.ThemeManager = { THEMES, getTheme, setTheme, getFontSize, setFontSize, getXtermTheme, initTheme };

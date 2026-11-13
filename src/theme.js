const key = 'casepilot.theme';
export function readTheme() {
  try { return localStorage.getItem(key) === 'dark' ? 'dark' : 'light'; } catch { return 'light'; }
}
export function applyTheme(theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  document.documentElement.style.colorScheme = theme;
}
export function saveTheme(theme) {
  applyTheme(theme);
  try { localStorage.setItem(key, theme); } catch { /* Theme still works when storage is unavailable. */ }
}

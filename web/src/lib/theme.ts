const KEY = 'oma.theme';
export function initTheme() {
  let t: string | null = null;
  try { t = localStorage.getItem(KEY); } catch { /* ignore */ }
  const dark = t ? t === 'dark' : window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}
export function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem(KEY, next); } catch { /* ignore */ }
  return next;
}

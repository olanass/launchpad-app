(function () {
  const storageKey = 'x402-color-theme';
  const media = window.matchMedia('(prefers-color-scheme: dark)');

  function getSavedTheme() {
    try {
      const saved = localStorage.getItem(storageKey);
      return saved === 'light' || saved === 'dark' ? saved : null;
    } catch (_) {
      return null;
    }
  }

  function preferredTheme() {
    return getSavedTheme() || (media.matches ? 'dark' : 'light');
  }

  function updateButton(theme) {
    const button = document.getElementById('themeToggle');
    if (!button) return;
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    const label = `Switch to ${nextTheme} mode`;
    button.setAttribute('aria-label', label);
    button.setAttribute('title', label);
    button.setAttribute('aria-pressed', String(theme === 'dark'));
  }

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    updateButton(theme);
  }

  applyTheme(preferredTheme());

  document.addEventListener('DOMContentLoaded', function () {
    applyTheme(preferredTheme());
    const button = document.getElementById('themeToggle');
    if (!button) return;

    button.addEventListener('click', function () {
      const nextTheme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem(storageKey, nextTheme);
      } catch (_) {
        // The selected theme still applies when storage is unavailable.
      }
      applyTheme(nextTheme);
    });
  });

  media.addEventListener('change', function (event) {
    if (!getSavedTheme()) applyTheme(event.matches ? 'dark' : 'light');
  });
})();

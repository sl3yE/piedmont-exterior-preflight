'use strict';
// Apply the saved app preference before styles load to avoid a theme flash.
(() => {
  let theme = 'light';
  try {
    if (localStorage.getItem('preflight-theme-v1') === 'dark') theme = 'dark';
  } catch { /* The toggle still works when browser storage is unavailable. */ }
  document.documentElement.dataset.theme = theme;
})();

(() => {
  const key = 'agenticos-theme';
  const system = window.matchMedia('(prefers-color-scheme: dark)');
  const read = () => { try { const value=localStorage.getItem(key); return ['light','dark'].includes(value) ? value : null; } catch { return null; } };
  let preference = read();
  const sun = '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>';
  const moon = '<path d="M20.5 14A9 9 0 0 1 10 3.5 9 9 0 1 0 20.5 14z"/>';
  function apply() {
    const theme = preference || (system.matches ? 'dark' : 'light');
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', theme);
    const button = document.querySelector('#theme-toggle');
    if (button) {
      const label = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
      button.setAttribute('aria-label',label);button.setAttribute('title',label);button.setAttribute('aria-pressed',String(theme==='dark'));
      button.innerHTML=`<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${theme==='dark'?sun:moon}</svg>`;
    }
  }
  apply();
  document.addEventListener('DOMContentLoaded', () => {
    apply();
    document.querySelector('#theme-toggle')?.addEventListener('click', () => {
      preference = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(key,preference); } catch {}
      apply();
    });
  });
  system.addEventListener('change',()=>{if(!preference)apply();});
  window.addEventListener('storage',event=>{if(event.key===key||event.key===null){preference=read();apply();}});
})();

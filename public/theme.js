// ── KRONOS · LABTECIE — Tema (modo claro/escuro) ──────────────────────────

const SVG_MOON = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
const SVG_SUN  = '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>';

function _updateThemeSvg(){
  const icon = document.getElementById('themeBtnIcon');
  if(icon) icon.innerHTML = document.body.classList.contains('dark') ? SVG_SUN : SVG_MOON;
}

function toggleTheme(){
  document.body.classList.toggle('dark');
  try { localStorage.setItem('kronos_theme', document.body.classList.contains('dark') ? 'dark' : 'light'); } catch(e){}
  _updateThemeSvg();
}

try {
  if(localStorage.getItem('kronos_theme')==='dark'){
    document.body.classList.add('dark');
  }
} catch(e){}
// Aguarda DOM para atualizar ícone
if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', _updateThemeSvg);
} else {
  _updateThemeSvg();
}

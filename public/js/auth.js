// ── KRONOS · AUTH — Boot, Config e Seletor de Equipe ────────────────────────
// Gerencia o ciclo de autenticação, carregamento de config e troca de equipe.
// Funções que precisam escrever nos globals de config (_applyConfig,
// _initDefaultConfig) são recebidas como callbacks para evitar
// circular dependency durante a migração de estado (Fase 3).

import { get, ref } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';
import { db, EQUIPE_ID, _buildRefs } from './firebase-refs.js';
import { escH } from './utils.js';

// ── Nomes de exibição das equipes ─────────────────────────────────────────────
export const EQUIPE_LABELS = {
  revisao:     'Revisão',
  diagramacao: 'Diagramação',
  audiovisual: 'Audiovisual',
  insercao:    'Inserção',
};

// ── bootV2 ────────────────────────────────────────────────────────────────────
// Lê perfil do usuário, carrega config da equipe, monta seletor de equipe.
// Callbacks recebidos do index_v2.js para operações que escrevem em globals:
//   applyConfig(cfg)      — aplica config carregada
//   initDefaultConfig()   — grava e aplica config padrão (primeiro acesso)
//   showEquipeSelector(equipes) — renderiza seletor na topbar
export async function bootV2(user, { applyConfig, initDefaultConfig, showEquipeSelector }) {
  // 1. Ler perfil em /usuarios/{uid}
  let userPapel = null;
  let userEquipes = [];
  let equipeAtiva = null;

  try {
    const snap = await get(ref(db, `usuarios/${user.uid}`));
    const profile = snap.val();
    if (profile) {
      userPapel   = profile.papel   || 'colaborador';
      userEquipes = profile.equipes || [];
      // Coordenadores/auditores sem equipes definidas recebem acesso a todas por padrão
      if(userEquipes.length === 0 && (userPapel === 'coordenador' || userPapel === 'auditor' || userPapel === 'rh')) {
        userEquipes = Object.keys(EQUIPE_LABELS);
      }
      equipeAtiva = profile.equipeId || userEquipes[0] || 'diagramacao';
      _buildRefs(equipeAtiva);
    }
  } catch(e) {
    console.warn('[bootV2] /usuarios não encontrado:', e);
  }

  // Sem perfil cadastrado — mostra erro com UID
  if (!userPapel) {
    const loadEl = document.getElementById('appLoading');
    if (loadEl) {
      loadEl.classList.remove('hidden');
      const spin = loadEl.querySelector('.app-loading-spinner');
      if (spin) spin.style.display = 'none';
      const txt = loadEl.querySelector('.app-loading-text');
      if (txt) txt.innerHTML =
        'Perfil não encontrado no banco de dados.<br>' +
        `<span style="font-size:0.65rem;opacity:0.75;font-family:monospace">UID: ${user.uid}</span><br>` +
        `<span style="font-size:0.65rem;opacity:0.6">Crie /usuarios/${user.uid} no Firebase Console.</span>`;
    }
    console.warn('[bootV2] Perfil ausente. Email:', user.email, '| UID:', user.uid);
    return { booted: false, userPapel: null, userEquipes: [], equipeAtiva: null };
  }

  // 2. Carregar config da equipe
  const cfgSnap = await get(ref(db, `equipes/${equipeAtiva || EQUIPE_ID}/config`));
  const cfg = cfgSnap.val();
  if (cfg) {
    applyConfig(cfg);
  } else {
    await initDefaultConfig();
  }

  // 3. Seletor de equipe para admin/rh com múltiplas equipes
  if ((userPapel === 'rh' || userPapel === 'admin' || userPapel === 'coordenador' || userPapel === 'auditor') && userEquipes.length > 1) {
    showEquipeSelector(userEquipes, equipeAtiva);
  }

  return { booted: true, userPapel, userEquipes, equipeAtiva };
}

// ── bootV2Config ──────────────────────────────────────────────────────────────
// Recarrega config ao trocar de equipe (admin/rh).
// Callback applyConfig escreve nos globals — permanece em index_v2.js.
export async function bootV2Config(eqId, { applyConfig, initKColState }) {
  const cfgSnap = await get(ref(db, `equipes/${eqId}/config`));
  const cfg = cfgSnap.val() || {};
  applyConfig(cfg);
  initKColState();
}

// ── renderEquipeSelector ──────────────────────────────────────────────────────
// Renderiza as pills de equipe nas páginas de gestão.
// A lógica de troca fica em window._doEquipeSwitch (registrado em index_v2.js).
// D3-admin: kanban e arquivo ganham seletor de equipe; F12: removido de 'usuarios'
// (cada equipe já aparece separada lá — os pills eram redundantes).
const EQUIPE_FILTER_PAGES = ['dashboard','demandas','graficos','historico4s','indicadores','kanban','arquivo'];

// auth.js só renderiza as pills — lógica de troca fica em window._doEquipeSwitch (index_v2.js)
export function renderEquipeSelector(equipes, equipeAtiva) {
  if(!equipes.length) return;
  document.getElementById('topbarRight')?.querySelector('.equipe-selector-wrap')?.remove();
  _renderEquipePills(equipes, equipeAtiva);
}

function _renderEquipePills(equipes, equipeAtiva){
  EQUIPE_FILTER_PAGES.forEach(pageId => {
    const bar = document.getElementById(`equipe-filter-${pageId}`);
    if(!bar) return;
    bar.classList.add('visible');
    bar.innerHTML = equipes.map(eq => {
      const label = EQUIPE_LABELS[eq] || eq.charAt(0).toUpperCase()+eq.slice(1);
      const active = eq === equipeAtiva;
      return `<button class="equipe-pill${active?' active':''}"
        onclick="window._doEquipeSwitch('${eq}')"
        aria-pressed="${active}"
        aria-label="Ver equipe ${label}">${label}</button>`;
    }).join('');
  });
}

export function updateEquipePills(equipeAtiva){
  document.querySelectorAll('.equipe-pill').forEach(btn => {
    const match = btn.getAttribute('onclick')?.match(/'([^']+)'/);
    const eq = match?.[1];
    const active = eq === equipeAtiva;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
  });
}

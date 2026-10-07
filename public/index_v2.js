// ── KRONOS V2 · LABTECIE — Script Principal ────────────────────────────────
// Arquitetura multi-equipe: config lida do Firebase, dados isolados por equipe
//
// Módulos (14 arquivos ES Module):
//   js/icons.js         — ícones SVG (inline)
//   js/utils.js         — funções puras: formatadores, helpers de data, escH
//   js/state.js         — estado compartilhado (objeto único mutável)
//   js/firebase-refs.js — Firebase init, refs equipe-específicos, _buildRefs
//   js/auth.js          — bootV2, bootV2Config, renderEquipeSelector
//   js/ui.js            — showToast, setSyncStatus, showPage, renderCurrentPage
//   js/timer.js         — timer: start/stop/restore/sync/autoStop
//   js/entries.js       — CRUD de entradas, modal, assertCanWrite
//   js/dashboard.js     — calcDay, getEntriesForDay, renders dashboard/online/RH
//   js/kanban.js        — quadro Kanban: render, CRUD, timer, arquivo, notificações
//   js/demandas.js      — Demandas, Projetos, Gráficos, Histórico, Mural, Relatório
//   js/config.js        — Painel de configurações: projetos, metas, tags, colunas
//   js/usuarios.js      — Gestão de colaboradores, aprovações, exportação CSV
//   js/importadores.js  — Importadores: CSV genérico, Trello, Avaliações históricas
//
// index_v2.js (este arquivo) — orquestra boot, auth, listeners e renderPage

// Firebase SDK — funções usadas diretamente em index_v2.js
import { getAuth, onAuthStateChanged, updatePassword }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { getDatabase, ref, push, set, update, get, remove, child, onValue, query, orderByChild, startAt, limitToLast, equalTo }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

// ── Módulos locais ────────────────────────────────────────────────────────────
import { ICONS } from './js/icons.js';
import {
  debounce, escH, sanitizeUrl,
  fmtDur, fmtTime, fmtDate, fmtShortDate,
  dKey, dateKey, todayKey,
  getWeekDays, getMonthWeeks, celebrate
} from './js/utils.js';
import { app as state } from './js/state.js';
import {
  firebaseApp as app, auth, db,
  analytics as _analytics,
  EQUIPE_ID,
  entriesRef, kanbanRef, customTagsRef, removedTagsRef, customProjectsRef,
  muralRef, desafioRef, usersRef, notifsRef, avatarsRef, arquivoRef,
  approvalRequestsRef, activeTimersRef, holidaysRef, folgasRef, indicadoresManuaisRef, capDiaRef,
  _buildRefs, _getSecondaryAuth,
  createUserWithEmailAndPassword, signOut, logEvent
} from './js/firebase-refs.js';
import {
  EQUIPE_LABELS,
  bootV2       as _bootV2Module,
  bootV2Config as _bootV2ConfigModule,
  renderEquipeSelector,
  updateEquipePills
} from './js/auth.js';
import {
  initUI, showPage, showToast, setSyncStatus,
  renderCurrentPage, renderDebounced, enhanceA11y
} from './js/ui.js';
import {
  initTimer, LATE_CUTOFF_HOUR, LATE_CUTOFF_MINUTE,
  toggleTimer, startTimer, stopTimer,
  restoreTimerFromFirebase, syncActiveTimerFields, syncTimerDebounced,
  checkRetroActiveStop, scheduleAutoStop, resetNoActivityTimer
} from './js/timer.js';
import {
  initEntries, assertCanWrite,
  openEntryDetail, closeEntryDetail,
  openModal, closeModal, saveModal,
  deleteEntry, clearDay, _openModalWithDraft
} from './js/entries.js';
import {
  isActive, calcAmount, getDailyGoalMs,
  getEntriesArray, getEntriesForDay, calcDay,
  getCollabAvatar, chartPalette,
  getConquistas, renderConquistasBadges,
  updateDateNav, updateDashDayLabel, updateWeekLabel,
  renderDashboard, renderDashCards, renderDashboardOnline, renderWeekTable,
  renderMeuDashboard,
  renderDemandasSemana, renderDashDemandasWeek,
  renderOnline, invalidateCalcDay
} from './js/dashboard.js';
import {
  isManagerUser, isCuradora, isRecuradora,
  _refreshKanbanTypeFilter, _refreshKColSelect,
  _initKColState, initKanban, renderKanban,
  initAvatarsListener, initArquivoListener,
  setAllNotifs, cleanLixeira
} from './js/kanban.js';
import {
  skeletonEntries, renderEntriesList,
  renderMyHistory, renderDemandas,
  renderProjCards, renderCharts, render4Weeks,
  renderInconsistencias,
  initMuralListener, initDesafioListener,
  renderRelatorio
} from './js/demandas.js';
import {
  renderConfiguracoes, patchShowPageForConfig,
  _refreshCollabSelects, _refreshProjectSelects,
  renderCfgColaboradores
} from './js/config.js';
import {
  renderUsuarios, renderApprovals, initUsersListener
} from './js/usuarios.js';
import { registrarLog } from './js/log.js';
import { logError } from './js/logger.js';
import './js/importadores.js'; // side-effects only: registers window.* functions

// ── Constantes globais ────────────────────────────────────────────────────────
const MS_PER_DAY        = 86400000;
const MS_PER_HOUR       = 3600000;
const MS_PER_WEEK       = 604800000;
const ENTRIES_LIVE_DAYS = 180;
// Escalabilidade #1: cap na carga do colaborador (~6 meses — cobre o trimestre
// atual + o anterior, alinhado ao fluxo trimestral). Evita baixar todos os registros
// de sempre; histórico completo fica sob demanda (window.loadFullMyHistory).
const COLLAB_ENTRIES_LIMIT = 800;
const DEFAULT_DAILY_GOAL_HOURS = 9;
// LATE_CUTOFF_HOUR/MIN → js/timer.js

// FIX: <input type="date"> sem min/max deixa o campo de ANO "solto" ao digitar (ex.: vira
// 19__ ou aceita anos absurdos). Definir min/max limita o ano a uma janela sã de 4 dígitos.
// Via focusin (delegação) cobre também os inputs criados dinamicamente nos modais.
document.addEventListener('focusin', (e) => {
  const el = e.target;
  if (el && el.tagName === 'INPUT' && el.type === 'date') {
    if (!el.min) el.min = '2020-01-01';
    if (!el.max) el.max = '2035-12-31';
  }
});

// firebase-refs.js → app, auth, db, analytics, EQUIPE_ID, todos os refs, _buildRefs

// ── MONITORAMENTO DE ERROS ────────────────────────────────────────────────────
window.onerror = (msg, src, line, col, err) => {
  // Persiste no banco de erros (painel) além do Analytics.
  try { logError({ modulo:'window', action:'onerror',
    message: String(msg).slice(0,300),
    stack: String(err?.stack || `${src||''}:${line||0}:${col||0}`).slice(0,2000) }); } catch(_){}
  if(_analytics){
    try {
      logEvent(_analytics, 'js_error', {
        message: String(msg).slice(0,150),
        source: String(src).slice(0,100),
        line: line||0, col: col||0,
        stack: String(err?.stack||'').slice(0,300),
        user: state.currentUser?.email||'anon'
      });
    } catch(_){}
  }
};
// Promessas rejeitadas sem .catch → também viram log de erro.
window.addEventListener('unhandledrejection', (e) => {
  try {
    const r = e && e.reason;
    logError({ modulo:'window', action:'unhandledrejection',
      message: String((r && r.message) || r || 'promessa rejeitada').slice(0,300),
      stack: String((r && r.stack) || '').slice(0,2000) });
  } catch(_){}
});
window.addEventListener('unhandledrejection', ev => {
  if(!_analytics) return;
  try {
    logEvent(_analytics, 'js_unhandled_rejection', {
      reason: String(ev.reason?.message||ev.reason||'').slice(0,200),
      user: state.currentUser?.email||'anon'
    });
  } catch(_){}
});

// ── V2: CONSTANTS — carregadas dinamicamente do Firebase ─────────────────────
// Valores default usados antes da leitura do Firebase (evitam erros de boot)

// ── V2: PAPEL DO USUÁRIO ──────────────────────────────────────────────────────
// state.userPapel, userEquipes: state.userEquipes, state.equipeAtiva → state.* (state.js)

// isCuradora, isRecuradora, isManagerUser → js/kanban.js

// ── V2: BOOT SEQUENCE → js/auth.js ──────────────────────────────────────────
// Wrapper que passa callbacks para _applyConfig e _initDefaultConfig,
// pois essas ainda escrevem nos globals de index_v2.js.
async function bootV2(user){
  const result = await _bootV2Module(user, {
    applyConfig:        _applyConfig,
    initDefaultConfig:  _initDefaultConfig,
    showEquipeSelector: (equipes, ativa) => {
      // Registra a lógica de troca como global ANTES de renderizar os pills
      window._doEquipeSwitch = async (eqId) => {
        if(eqId === state.equipeAtiva) return;
        state.equipeAtiva = eqId;
        delete state._arquivoConfig; // invalida cache ao trocar equipe
        _buildRefs(eqId);
        await _bootV2ConfigModule(eqId, { applyConfig: _applyConfig, initKColState: _initKColState });
        const ttl = document.getElementById('topbarTeamName');
        if(ttl) ttl.textContent = '· ' + (state.EQUIPE_NOME || state.EQUIPE_LABELS[eqId] || EQUIPE_LABELS[eqId] || eqId);
        const cfgArea = document.getElementById('usuariosConfigArea');
        if(cfgArea) delete cfgArea.dataset.loaded;
        updateEquipePills(eqId);
        startDataListeners();
        renderCurrentPage();
      };
      renderEquipeSelector(equipes, ativa);
    },
  });
  if (!result.booted) return false;
  state.userPapel   = result.userPapel;
  state.userEquipes = result.userEquipes;
  state.equipeAtiva = result.equipeAtiva;
  state.coordenacaoAtiva = result.coordenacaoAtiva || null;
  return true;
}
function _applyConfig(cfg){
  invalidateCalcDay();   // metas/horas/ausências podem ter mudado → recalcular dias
  // SEC: rótulos/cores da config vão crus para innerHTML em vários renders.
  // Neutraliza injeção na origem: remove <> de textos e valida cor (#hex), senão cinza.
  const _clean = s => String(s||'').replace(/[<>]/g,'');
  const _color = c => /^#[0-9a-fA-F]{3,8}$/.test(String(c||'')) ? c : '#94A3B8';
  // Projetos
  if(cfg.projetos && Object.keys(cfg.projetos).length){
    state.PROJECTS = {};
    Object.entries(cfg.projetos).forEach(([k,p])=>{
      state.PROJECTS[k] = { label:_clean(p.label||k), color:_color(p.color), amountPerHour:p.amountPerHour||0 };
    });
  }

  // Colaboradores
  if(cfg.usuarios && Object.keys(cfg.usuarios).length){
    state.COLLABS = {}; state.COLLAB_EMAILS = {};
    state.MANAGER_EMAILS = []; state.AUDITOR_EMAILS = [];
    state.MANAGER_PROFILES = {};
    state.KANBAN_ROLES = { curadoras:[], recuradoria:[], gestora:[] };
    Object.entries(cfg.usuarios).forEach(([,u])=>{
      const key = u.key;
      if(!key) return;
      // SEC/FIX: e-mail normalizado p/ minúsculo — o Firebase Auth devolve o e-mail
      // em minúsculo, então o mapeamento precisa casar mesmo que o config tenha
      // maiúsculas (ex.: "Roberto.silva@..."). Senão currentCollabKey vira null.
      const em = (u.email||'').toLowerCase();
      if(u.papel === 'gestora' || u.papel === 'colaborador'){
        state.COLLABS[key] = { label:_clean(u.nome||key), initials:_clean(u.iniciais||key.slice(0,2).toUpperCase()), color:_color(u.cor), active:u.ativo!==false };
        if(em) state.COLLAB_EMAILS[em] = key;
        if(u.papel === 'gestora'){ if(em) state.MANAGER_EMAILS.push(em); state.KANBAN_ROLES.gestora.push(key); state.KANBAN_ROLES.recuradoria.push(key); }
        // Gestor TEMPORÁRIO: colaborador com poderes/UI de gestora (fora do ranking/destaque),
        // enquanto o titular está fora. Entra no "balde" de gestão; o cargo real segue colaborador.
        if(u.gestorTemp === true){ if(em && !state.MANAGER_EMAILS.includes(em)) state.MANAGER_EMAILS.push(em); if(!state.KANBAN_ROLES.gestora.includes(key)){ state.KANBAN_ROLES.gestora.push(key); state.KANBAN_ROLES.recuradoria.push(key); } }
        if(u.curadora) state.KANBAN_ROLES.curadoras.push(key);
        // Metas individuais de jornada
        if(u.horasDia  !== undefined) state.COLLAB_HOURS[key] = { ...(state.COLLAB_HOURS[key]||{}), horasDia:  u.horasDia  };
        if(u.horasSemana !== undefined) state.COLLAB_HOURS[key] = { ...(state.COLLAB_HOURS[key]||{}), horasSemana: u.horasSemana };
        // Ausências recorrentes (ex.: estágio) — reduzem a meta do dia automaticamente
        if(Array.isArray(u.ausencias) && u.ausencias.length) state.COLLAB_HOURS[key] = { ...(state.COLLAB_HOURS[key]||{}), ausencias: u.ausencias };
        // Férias — períodos com meta zerada (sem penalidade), exibe "Férias"
        if(Array.isArray(u.ferias) && u.ferias.length) state.COLLAB_HOURS[key] = { ...(state.COLLAB_HOURS[key]||{}), ferias: u.ferias };
      } else if(u.papel === 'rh' || u.papel === 'auditor' || u.papel === 'coordenador'){
        if(em) state.AUDITOR_EMAILS.push(em);
        if(em) state.MANAGER_PROFILES[em] = { label:_clean(u.nome||em), initials:_clean(u.iniciais||'??'), color:_color(u.cor), role:'Coordenador' };
      } else if(u.papel === 'admin'){
        if(em) state.MANAGER_EMAILS.push(em);
        if(em) state.MANAGER_PROFILES[em] = { label:_clean(u.nome||em), initials:_clean(u.iniciais||'??'), color:_color(u.cor), role:'Admin' };
      }
    });
  }

  // Colunas
  if(cfg.colunas && Object.keys(cfg.colunas).length){
    state.K_COLS = Object.entries(cfg.colunas)
      .sort((a,b)=>(a[1].ordem||0)-(b[1].ordem||0))
      .map(([id,c])=>({ id, label:_clean(c.label||id), color:_color(c.color), botoes:c.botoes||null, project:c.project||null }));
  }

  // Metas e geral
  if(cfg.metas){
    state.DAILY_GOAL_MS    = (cfg.metas.horasDia||9) * 3600000;
    state.PERF_THRESHOLD   = (cfg.metas.threshold||90) / 100;
    state.EDIT_WINDOW_DAYS = cfg.metas.janelaEdicao || 7;
    state._cfgMetasDias    = cfg.metas.metasDias || null;
  }
  // Colunas do Arquivo Morto
  if(cfg.colunas_arquivo && Object.keys(cfg.colunas_arquivo).length){
    state.MODS = Object.entries(cfg.colunas_arquivo)
      .sort((a,b)=>(a[1].ordem||0)-(b[1].ordem||0))
      .map(([id,m])=>({
        id, label:_clean(m.label||id), color:_color(m.color),
        months: m.months||null
      }));
  }

  if(cfg.geral){
    state.EQUIPE_NOME = cfg.geral.nome || 'Equipe';
    // A7: avaliação por estrelas opcional por equipe. Configs legados (sem o flag)
    // mantêm a avaliação ligada; equipes novas nascem com ela desligada.
    state.avaliacaoAtiva = cfg.geral.avaliacaoAtiva !== undefined ? !!cfg.geral.avaliacaoAtiva : true;
  }
  _initKColState();
  // Reconstruir selects com os dados carregados do Firebase
  _refreshCollabSelects();
  _refreshProjectSelects();
  _refreshKColSelect();
  _refreshKanbanTypeFilter();
}

// Reconstrói o filtro de tipo do kanban a partir das tags da equipe
// _refreshKanbanTypeFilter, _refreshKColSelect → js/kanban.js

// Primeiro acesso: grava config padrão da Diagramação no Firebase
async function _initDefaultConfig(){
  // Config inicial genérica — sem dados específicos de equipe
  // A gestora configura projetos, colunas e colaboradores pelas Configurações
  const equipeNome = state.EQUIPE_LABELS[EQUIPE_ID] || EQUIPE_LABELS[EQUIPE_ID] || EQUIPE_ID.charAt(0).toUpperCase()+EQUIPE_ID.slice(1);
  const defaultConfig = {
    geral: { nome: equipeNome, janelaEdicao: 5, avaliacaoAtiva: false },
    metas: { horasDia: 9, threshold: 90, janelaEdicao: 5 },
    projetos: {
      trabalho:  { label:'Trabalho',   color:'#F15A24', amountPerHour: 1   },
      reuniao:   { label:'Reunião',    color:'#A78BFA', amountPerHour: 0   },
      formacao:  { label:'Formação',   color:'#34D399', amountPerHour: 0   },
      ausencia:  { label:'Ausência',   color:'#EF4444', amountPerHour: 0   },
    },
    colunas: {
      a_fazer:      { label:'A Fazer',      color:'#94A3B8', ordem: 0 },
      em_andamento: { label:'Em Andamento', color:'#F59E0B', ordem: 1 },
      revisao:      { label:'Em Revisão',   color:'#8B5CF6', ordem: 2 },
      concluido:    { label:'Concluído',    color:'#22C55E', ordem: 3 },
    },
    colunas_arquivo: {
      arquivo_geral: { label:'Arquivo Geral', color:'#94A3B8', ordem: 0, months: null },
    },
    usuarios: {},
  };

  await set(ref(db, `equipes/${EQUIPE_ID}/config`), defaultConfig);
  _applyConfig(defaultConfig);
}

// EQUIPE_LABELS → js/auth.js
// renderEquipeSelector → js/auth.js
// bootV2Config wrapper (chama _bootV2ConfigModule de auth.js com callbacks locais)
async function bootV2Config(eqId){
  await _bootV2ConfigModule(eqId, {
    applyConfig:   _applyConfig,
    initKColState: _initKColState,
  });
}

// ── V2: INICIAR LISTENERS DE DADOS ──────────────────────────────────────────
function startDataListeners(){
  if(_unsubEntries) _unsubEntries();
  // OTIMIZAÇÃO: o colaborador comum só precisa dos PRÓPRIOS registros — Meu Dashboard,
  // Timer e Meus Registros são todos individuais (ele não vê o dashboard da equipe).
  // Carregar só os dele reduz o download a uma fração e evita trazer registros de
  // colegas ao cliente. Gestão/admin/coordenação/RH/auditoria seguem com a janela de
  // equipe (precisam do time inteiro). Usa o índice "collab" já declarado nas regras.
  const _isPlainCollab = !state.isManager && !state.isAuditor && !!state.currentCollabKey;
  let _entriesQuery;
  if(_isPlainCollab){
    _entriesQuery = state._loadFullHistory
      ? query(entriesRef, orderByChild('collab'), equalTo(state.currentCollabKey))
      : query(entriesRef, orderByChild('collab'), equalTo(state.currentCollabKey), limitToLast(COLLAB_ENTRIES_LIMIT));
  } else {
    const _liveStart = Date.now() - ENTRIES_LIVE_DAYS * MS_PER_DAY;
    _entriesQuery = query(entriesRef, orderByChild('startTime'), startAt(_liveStart));
  }
  _unsubEntries = onValue(_entriesQuery, (snap)=>{
    const newData = snap.val()||{};
    if(Object.keys(state.allEntries).length>0){
      // C5: assinatura leve por registro em vez de serializar o objeto inteiro
      const _sig = e => e ? `${e.modifiedAt||0}|${e.endTime||0}|${e.duration||0}` : '';
      const changed=Object.keys(newData).find(k=>_sig(newData[k])!==_sig(state.allEntries[k]));
      if(changed && state.isManager && state.COLLABS[state.currentCollabKey]){
        const e=newData[changed];
        const who=state.COLLABS[e?.collab]?.label||'Alguém';
        showToast('Atualização',`${who} modificou um registro.`);
      }
    }
    state.allEntries=newData;
    state._entriesVersion++;
    setSyncStatus('ok','Sincronizado ✓');
    _updateTaskSuggestions();
    renderDebounced();
  },(err)=>{
    console.error('[V2] entries listener error:', err);
    setSyncStatus('err','Erro de conexão');
  });

  // C1: listener único de kanban — initKanban() já preserva avaliação e _localOnly
  // e renderiza a página ativa. O segundo onValue duplicado foi removido (sobrescrevia
  // a nota recém-salva, causando o "salva mas não salva").
  if(_unsubKanban2) _unsubKanban2();
  _unsubKanban2 = initKanban();

  if(_unsubActiveTimers) _unsubActiveTimers();
  _unsubActiveTimers = onValue(activeTimersRef,(snap)=>{
    state.activeTimers=snap.val()||{};
    restoreTimerFromFirebase(state.activeTimers);
    if(document.getElementById('page-online')?.classList.contains('active')) renderOnline();
    if(document.getElementById('page-dashboard')?.classList.contains('active')) renderDashboardOnline();
    renderDebounced();
  },(err)=>console.warn('[V2] activeTimers:', err));

  if(_unsubIndManuais) _unsubIndManuais();
  _unsubIndManuais = onValue(indicadoresManuaisRef,(snap)=>{
    state.indicadoresManuais = snap.val()||{};
    if(document.getElementById('page-indicadores')?.classList.contains('active') && typeof window.renderIndicadores==='function') window.renderIndicadores();
  },(err)=>console.warn('[V2] indicadoresManuais:', err));

  if(_unsubCapDia) _unsubCapDia();
  _unsubCapDia = onValue(capDiaRef,(snap)=>{
    state.capDia = snap.val()||{};
    renderDebounced();
  },(err)=>console.warn('[V2] capDia:', err));

  if(_unsubNotifs) _unsubNotifs();
  const _notifsQuery = query(notifsRef, orderByChild('to'), equalTo(state.currentCollabKey), limitToLast(50));   // Escalabilidade #4: cap de notificações (últimas 50)
  _unsubNotifs = onValue(_notifsQuery,(snap)=>{
    setAllNotifs(snap.val()||{});
  },(err)=>console.warn('[V2] notifs:', err));

  if(_unsubCustomTags) _unsubCustomTags();
  _unsubCustomTags = onValue(customTagsRef, snap => {
    state.customTags = snap.val() ? Object.values(snap.val()) : [];
    refreshCustomTagsUI();
  });

  if(_unsubCustomProjects) _unsubCustomProjects();
  _unsubCustomProjects = onValue(customProjectsRef, snap => {
    state.customProjects = snap.val() ? Object.values(snap.val()) : [];
    refreshCustomProjectsUI();
  });

  // Listener de aprovações — apenas para gestora
  if(state.isManager){
    if(_unsubApprovals) _unsubApprovals();
    _unsubApprovals = onValue(approvalRequestsRef, snap => {
      state.allApprovals = snap.val() || {};
      _updateApprovalBadge();
      if(document.getElementById('page-usuarios')?.classList.contains('active')) renderApprovals();
    }, err => console.warn('[V2] approvalRequests:', err));
  }

  if(_unsubUsers) _unsubUsers();
  _unsubUsers = initUsersListener();

  if(_unsubMural) _unsubMural();
  _unsubMural = initMuralListener();

  if(_unsubDesafio) _unsubDesafio();
  _unsubDesafio = initDesafioListener();

  // Listeners de avatares e arquivo (equipe-específicos)
  if(_unsubAvatars) _unsubAvatars();
  _unsubAvatars = initAvatarsListener();

  if(_unsubArquivo) _unsubArquivo();
  _unsubArquivo = initArquivoListener();

  if(_unsubHolidays) _unsubHolidays();
  _unsubHolidays = onValue(holidaysRef, snap => {
    state.allHolidays = snap.val() || {};
    invalidateCalcDay();
    renderDebounced();
  }, err => console.warn('[V2] holidays:', err));

  if(_unsubFolgas) _unsubFolgas();
  _unsubFolgas = onValue(folgasRef, snap => {
    state.allFolgas = snap.val() || {};
    invalidateCalcDay();
    renderDebounced();
  }, err => console.warn('[V2] folgas:', err));
}

// Escalabilidade #1: traz o histórico COMPLETO do colaborador sob demanda (sem o
// cap de ${COLLAB_ENTRIES_LIMIT}). Sem regressão: por padrão carrega o recente,
// e quem precisa do passado clica no botão em "Meus Registros".
window.loadFullMyHistory = () => {
  if(state._loadFullHistory) return;
  state._loadFullHistory = true;
  const btn = document.getElementById('btnLoadFullHistory');
  if(btn){ btn.disabled = true; btn.textContent = 'Carregando histórico…'; }
  startDataListeners();
  showToast('Histórico completo', 'Trazendo todos os seus registros…');
};

// ── STATE ────────────────────────────────────────────────────────────────────
// // timer state → app.* in state.js (timer.js) → migrated to app.* (state.js)
// 
// ── UNSUBSCRIBE HANDLES — todos os listeners onValue ─────────────────────────
let _unsubEntries = null, _unsubKanban = null, _unsubActiveTimers = null;
let _unsubNotifs = null, _unsubCustomTags = null, _unsubCustomProjects = null;
let _unsubMural = null, _unsubDesafio = null, _unsubUsers = null;
let _unsubKanban2 = null, _unsubNotifs2 = null, _unsubAvatars = null, _unsubArquivo = null;
let _unsubApprovals = null, _unsubHolidays = null, _unsubIndManuais = null, _unsubCapDia = null;
let _unsubFolgas = null;

// ── ENTRIES ARRAY MEMOIZATION ─────────────────────────────────────────────────

state.viewDate.setHours(0,0,0,0); state.projDate.setHours(0,0,0,0);

// ── FORÇAR CRIAÇÃO DE NOVA SENHA NO 1º ACESSO ─────────────────────────────────
// Muitos colaboradores ainda usavam a senha padrão (0123456). A partir desta data,
// todo usuário (exceto admin) precisa criar uma senha pessoal no primeiro acesso.
// Marcamos quem já trocou em /pwdReset/<uid>. Para DESATIVAR no futuro: FORCE_PWD_RESET_SINCE = 0.
const FORCE_PWD_RESET_SINCE = new Date(2026, 6, 11, 0, 0, 0).getTime(); // 11/07/2026 00:00 (mês 6 = julho)
const PWD_PADRAO = '0123456';

async function _enforcePasswordReset(user){
  if(!FORCE_PWD_RESET_SINCE || Date.now() < FORCE_PWD_RESET_SINCE) return true; // ainda inativo
  let papel = null;
  try { papel = (await get(ref(db, `usuarios/${user.uid}/papel`))).val(); } catch(e){ /* sem perfil: bootV2 trata */ }
  if(papel === 'admin') return true;               // admin isento
  let resetAt = 0;
  try { resetAt = (await get(ref(db, `pwdReset/${user.uid}`))).val() || 0; } catch(e){}
  if(resetAt >= FORCE_PWD_RESET_SINCE) return true; // já criou senha após o corte
  return await _showPwdResetGate(user);
}

// Overlay bloqueante: cria nova senha via updatePassword (usuário acabou de autenticar).
// Resolve true = pode seguir pro boot; false = saiu/redirecionou.
// opts.demo = true → só demonstra a tela/validação, NÃO troca senha (para validação no preview).
function _showPwdResetGate(user, opts){
  const demo = !!(opts && opts.demo);
  return new Promise(resolve => {
    const gate = document.getElementById('pwdGate');
    const loading = document.getElementById('appLoading');
    if(!gate){ resolve(true); return; }            // fail-open: sem overlay, não trava o acesso
    if(loading) loading.classList.add('hidden');
    gate.style.display = 'flex';

    const $ = id => document.getElementById(id);
    const npEl = $('pwdGateNew'), cpEl = $('pwdGateConfirm'), errEl = $('pwdGateErr'), btn = $('pwdGateBtn');
    const showErr = m => { if(errEl){ errEl.textContent = m; errEl.style.display = m ? 'block' : 'none'; } };

    const showChk = $('pwdGateShow');
    if(showChk) showChk.onchange = ()=>{ const t = showChk.checked ? 'text':'password'; if(npEl) npEl.type=t; if(cpEl) cpEl.type=t; };

    const submit = async ()=>{
      showErr('');
      const np = (npEl?.value||''), cp = (cpEl?.value||'');
      if(np.length < 6){ showErr('A senha precisa ter pelo menos 6 caracteres.'); npEl?.focus(); return; }
      if(np === PWD_PADRAO){ showErr('Escolha uma senha diferente da padrão (0123456).'); npEl?.focus(); return; }
      if(np !== cp){ showErr('As senhas não coincidem.'); cpEl?.focus(); return; }
      if(demo){ gate.style.display='none'; alert('✅ Demonstração: em produção, a nova senha seria salva agora e você entraria no Kronos normalmente.'); resolve(true); return; }
      btn.disabled = true; btn.textContent = 'Salvando…';
      try{
        await updatePassword(user, np);
        await set(ref(db, `pwdReset/${user.uid}`), Date.now());
        gate.style.display = 'none';
        if(loading) loading.classList.remove('hidden');
        resolve(true);
      }catch(e){
        const code = e.code || '';
        btn.disabled = false; btn.textContent = 'Salvar e continuar';
        if(code === 'auth/requires-recent-login'){
          showErr('Por segurança, entre novamente para criar sua senha. Redirecionando…');
          setTimeout(async ()=>{ try{ await signOut(auth); }catch(_){} window.location.href='login_v2.html'; }, 1800);
          resolve(false);
        } else if(code === 'auth/weak-password'){
          showErr('Senha fraca. Use pelo menos 6 caracteres.');
        } else {
          showErr('Não foi possível salvar a senha. Verifique sua conexão e tente novamente.');
          console.error('[pwdGate]', code, e.message);
        }
      }
    };

    if(btn) btn.onclick = submit;
    if(cpEl) cpEl.onkeydown = e => { if(e.key==='Enter') submit(); };
    const logoutBtn = $('pwdGateLogout');
    if(logoutBtn) logoutBtn.onclick = async ()=>{
      if(demo){ gate.style.display='none'; resolve(true); return; }   // demo: só fecha
      try{ await signOut(auth); }catch(_){} window.location.href='login_v2.html';
    };
    setTimeout(()=>npEl?.focus(), 100);
  });
}

// Modo demonstração do gate de senha (validação no preview): abra com ?pwdgate=demo
if(new URLSearchParams(location.search).get('pwdgate') === 'demo'){
  document.addEventListener('DOMContentLoaded', ()=>_showPwdResetGate(null, { demo:true }));
}

// ── AUTH + BOOT V2 ────────────────────────────────────────────────────────────
onAuthStateChanged(auth, async user => {
  if(!user){
    // Oculta o loading antes de redirecionar para evitar flash
    const ld = document.getElementById('appLoading');
    if(ld) ld.classList.add('hidden');
    window.location.href='login_v2.html';
    return;
  }
  state.currentUser = user;

  // Força criação de senha pessoal no 1º acesso (exceto admin) — bloqueia o boot até concluir
  const pwdOk = await _enforcePasswordReset(user);
  if(!pwdOk) return;

  // Boot: identifica equipe, carrega config dinamicamente
  const booted = await bootV2(user);
  if(!booted) return;

  // state.currentCollabKey resolvido APÓS o boot (state.COLLAB_EMAILS já populado)
  const isAdmin   = state.userPapel === 'admin';
  // FIX: e-mail do Auth normalizado (sempre minúsculo) p/ casar com os mapas
  const email     = (user.email||'').toLowerCase();
  // isAuditor é definido primeiro — coordenador nunca vira gestor mesmo se estiver em config de equipe
  state.isAuditor = state.userPapel === 'rh' || state.userPapel === 'auditor' || state.userPapel === 'coordenador';
  state.isRH = state.userPapel === 'rh';   // RH: visão ampla (2 coordenações), porém SOMENTE LEITURA
  state.isManager = !state.isAuditor && (state.MANAGER_EMAILS.includes(email) || state.userPapel === 'gestora' || isAdmin);
  state.currentCollabKey = state.COLLAB_EMAILS[email] || null;

  // Perfil de exibição na sidebar
  const col = (state.currentCollabKey && state.COLLABS[state.currentCollabKey])
    ? state.COLLABS[state.currentCollabKey]
    : { label: user.displayName || user.email.split('@')[0], initials: (user.displayName||user.email).slice(0,2).toUpperCase(), color: '#94A3B8' };

  const roleLabels = { admin:'Administração', gestora:'Gestão', coordenador:'Coordenação', auditor:'Coordenação', rh:'Coordenação', colaborador:'Colaboração' };
  // Chave sintética p/ gestor/coordenador (não estão em config/usuarios). Sanitizada:
  // o Firebase proíbe . # $ [ ] / em chaves de caminho (ex.: e-mail "carlos.moraes" → "carlosmoraes").
  if(!state.currentCollabKey && (state.isManager||state.isAuditor)){
    state.currentCollabKey = (col.label||'user').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'')
      .replace(/\s+/g,'_').replace(/[^a-z0-9_]/g,'') || 'user';
  }

  document.getElementById('sidebarAv').textContent = col.initials;
  document.getElementById('sidebarAv').style.background = col.color;
  document.getElementById('sidebarName').textContent = col.label;
  document.getElementById('sidebarRole').textContent = roleLabels[state.userPapel] || 'Colaboração';
  document.getElementById('timerSubtitle').textContent = `Olá, ${col.label}! Bem-vindo ao Kronos.`;

  const ttl = document.getElementById('topbarTeamName');
  if(ttl) ttl.textContent = state.EQUIPE_NOME;

  // ── Visibilidade de navegação por papel ──────────────────────────────────
  const show = (id,v='block')=>{const e=document.getElementById(id);if(e)e.style.display=v;};
  const hide = (id)=>{const e=document.getElementById(id);if(e)e.style.display='none';};

  if(isAdmin){
    // ADMIN — acesso total + seletor de equipe
    show('navDashboard'); show('navGestora'); show('navFerramentas');
    show('ferrConfig'); show('navIndicadores','');
    show('navKanban','flex'); show('navTimer','flex'); show('navMeuHistorico','flex');
    show('desafioTopBtn'); show('mCollabField','flex');
    show('btnManageTags','inline-flex'); show('btnNovoColab');
    show('btnKanbanCols',''); show('btnArquivoMortoCols',''); show('btnArquivoCols','');
    show('ferrFeriados');
    show('ferrLog');                 // Banco de Log: exclusivo do admin
    show('ferrCoord');               // Coordenações & Equipes: exclusivo do admin
    hide('collabWrap');
    if(state.userEquipes.length > 1) renderEquipeSelector(state.userEquipes, state.equipeAtiva);
    setTimeout(()=>showPage('dashboard', document.querySelector('[onclick*="\'dashboard\'"]')), 100);

  } else if(state.isManager){
    // GESTORA — acesso total à equipe (sem seletor multi-equipe, sem dash individual)
    show('navTimer','flex'); show('navMeuHistorico','flex');
    show('navDashboard'); show('navGestora'); show('navFerramentas');
    show('ferrConfig'); show('navIndicadores','');
    show('navKanban','flex'); show('desafioTopBtn');
    show('mCollabField','flex'); show('btnManageTags','inline-flex');
    show('btnNovoColab'); show('btnKanbanCols',''); show('btnArquivoMortoCols',''); show('btnArquivoCols','');
    show('ferrFeriados');
    hide('collabWrap'); hide('navMeuDashboard');

  } else if(state.isRH){
    // RH — SOMENTE LEITURA das 2 coordenações: Dashboard, Fluxo de Demandas e Gestão.
    // Sem Timer, Meus Registros, Ferramentas e sem nenhum botão de edição.
    hide('navTimer'); hide('navMeuHistorico'); hide('navMeuDashboard');
    hide('collabWrap'); hide('desafioTopBtn');
    hide('navFerramentas');
    show('navDashboard'); show('navGestora'); show('navIndicadores','');
    show('navKanban','flex');
    // edição desligada: NÃO mostra mCollabField, btnNovoColab, btnManageTags, colunas, ferrConfig
    hide('mCollabField'); hide('btnNovoColab'); hide('btnManageTags');
    hide('btnKanbanCols'); hide('btnArquivoMortoCols'); hide('btnArquivoCols');
    hide('ferrConfig'); hide('ferrFeriados');
    if(state.userEquipes.length > 1) renderEquipeSelector(state.userEquipes, state.equipeAtiva);
    setTimeout(()=>showPage('dashboard', document.querySelector('[onclick*="\'dashboard\'"]')), 100);

  } else if(state.isAuditor){
    // COORDENADOR — acesso igual ao admin, sem Timer / Meus Registros
    // (Fluxo de Demandas/Kanban habilitado: vê o quadro de cada equipe via seletor de equipe)
    hide('navTimer'); hide('navMeuHistorico');
    hide('collabWrap'); hide('desafioTopBtn');
    show('navKanban','flex');
    show('navDashboard'); show('navGestora'); show('navFerramentas');
    show('ferrConfig'); show('navIndicadores','');
    show('mCollabField','flex'); show('btnManageTags','inline-flex');
    show('btnNovoColab'); show('btnKanbanCols',''); show('btnArquivoMortoCols',''); show('btnArquivoCols','');
    if(state.userEquipes.length > 1) renderEquipeSelector(state.userEquipes, state.equipeAtiva);
    setTimeout(()=>showPage('dashboard', document.querySelector('[onclick*="\'dashboard\'"]')), 100);

  } else {
    // COLABORADOR — timer, histórico pessoal, dashboard individual
    hide('collabWrap');
    show('navMeuDashboard','flex');
    show('navTimer','flex');
    show('navMeuHistorico','flex');
    const nt=document.getElementById('navTimer');if(nt)nt.classList.add('active');
  }
  // Botão de Feriados/Folgas na dashboard (acesso rápido) — só gestão/admin/coordenador
  if(state.isManager || state.userPapel==='coordenador'){
    const bf=document.getElementById('btnDashFeriados'); if(bf) bf.style.display='inline-flex';
  }
  window.restoreNavGroups?.();   // Usabilidade: restaura o grupo "Gestão" aberto se o usuário deixou

  const cs=document.getElementById('collabSelect');
  if(cs && state.currentCollabKey && state.COLLABS[state.currentCollabKey]) cs.value=state.currentCollabKey;

  // Iniciar listeners de dados
  startDataListeners();

  // Log de login (1x por carregamento, após refs/papel definidos)
  if(!window._loginLogged){ window._loginLogged = true; try { registrarLog('login','Entrou no sistema', state.userPapel||''); } catch(e){} }

  resetNoActivityTimer();

  // Avisa gestora sobre aprovações pendentes no boot
  if(state.isManager){
    setTimeout(()=>{
      const pending = Object.values(state.allApprovals).filter(r=>r.status==='pending').length;
      if(pending > 0){
        showToast(
          `${pending} aprovação${pending>1?'ões':''} pendente${pending>1?'s':''}`,
          `Acesse Ferramentas → Usuários para revisar.`
        );
      }
    }, 3000);
  }

  // ── Ocultar loading screen e revelar layout ───────────────────────────────
  const loadingEl = document.getElementById('appLoading');
  const layoutEl  = document.querySelector('.layout');
  if(loadingEl) loadingEl.classList.add('hidden');
  if(layoutEl)  layoutEl.classList.add('ready');
});


window.doLogout = () => {
  [_unsubEntries, _unsubKanban, _unsubActiveTimers, _unsubNotifs, _unsubCustomTags,
   _unsubCustomProjects, _unsubMural, _unsubDesafio, _unsubUsers,
   _unsubKanban2, _unsubNotifs2, _unsubAvatars, _unsubArquivo, _unsubApprovals, _unsubHolidays, _unsubFolgas, _unsubIndManuais, _unsubCapDia].forEach(fn => fn?.());
  if(state.intervalId) clearInterval(state.intervalId);
  if(state.noActivityTimer) clearTimeout(state.noActivityTimer);
  if(state._onlineAutoRefresh){ clearInterval(state._onlineAutoRefresh); state._onlineAutoRefresh=null; }
  signOut(auth).then(() => window.location.href='login_v2.html').catch(()=>{ window.location.href='login_v2.html'; });
};


// ── CAP DIA (piso de 100%) ────────────────────────────────────────────────────
// Marca/desmarca capDia/{dk}/{collabKey}. Só gestão (regra do RTDB também valida).
window.toggleCapDia = async (collabKey, dk, ev) => {
  if(!(state.isManager || ['gestora','admin','coordenador'].includes(state.userPapel))) return;
  if(!collabKey || !dk) return;
  const node = child(capDiaRef, `${dk}/${collabKey}`);
  const on = !(state.capDia?.[dk]?.[collabKey]);
  try {
    if(on) await set(node, true);
    else   await remove(node);
    if(on) celebrate(ev?.clientX ?? window.innerWidth/2, ev?.clientY ?? window.innerHeight/2);   // Craft: comemora ao bater 100%/dia
    try { registrarLog('capDia', `${on?'Ativou':'Removeu'} piso 100%`, `${collabKey} · ${dk}`); } catch(e){}
  } catch(e) {
    console.warn('[toggleCapDia]', e);
    alert('Não foi possível alterar o piso do dia: ' + (e?.message||e));
  }
};

// Liga/desliga o piso de 100% para TODOS os colaboradores do dia exibido (gestão).
window.toggleCapDiaAll = async () => {
  if(!(state.isManager || ['gestora','admin','coordenador'].includes(state.userPapel))) return;
  const dk = dKey(state.dashDay);
  // mesma regra do renderDashCards: ativos e não-gestores
  const keys = Object.keys(state.COLLABS).filter(k =>
    (state.usersConfig[k]?.active !== false) &&
    !state.MANAGER_EMAILS.includes(Object.keys(state.COLLAB_EMAILS).find(e=>state.COLLAB_EMAILS[e]===k)||'')
  );
  if(!keys.length) return;
  const allCapped = keys.every(k => state.capDia?.[dk]?.[k]);
  const updates = {};
  keys.forEach(k => { updates[k] = allCapped ? null : true; });  // null remove a folha
  try {
    await update(child(capDiaRef, dk), updates);
    try { registrarLog('capDia', `${allCapped?'Removeu':'Ativou'} piso 100% de TODOS`, dk); } catch(e){}
  } catch(e) {
    console.warn('[toggleCapDiaAll]', e);
    alert('Não foi possível atualizar todos: ' + (e?.message||e));
  }
};


// ── FERIADOS E FOLGAS ─────────────────────────────────────────────────────────
// Tipos: feriado / atestado / dayoff (só rótulo — todos zeram a meta do dia).
// Abrangência: 'all' (toda a equipe → holidays/{iso}) ou um colaborador
// específico (folgas/{iso}/{collabKey}). getDailyGoalMs zera a meta conforme o caso.
const FOLGA_TIPOS  = { feriado:'Feriado', atestado:'Atestado', dayoff:'Day off' };
const FOLGA_CORES  = { feriado:'#f15a24', atestado:'#ef4444', dayoff:'#3b82f6' };

// Intervalo de datas (feriados/folgas por período — ex.: atestado de 14 dias).
// Trabalha em horário LOCAL ao meio-dia p/ evitar drift de fuso/DST.
function _isoToLocalDate(iso){ const [y,m,d]=String(iso).split('-').map(Number); return new Date(y, m-1, d, 12, 0, 0); }
function _dateToIso(dt){ const y=dt.getFullYear(), m=String(dt.getMonth()+1).padStart(2,'0'), d=String(dt.getDate()).padStart(2,'0'); return `${y}-${m}-${d}`; }
function _isoRange(startIso, endIso){
  const out=[]; const cur=_isoToLocalDate(startIso), end=_isoToLocalDate(endIso);
  let guard=0;
  while(cur<=end && guard++<400){ out.push(_dateToIso(cur)); cur.setDate(cur.getDate()+1); }
  return out;
}
function _fmtIsoBR(iso){ const [y,m,d]=String(iso).split('-'); return `${d}/${m}/${y}`; }

window.openHolidaysModal = () => {
  // Colaborador comum → modal de SOLICITAÇÃO (vai p/ aprovação da gestão), não o painel de gestão.
  if(!state.isManager && !state.isAuditor && state.currentCollabKey) return window._openFolgaRequestModal();
  let modal = document.getElementById('holidaysModal');
  if(!modal){
    modal = document.createElement('div');
    modal.id = 'holidaysModal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.35);z-index:1300;display:flex;align-items:center;justify-content:center;';
    modal.onclick = e => { if(e.target===modal) modal.remove(); };
    document.body.appendChild(modal);
  }
  const canEdit = state.isManager;
  // Lista unificada: feriados da equipe (todos) + folgas/atestados por colaborador.
  // Registros lançados como INTERVALO compartilham um `grp` → exibidos/removidos como um bloco só.
  const flat = [];
  Object.entries(state.allHolidays||{}).forEach(([iso,h])=>flat.push({iso, scope:'all', type:h.type||'feriado', label:h.label||'Feriado', grp:h.grp||null}));
  Object.entries(state.allFolgas||{}).forEach(([iso,byCollab])=>{
    Object.entries(byCollab||{}).forEach(([ck,f])=> f && flat.push({iso, scope:'collab', collab:ck, type:f.type||'atestado', label:f.label||'Folga', grp:f.grp||null}));
  });
  const groups = {}, rows = [];
  flat.forEach(r=>{
    if(r.grp){ const k=r.grp+'|'+(r.collab||''); (groups[k]=groups[k]||[]).push(r); }
    else rows.push({...r, startIso:r.iso, endIso:r.iso, count:1});
  });
  Object.values(groups).forEach(g=>{
    g.sort((a,b)=>a.iso.localeCompare(b.iso));
    rows.push({...g[0], startIso:g[0].iso, endIso:g[g.length-1].iso, count:g.length});
  });
  rows.sort((a,b)=> a.startIso.localeCompare(b.startIso) || a.scope.localeCompare(b.scope) || (a.collab||'').localeCompare(b.collab||''));
  const collabOpts = Object.keys(state.COLLABS||{}).filter(k=>isActive(k))
    .sort((a,b)=>(state.COLLABS[a].label||a).localeCompare(state.COLLABS[b].label||b))
    .map(k=>`<option value="${escH(k)}">${escH(state.COLLABS[k].label||k)}</option>`).join('');
  const tipoOpts = Object.entries(FOLGA_TIPOS).map(([v,l])=>`<option value="${v}">${l}</option>`).join('');
  const fldLbl = 'font-size:0.65rem;font-weight:800;color:var(--muted);margin-bottom:4px;text-transform:uppercase;';
  const fld = 'width:100%;padding:8px 10px;border-radius:8px;border:1.5px solid var(--border);background:var(--surface2);color:var(--text);font-size:0.82rem;';
  modal.innerHTML = `
    <div style="background:var(--surface);border-radius:16px;padding:24px;width:480px;max-width:95vw;max-height:82vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,0.18);">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
        <div style="font-size:1rem;font-weight:800;">Feriados e Folgas</div>
        <button onclick="document.getElementById('holidaysModal').remove()" aria-label="Fechar" style="background:none;border:none;font-size:1.1rem;cursor:pointer;color:var(--muted);"><span aria-hidden="true">✕</span></button>
      </div>
      ${canEdit ? `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">
        <div><label for="holidayDateInput" style="${fldLbl};display:block;">Data início</label><input id="holidayDateInput" type="date" style="${fld}"></div>
        <div><label for="holidayEndInput" style="${fldLbl};display:block;">Data fim <span style="text-transform:none;font-weight:600;opacity:0.7;">(opcional)</span></label><input id="holidayEndInput" type="date" style="${fld}"></div>
        <div><label for="holidayTypeInput" style="${fldLbl};display:block;">Tipo</label><select id="holidayTypeInput" style="${fld}">${tipoOpts}</select></div>
        <div><label for="holidayScopeInput" style="${fldLbl};display:block;">Abrangência</label>
          <select id="holidayScopeInput" style="${fld}" onchange="document.getElementById('holidayCollabWrap').style.display=this.value==='collab'?'block':'none'">
            <option value="all">Todos os colaboradores</option>
            <option value="collab">Colaborador específico</option>
          </select>
        </div>
        <div id="holidayCollabWrap" style="display:none;"><label for="holidayCollabInput" style="${fldLbl};display:block;">Colaborador</label>
          <select id="holidayCollabInput" style="${fld}"><option value="">Selecione…</option>${collabOpts}</select>
        </div>
        <div style="grid-column:1 / -1;"><label for="holidayLabelInput" style="${fldLbl};display:block;">Nome (opcional)</label>
          <input id="holidayLabelInput" type="text" placeholder="Ex: Corpus Christi" maxlength="50" style="${fld}">
        </div>
      </div>
      <button onclick="window.addHoliday()" style="width:100%;background:var(--orange);color:#fff;border:none;border-radius:8px;padding:9px 14px;font-weight:700;font-size:0.82rem;cursor:pointer;margin-bottom:18px;">+ Adicionar</button>` : ''}
      <div style="font-size:0.65rem;font-weight:800;color:var(--muted);text-transform:uppercase;margin-bottom:8px;">Registros cadastrados</div>
      ${rows.length ? rows.map(r=>{
        const cor = FOLGA_CORES[r.type]||'#94A3B8';
        const quem = r.scope==='all' ? 'Toda a equipe' : (state.COLLABS[r.collab]?.label||r.collab);
        const isRange = r.count>1;
        const onRemove = isRange
          ? (r.scope==='all' ? `window.removeHolidayGroup('${escH(r.grp)}')` : `window.removeFolgaGroup('${escH(r.grp)}','${escH(r.collab)}')`)
          : (r.scope==='all' ? `window.removeHoliday('${escH(r.startIso)}')` : `window.removeFolga('${escH(r.startIso)}','${escH(r.collab)}')`);
        const periodo = isRange ? `${_fmtIsoBR(r.startIso)} → ${_fmtIsoBR(r.endIso)} · ${r.count} dias` : _fmtIsoBR(r.startIso);
        return `<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:var(--surface2);border-radius:8px;margin-bottom:6px;gap:10px;">
          <div style="min-width:0;">
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
              <span style="font-size:0.58rem;font-weight:800;text-transform:uppercase;padding:2px 7px;border-radius:100px;background:${cor}22;color:${cor};border:1px solid ${cor}55;">${FOLGA_TIPOS[r.type]||r.type}</span>
              <span style="font-size:0.82rem;font-weight:700;">${escH(r.label)}</span>
            </div>
            <div style="font-size:0.68rem;color:var(--muted);margin-top:3px;">${periodo} · ${escH(quem)}</div>
          </div>
          ${canEdit ? `<button onclick="${onRemove}" style="background:none;border:1.5px solid var(--danger);color:var(--danger);border-radius:6px;padding:3px 10px;font-size:0.72rem;font-weight:700;cursor:pointer;white-space:nowrap;">Remover</button>` : ''}
        </div>`;
      }).join('') : '<div style="text-align:center;color:var(--muted);font-size:0.78rem;padding:12px;">Nenhum registro cadastrado.</div>'}
    </div>`;
};

window.addHoliday = async () => {
  const startIso = document.getElementById('holidayDateInput')?.value;
  if(!startIso){ showToast('Data obrigatória','Selecione a data de início.'); return; }
  const endIso = document.getElementById('holidayEndInput')?.value || startIso;   // fim vazio = só o dia de início
  if(endIso < startIso){ showToast('Datas invertidas','A data de fim não pode ser anterior à de início.'); return; }
  const isos = _isoRange(startIso, endIso);
  if(isos.length > 366){ showToast('Período muito longo','Lance no máximo 366 dias por vez.'); return; }
  const type  = document.getElementById('holidayTypeInput')?.value || 'feriado';
  const scope = document.getElementById('holidayScopeInput')?.value || 'all';
  const label = (document.getElementById('holidayLabelInput')?.value.trim() || FOLGA_TIPOS[type] || 'Feriado').slice(0,50);
  const isRange = isos.length > 1;
  const meta = { label, type, setBy: state.currentUser?.email||'', setAt: Date.now() };
  // grp: liga os dias de um mesmo lançamento p/ exibir/remover como bloco (só quando é intervalo)
  if(isRange) meta.grp = `${scope}_${type}_${startIso}_${Date.now()}`;
  try {
    if(scope==='collab'){
      const collab = document.getElementById('holidayCollabInput')?.value;
      if(!collab){ showToast('Colaborador obrigatório','Selecione o colaborador.'); return; }
      const updates = {}; isos.forEach(iso=>updates[`${iso}/${collab}`] = meta);
      await update(folgasRef, updates);
      const nome = state.COLLABS[collab]?.label||collab;
      showToast('✅ Registrado', isRange ? `${label} de ${nome}: ${isos.length} dias (${_fmtIsoBR(startIso)} → ${_fmtIsoBR(endIso)}).` : `${label} de ${nome} em ${_fmtIsoBR(startIso)}.`);
    } else {
      const updates = {}; isos.forEach(iso=>updates[iso] = meta);
      await update(holidaysRef, updates);
      showToast('✅ Registrado', isRange ? `${label}: ${isos.length} dias (${_fmtIsoBR(startIso)} → ${_fmtIsoBR(endIso)}) p/ a equipe.` : `${label} (${_fmtIsoBR(startIso)}) p/ toda a equipe.`);
    }
    setTimeout(()=>window.openHolidaysModal(), 200);
  } catch(e){ showToast('Erro','Não foi possível salvar. Verifique sua conexão.'); }
};

window.removeHoliday = async (iso) => {
  if(!confirm(`Remover o registro de ${iso} (toda a equipe)?`)) return;
  try {
    await remove(child(holidaysRef, iso));
    showToast('Registro removido', iso);
    setTimeout(()=>window.openHolidaysModal(), 200);
  } catch(e){ showToast('Erro','Não foi possível remover.'); }
};

window.removeFolga = async (iso, collab) => {
  if(!confirm(`Remover a folga/atestado de ${state.COLLABS[collab]?.label||collab} em ${_fmtIsoBR(iso)}?`)) return;
  try {
    await remove(child(folgasRef, `${iso}/${collab}`));
    showToast('Registro removido', _fmtIsoBR(iso));
    setTimeout(()=>window.openHolidaysModal(), 200);
  } catch(e){ showToast('Erro','Não foi possível remover.'); }
};

// Remoção em bloco de um lançamento por intervalo (mesmo grp).
window.removeHolidayGroup = async (grp) => {
  const isos = Object.entries(state.allHolidays||{}).filter(([,h])=>h && h.grp===grp).map(([iso])=>iso);
  if(!isos.length) return;
  if(!confirm(`Remover este registro de ${isos.length} dia(s) (toda a equipe)?`)) return;
  try {
    const updates = {}; isos.forEach(iso=>updates[iso] = null);
    await update(holidaysRef, updates);
    showToast('Registro removido', `${isos.length} dia(s).`);
    setTimeout(()=>window.openHolidaysModal(), 200);
  } catch(e){ showToast('Erro','Não foi possível remover.'); }
};

window.removeFolgaGroup = async (grp, collab) => {
  const isos = Object.entries(state.allFolgas||{}).filter(([,byC])=>byC && byC[collab] && byC[collab].grp===grp).map(([iso])=>iso);
  if(!isos.length) return;
  if(!confirm(`Remover este registro de ${isos.length} dia(s) de ${state.COLLABS[collab]?.label||collab}?`)) return;
  try {
    const updates = {}; isos.forEach(iso=>updates[`${iso}/${collab}`] = null);
    await update(folgasRef, updates);
    showToast('Registro removido', `${isos.length} dia(s).`);
    setTimeout(()=>window.openHolidaysModal(), 200);
  } catch(e){ showToast('Erro','Não foi possível remover.'); }
};

// ── COLABORADOR: solicitar a própria ausência (vai p/ aprovação da gestão) ────
// O colaborador NÃO escreve em /folgas (regra só permite gestão). Ele cria um
// approvalRequest type:'folga'; ao aprovar, a gestora é quem grava a folga.
window._openFolgaRequestModal = async () => {
  const meKey = state.currentCollabKey;
  let modal = document.getElementById('holidaysModal');
  if(!modal){
    modal = document.createElement('div');
    modal.id = 'holidaysModal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.35);z-index:1300;display:flex;align-items:center;justify-content:center;';
    modal.onclick = e => { if(e.target===modal) modal.remove(); };
    document.body.appendChild(modal);
  }
  // minhas solicitações pendentes (busca única ao abrir)
  let pend = [];
  try {
    const snap = await get(query(approvalRequestsRef, orderByChild('requestedBy'), equalTo(meKey)));
    pend = Object.values(snap.val()||{}).filter(r=>r.type==='folga' && r.status==='pending');
  } catch(e){ /* silencioso */ }
  pend.sort((a,b)=>(a.payload?.startIso||'').localeCompare(b.payload?.startIso||''));
  // minhas ausências já aprovadas (do state.allFolgas), agrupadas por intervalo
  const flat=[]; Object.entries(state.allFolgas||{}).forEach(([iso,byC])=>{ if(byC && byC[meKey]) flat.push({iso, ...byC[meKey]}); });
  const groups={}, aprov=[];
  flat.forEach(r=>{ if(r.grp){ (groups[r.grp]=groups[r.grp]||[]).push(r); } else aprov.push({...r,startIso:r.iso,endIso:r.iso,count:1}); });
  Object.values(groups).forEach(g=>{ g.sort((a,b)=>a.iso.localeCompare(b.iso)); aprov.push({...g[0],startIso:g[0].iso,endIso:g[g.length-1].iso,count:g.length}); });
  aprov.sort((a,b)=>b.startIso.localeCompare(a.startIso));

  const fldLbl='font-size:0.65rem;font-weight:800;color:var(--muted);margin-bottom:4px;text-transform:uppercase;';
  const fld='width:100%;padding:8px 10px;border-radius:8px;border:1.5px solid var(--border);background:var(--surface2);color:var(--text);font-size:0.82rem;';
  const chip = (txt,cor,bg) => `<span style="font-size:0.55rem;font-weight:800;text-transform:uppercase;padding:2px 7px;border-radius:100px;background:${bg};color:${cor};">${txt}</span>`;
  const cardRow = (chipHtml,label,per) => `<div style="display:flex;align-items:center;gap:8px;padding:9px 12px;background:var(--surface2);border-radius:8px;margin-bottom:6px;">${chipHtml}<div style="min-width:0;"><div style="font-size:0.8rem;font-weight:700;">${escH(label)}</div><div style="font-size:0.66rem;color:var(--muted);margin-top:2px;">${per}</div></div></div>`;
  const periodo = (a,b,n) => a===b ? _fmtIsoBR(a) : `${_fmtIsoBR(a)} → ${_fmtIsoBR(b)} · ${n} dias`;
  modal.innerHTML = `
    <div style="background:var(--surface);border-radius:16px;padding:24px;width:460px;max-width:95vw;max-height:82vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,0.18);">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
        <div style="font-size:1rem;font-weight:800;">Solicitar ausência</div>
        <button onclick="document.getElementById('holidaysModal').remove()" aria-label="Fechar" style="background:none;border:none;font-size:1.1rem;cursor:pointer;color:var(--muted);"><span aria-hidden="true">✕</span></button>
      </div>
      <div style="font-size:0.72rem;color:var(--muted);margin-bottom:14px;line-height:1.45;">Registre sua ausência para que a meta desses dias seja zerada. <strong>A solicitação passa pela aprovação da gestão.</strong> O atestado em si deve ser anexado no sistema do RH.</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">
        <div><label for="folgaReqStart" style="${fldLbl};display:block;">Data início</label><input id="folgaReqStart" type="date" style="${fld}"></div>
        <div><label for="folgaReqEnd" style="${fldLbl};display:block;">Data fim <span style="text-transform:none;font-weight:600;opacity:0.7;">(opcional)</span></label><input id="folgaReqEnd" type="date" style="${fld}"></div>
        <div><label for="folgaReqTipo" style="${fldLbl};display:block;">Tipo</label><select id="folgaReqTipo" style="${fld}"><option value="atestado">Atestado</option><option value="dayoff">Day off</option></select></div>
        <div><label for="folgaReqObs" style="${fldLbl};display:block;">Motivo (opcional)</label><input id="folgaReqObs" type="text" maxlength="60" placeholder="Ex: consulta médica" style="${fld}"></div>
      </div>
      <button onclick="window.requestFolga()" style="width:100%;background:var(--orange);color:#fff;border:none;border-radius:8px;padding:9px 14px;font-weight:700;font-size:0.82rem;cursor:pointer;margin-bottom:18px;">Solicitar aprovação</button>
      ${pend.length ? `<div style="font-size:0.65rem;font-weight:800;color:var(--muted);text-transform:uppercase;margin-bottom:8px;">Aguardando aprovação</div>
        ${pend.map(r=>{const p=r.payload||{};return cardRow(chip('Pendente','#92400E','#FEF3C7'), p.label||FOLGA_TIPOS[p.tipo]||'Ausência', periodo(p.startIso,p.endIso,(p.isos||[]).length));}).join('')}` : ''}
      <div style="font-size:0.65rem;font-weight:800;color:var(--muted);text-transform:uppercase;margin:14px 0 8px;">Minhas ausências aprovadas</div>
      ${aprov.length ? aprov.map(r=>{const cor=FOLGA_CORES[r.type]||'#94A3B8';return cardRow(chip(FOLGA_TIPOS[r.type]||r.type,cor,cor+'22'), r.label||'Ausência', periodo(r.startIso,r.endIso,r.count));}).join('') : '<div style="text-align:center;color:var(--muted);font-size:0.76rem;padding:10px;">Nenhuma ausência aprovada ainda.</div>'}
    </div>`;
};

window.requestFolga = async () => {
  const meKey = state.currentCollabKey;
  if(!meKey){ showToast('Ops','Sua conta não está vinculada a um colaborador.'); return; }
  const startIso = document.getElementById('folgaReqStart')?.value;
  if(!startIso){ showToast('Data obrigatória','Selecione a data de início.'); return; }
  const endIso = document.getElementById('folgaReqEnd')?.value || startIso;
  if(endIso < startIso){ showToast('Datas invertidas','A data de fim não pode ser anterior à de início.'); return; }
  const isos = _isoRange(startIso, endIso);
  if(isos.length > 366){ showToast('Período muito longo','No máximo 366 dias por solicitação.'); return; }
  const tipo = document.getElementById('folgaReqTipo')?.value || 'atestado';
  const obs = (document.getElementById('folgaReqObs')?.value||'').trim().slice(0,60);
  const label = obs || FOLGA_TIPOS[tipo] || 'Ausência';
  const now = Date.now();
  const grp = `folgareq_${tipo}_${startIso}_${now}`;
  try {
    await push(approvalRequestsRef, {
      type:'folga',
      payload:{ tipo, label, isos, startIso, endIso, grp, collab: meKey },
      requestedBy: meKey, requestedByEmail: state.currentUser?.email||'', requestedAt: now, status:'pending'
    });
    showToast('✅ Solicitação enviada', isos.length>1 ? `${label}: ${isos.length} dias — aguardando aprovação da gestão.` : `${label} (${_fmtIsoBR(startIso)}) — aguardando aprovação da gestão.`);
    setTimeout(()=>window._openFolgaRequestModal(), 250);
  } catch(e){ showToast('Erro','Não foi possível enviar. Verifique sua conexão.'); console.error('[requestFolga]',e); }
};

// ── HELPERS — importados de js/utils.js ──────────────────────────────────────
// debounce, escH, sanitizeUrl, fmtDur, fmtTime, fmtDate, fmtShortDate
// dKey, dateKey, todayKey, getWeekDays, getMonthWeeks

// ── AUTOCOMPLETE DE TAREFAS ────────────────────────────────────────────────
function updateProjectColorDot(selectEl, dotId){
  const dot = document.getElementById(dotId);
  if(!dot) return;
  const proj = state.PROJECTS[selectEl.value];
  dot.style.background = proj?.color || '#94A3B8';
}

// ── Combobox de projeto do Timer (dropdown próprio, rolável e com busca) ───────
// #projectSearch (visível, NOME) + #projectComboList (lista) → #projectSelect (hidden, CHAVE).
// Substitui o <datalist>, que escondia opções quando já havia texto no campo
// ("não dava pra descer entre os projetos" em equipes com muitos projetos).
let _projComboActive = -1;  // índice destacado p/ navegação por teclado
function _projComboItems(){ return [...document.querySelectorAll('#projectComboList .proj-combo-opt')]; }
function _projComboOpen(open){
  const list = document.getElementById('projectComboList');
  const inp  = document.getElementById('projectSearch');
  if(!list) return;
  list.classList.toggle('open', open);
  inp?.setAttribute('aria-expanded', open ? 'true' : 'false');
  // Lista é position:fixed (não cortada pelo container .content rolável) → posiciona via JS
  if(open && inp) window._placePopover(list, inp);
  if(!open) _projComboActive = -1;
}
// Reconstrói a lista a partir de state.PROJECTS, filtrando por substring (case-insensitive).
window._renderProjectCombo = function(filter=''){
  const list = document.getElementById('projectComboList');
  if(!list) return;
  const f = String(filter||'').trim().toLowerCase();
  const items = Object.entries(state.PROJECTS||{})
    .map(([k,p])=>({ key:k, label:p.label||k, color:p.color||'#94A3B8' }))
    .filter(p => !f || p.label.toLowerCase().includes(f))
    .sort((a,b)=>a.label.localeCompare(b.label,'pt-BR'));
  _projComboActive = -1;
  if(!items.length){ list.innerHTML = '<div class="proj-combo-empty">Nenhum projeto encontrado</div>'; return; }
  list.innerHTML = items.map(p=>
    `<div class="proj-combo-opt" role="option" data-key="${escH(p.key)}">
       <span class="proj-combo-dot" style="background:${escH(p.color)}"></span>${escH(p.label)}
     </div>`).join('');
  // mousedown (não click) para selecionar antes do blur fechar a lista
  list.querySelectorAll('.proj-combo-opt').forEach(el=>{
    el.addEventListener('mousedown', e=>{ e.preventDefault(); _projComboPick(el.dataset.key); });
  });
};
function _projComboPick(key){
  const inp = document.getElementById('projectSearch');
  const hidden = document.getElementById('projectSelect');
  if(!inp || !hidden) return;
  const p = state.PROJECTS[key];
  hidden.value = key || '';
  inp.value = p ? p.label : '';
  updateProjectColorDot(hidden, 'projectColorDot');
  _projComboOpen(false);
  try { syncTimerDebounced(); } catch(e) {}
}
// Digitação: filtra a lista; só fixa a CHAVE se o texto bater exatamente com um nome.
window.onProjectSearchInput = function(){
  const inp = document.getElementById('projectSearch');
  const hidden = document.getElementById('projectSelect');
  if(!inp || !hidden) return;
  const txt = (inp.value||'').trim().toLowerCase();
  let key = '';
  for(const [k,p] of Object.entries(state.PROJECTS)){
    if((p.label||'').toLowerCase() === txt){ key = k; break; }
  }
  hidden.value = key;
  updateProjectColorDot(hidden, 'projectColorDot');
  _renderProjectCombo(inp.value);   // filtra pelo que foi digitado
  _projComboOpen(true);
};
// Reflete a chave atual (hidden) no campo visível — usado ao restaurar/sincronizar o timer.
window._syncProjectSearchFromHidden = function(){
  const inp = document.getElementById('projectSearch');
  const hidden = document.getElementById('projectSelect');
  if(!inp || !hidden) return;
  const p = state.PROJECTS[hidden.value];
  inp.value = p ? p.label : '';
  updateProjectColorDot(hidden, 'projectColorDot');
};
// Liga foco/teclado/clique-fora ao combobox (idempotente).
window._initProjectCombo = function(){
  const inp = document.getElementById('projectSearch');
  const list = document.getElementById('projectComboList');
  if(!inp || !list || inp._comboInit) return;
  inp._comboInit = true;
  // Move a lista para o <body>: como é position:fixed, dentro do card (ancestral posicionado)
  // ela ficava desalinhada/longe do campo. No body, o fixed referencia a viewport e alinha certo.
  document.body.appendChild(list);
  // Ao focar/clicar: mostra TODOS os projetos (não filtra pelo valor atual) e seleciona o texto
  const openAll = ()=>{ _renderProjectCombo(''); _projComboOpen(true); inp.select(); };
  inp.addEventListener('focus', openAll);
  inp.addEventListener('click', openAll);
  // BUG: faltava ligar o filtro ao digitar — sem isto a lista não busca/abre ao digitar
  inp.addEventListener('input', ()=>window.onProjectSearchInput?.());
  inp.addEventListener('keydown', e=>{
    const items = _projComboItems();
    if(e.key==='ArrowDown'){ e.preventDefault(); if(!list.classList.contains('open')) openAll();
      _projComboActive=Math.min(_projComboActive+1, items.length-1); }
    else if(e.key==='ArrowUp'){ e.preventDefault(); _projComboActive=Math.max(_projComboActive-1, 0); }
    else if(e.key==='Enter'){ if(_projComboActive>=0 && items[_projComboActive]){ e.preventDefault(); _projComboPick(items[_projComboActive].dataset.key); } }
    else if(e.key==='Escape'){ _projComboOpen(false); }
    else return;
    items.forEach((el,i)=>{ el.classList.toggle('active', i===_projComboActive); });
    if(items[_projComboActive]) items[_projComboActive].scrollIntoView({block:'nearest'});
  });
  // Clique fora fecha (lista agora vive no body, então também checa list.contains)
  document.addEventListener('mousedown', e=>{
    const combo = document.getElementById('projectCombo');
    if(combo && !combo.contains(e.target) && !list.contains(e.target)) _projComboOpen(false);
  });
  // Reposiciona a lista (fixed) ao rolar/redimensionar enquanto aberta, sem fechar
  const reposition = ()=>{ if(list.classList.contains('open')) window._placePopover(list, inp); };
  window.addEventListener('scroll', e=>{ if(e.target!==list && !list.contains(e.target)) reposition(); }, true);
  window.addEventListener('resize', reposition);
};

// Posiciona um popover fixed ancorado a um campo: abre para baixo e, se não couber,
// abre para cima; sempre limita a altura ao espaço disponível (lista rola por dentro).
window._placePopover = function(pop, anchor){
  if(!pop || !anchor) return;
  const r = anchor.getBoundingClientRect();
  const margin = 8;
  const spaceBelow = window.innerHeight - r.bottom - margin;
  const spaceAbove = r.top - margin;
  pop.style.left = r.left + 'px';
  pop.style.minWidth = r.width + 'px';
  if(spaceBelow < 200 && spaceAbove > spaceBelow){
    pop.style.top = '';
    pop.style.bottom = (window.innerHeight - r.top + 4) + 'px';
    pop.style.maxHeight = Math.max(140, Math.min(280, spaceAbove)) + 'px';
  } else {
    pop.style.bottom = '';
    pop.style.top = (r.bottom + 4) + 'px';
    pop.style.maxHeight = Math.max(140, Math.min(280, spaceBelow)) + 'px';
  }
};

// ── Combobox GENÉRICO: transforma um <select> nativo em campo digitável + lista rolável ──
// Mantém o <select> como fonte de verdade (value/onchange preservados). A lista é anexada
// ao <body> com position:fixed para NÃO ser cortada por modais com overflow, e rola por dentro.
// Intercepta o setter .value para ressincronizar o texto em mudanças programáticas.
window.enhanceSelectToCombo = function(sel){
  if(!sel || sel.tagName!=='SELECT' || sel._comboified) return;
  sel._comboified = true;

  const wrap = document.createElement('span');
  // Layout conforme o contexto: item flex (mProject), bloco em modal-field, ou filtro inline
  if(sel.style.flex){
    wrap.style.cssText = 'position:relative;display:block;flex:'+sel.style.flex+';min-width:0;';
  } else if(sel.classList.contains('modal-select')){
    wrap.style.cssText = 'position:relative;display:block;width:100%;';
  } else {
    const w = sel.style.minWidth || sel.style.width || '185px';
    wrap.style.cssText = 'position:relative;display:inline-block;vertical-align:middle;width:'+w+';';
  }
  sel.parentNode.insertBefore(wrap, sel);
  wrap.appendChild(sel);
  sel.style.display='none';
  sel.setAttribute('tabindex','-1');

  const input = document.createElement('input');
  input.type='text';
  input.className='combo-input';
  input.autocomplete='off';
  input.placeholder='Digite ou selecione…';
  input.setAttribute('role','combobox');
  input.setAttribute('aria-expanded','false');
  if(sel.id) input.setAttribute('aria-label', sel.previousElementSibling?.textContent?.trim() || 'Selecionar');
  wrap.appendChild(input);

  const pop = document.createElement('div');
  pop.className='combo-pop';
  document.body.appendChild(pop);

  let active=-1;
  const optList = ()=> [...sel.options].filter(o=>!o.disabled).map(o=>({value:o.value,label:(o.textContent||'').trim()}));
  const syncInput = ()=>{ const o=sel.options[sel.selectedIndex]; input.value = o ? (o.textContent||'').trim() : ''; };
  const close = ()=>{ pop.classList.remove('open'); active=-1; input.setAttribute('aria-expanded','false'); };
  const place = ()=>{ window._placePopover(pop, input); };
  const render = (filter='')=>{
    const f=String(filter||'').trim().toLowerCase();
    const items=optList().filter(o=>!f || o.label.toLowerCase().includes(f));
    active=-1;
    pop.innerHTML = items.length
      ? items.map(o=>`<div class="combo-opt" data-v="${escH(o.value)}">${escH(o.label)}</div>`).join('')
      : '<div class="combo-empty">Nenhum resultado</div>';
    pop.querySelectorAll('.combo-opt').forEach(el=>{
      el.addEventListener('mousedown', e=>{ e.preventDefault(); pick(el.dataset.v); });
    });
  };
  const open = ()=>{ render(''); place(); pop.classList.add('open'); input.setAttribute('aria-expanded','true'); input.select(); };
  const pick = (v)=>{ sel.value=v; sel.dispatchEvent(new Event('change',{bubbles:true})); syncInput(); close(); };

  input.addEventListener('focus', open);
  input.addEventListener('click', open);
  input.addEventListener('input', ()=>{ render(input.value); if(!pop.classList.contains('open')){ place(); pop.classList.add('open'); } });
  input.addEventListener('keydown', e=>{
    const its=[...pop.querySelectorAll('.combo-opt')];
    if(e.key==='ArrowDown'){ e.preventDefault(); if(!pop.classList.contains('open')) open(); active=Math.min(active+1,its.length-1); }
    else if(e.key==='ArrowUp'){ e.preventDefault(); active=Math.max(active-1,0); }
    else if(e.key==='Enter'){ if(active>=0&&its[active]){ e.preventDefault(); pick(its[active].dataset.v); } }
    else if(e.key==='Escape'){ close(); }
    else return;
    its.forEach((el,i)=>el.classList.toggle('active',i===active));
    if(its[active]) its[active].scrollIntoView({block:'nearest'});
  });
  // Ao sair do campo: confirma se o texto digitado casa exatamente com uma opção; senão reverte
  input.addEventListener('blur', ()=>{
    setTimeout(()=>{
      if(pop.classList.contains('open')) return;   // ainda escolhendo
      const typed = input.value.trim().toLowerCase();
      const match = optList().find(o=>o.label.toLowerCase()===typed);
      if(match && sel.value!==match.value){ sel.value=match.value; sel.dispatchEvent(new Event('change',{bubbles:true})); }
      syncInput();
    }, 150);
  });
  // Fecha ao clicar fora, ou ao rolar a PÁGINA (mas não ao rolar a própria lista)
  document.addEventListener('mousedown', e=>{ if(!wrap.contains(e.target) && !pop.contains(e.target)) close(); });
  window.addEventListener('scroll', e=>{ if(pop.classList.contains('open') && e.target!==pop && !pop.contains(e.target)) close(); }, true);
  window.addEventListener('resize', ()=>{ if(pop.classList.contains('open')) close(); });

  // Re-sincroniza o texto quando as opções mudam (repopulação) ou o valor muda por código
  sel.addEventListener('change', syncInput);
  new MutationObserver(()=>syncInput()).observe(sel,{childList:true});
  try {
    const desc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value');
    Object.defineProperty(sel,'value',{
      configurable:true,
      get(){ return desc.get.call(sel); },
      set(v){ desc.set.call(sel, v); syncInput(); }
    });
  } catch(e) {}
  syncInput();
};

function _updateApprovalBadge(){
  if(!state.isManager) return;
  const pending = Object.values(state.allApprovals).filter(r => r.status === 'pending').length;
  const badge = document.getElementById('approvalNavBadge');
  if(!badge) return;
  if(pending > 0){
    badge.textContent = pending > 9 ? '9+' : pending;
    badge.style.display = 'inline-flex';
  } else {
    badge.style.display = 'none';
  }
}

function _updateTaskSuggestions(){
  const dl = document.getElementById('taskSuggestions');
  if(!dl) return;
  const collab = state.currentCollabKey;
  const seen = new Set();
  const recent = Object.values(state.allEntries)
    .filter(e => e.collab === collab && e.task)
    .sort((a,b) => b.startTime - a.startTime);
  const suggestions = [];
  for(const e of recent){
    const t = e.task.trim();
    if(t && !seen.has(t)){ seen.add(t); suggestions.push(t); }
    if(suggestions.length >= 20) break;
  }
  dl.innerHTML = suggestions.map(t => `<option value="${escH(t)}">`).join('');
}

// ICONS → js/icons.js

// dKey, dateKey, todayKey → js/utils.js
// calcAmount → js/dashboard.js

// _DOW_KEY → js/dashboard.js

// getDailyGoalMs → js/dashboard.js
// _getSecondaryAuth → js/firebase-refs.js

// getEntriesArray → js/dashboard.js
// getEntriesForDay → js/dashboard.js
// calcDay → js/dashboard.js
// getWeekDays → js/utils.js

// setSyncStatus → js/ui.js

// ── NOTIFICATIONS ────────────────────────────────────────────────────────────
// ── Constantes do timer ───────────────────────────────────────────────────────

// ── Contexto injetado via initTimer ──────────────────────────────────────────
// ── resetNoActivityTimer ──────────────────────────────────────────────────────
// resetNoActivityTimer → js/timer.js
// toggleTimer → js/timer.js
// startTimer → js/timer.js
// stopTimer → js/timer.js
// restoreTimerFromFirebase → js/timer.js
// syncActiveTimerFields → js/timer.js
// syncTimerDebounced → js/timer.js

// checkRetroActiveStop → js/timer.js
// scheduleAutoStop → js/timer.js
// Notification.requestPermission → js/timer.js

// showToast → js/ui.js

// ── TAGS ─────────────────────────────────────────────────────────────────────
window.toggleTag = el => el.classList.toggle('selected');
function getSelectedTags(container){return[...container.querySelectorAll('.tag-chip.selected')].map(el=>el.textContent.trim());}
function clearTags(container){container.querySelectorAll('.tag-chip').forEach(el=>el.classList.remove('selected'));}
function setTags(container,tags){container.querySelectorAll('.tag-chip').forEach(el=>el.classList.toggle('selected',(tags||[]).includes(el.textContent.trim())));}

// ── CUSTOM TAGS & state.PROJECTS (Firebase) ────────────────────────────────────────

// state.customTags e state.customProjects são inicializados em startDataListeners() após auth

function refreshCustomTagsUI(){
  // Atualiza chips de tag no timer e no modal com as tags customizadas
  ['timerTags','mTagsContainer'].forEach(containerId => {
    const container = document.getElementById(containerId);
    if(!container) return;
    // Remove chips customizados anteriores para re-inserir atualizados
    container.querySelectorAll('.tag-chip.custom').forEach(el => el.remove());
    state.customTags.forEach(tag => {
      if(!tag) return;
      const chip = document.createElement('span');
      chip.className = 'tag-chip custom';
      chip.textContent = tag;
      chip.onclick = () => chip.classList.toggle('selected');
      chip.title = 'Tag personalizada';
      container.appendChild(chip);
    });
  });
}

function refreshCustomProjectsUI(){
  // Garante que projetos personalizados estão em state.PROJECTS (cálculos + datalist do timer)
  state.customProjects.forEach(proj => {
    if(proj && proj.key && !state.PROJECTS[proj.key]){
      state.PROJECTS[proj.key] = { label: proj.label, color: proj.color || '#94A3B8', amountPerHour: proj.amountPerHour || 0 };
    }
  });
  // Timer: combobox próprio reconstruído a partir de state.PROJECTS
  if(document.getElementById('projectComboList')) _refreshProjectSelects();
  // Modal de edição (mProject) continua <select>, com separador e ícone ＋ p/ customizados
  const select = document.getElementById('mProject');
  if(!select || !state.customProjects.length) return;
  const currentVal = select.value;
  select.querySelectorAll('option.custom-proj, option.custom-sep').forEach(o => o.remove());
  const separator = document.createElement('option');
  separator.disabled = true;
  separator.className = 'custom-sep';
  separator.textContent = '──────────────────';
  select.appendChild(separator);
  state.customProjects.forEach(proj => {
    if(!proj || !proj.key) return;
    const opt = document.createElement('option');
    opt.value = proj.key;
    opt.textContent = '＋ ' + proj.label;  // ícone ＋ distingue projetos customizados
    opt.className = 'custom-proj';
    select.appendChild(opt);
  });
  if(currentVal && select.querySelector(`option[value="${currentVal}"]`)) select.value = currentVal;
}

// Cria nova tag personalizada — salva no Firebase e sincroniza para toda equipe
window.openAddTagModal = () => {
  const name = prompt('Nome da nova tag:');
  if(!name || !name.trim()) return;
  const tag = name.trim();
  const defaultTags = [...document.querySelectorAll('#timerTags .tag-chip:not(.custom)')].map(el => el.textContent.trim());
  if(defaultTags.includes(tag) || state.customTags.includes(tag)){
    showToast('Tag já existe', `"${tag}" já está na lista.`);
    return;
  }
  const newList = [...state.customTags, tag];
  set(customTagsRef, newList)
    .then(() => showToast('✅ Tag criada', `"${tag}" já aparece para toda a equipe.`))
    .catch(() => showToast('Erro', 'Não foi possível salvar a tag.'));
};

// ── GERENCIAR TAGS — só gestora ───────────────────────────────────────────────
window.openManageTagsModal = () => {
  if(!state.isManager){ showToast('Sem permissão','Apenas a gestora pode gerenciar tags.'); return; }

  const defaultTags = [...document.querySelectorAll('#timerTags .tag-chip:not(.custom)')].map(el => el.textContent.trim());
  const allTags = [...defaultTags.map(t=>({label:t,isDefault:true})), ...state.customTags.map(t=>({label:t,isDefault:false}))];

  // Cria modal de gerenciamento
  let mgr = document.getElementById('manageTagsModal');
  if(!mgr){
    mgr = document.createElement('div');
    mgr.id = 'manageTagsModal';
    mgr.setAttribute('role','dialog');
    mgr.setAttribute('aria-modal','true');
    mgr.setAttribute('aria-label','Gerenciar Tags');
    mgr.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.35);z-index:1300;display:flex;align-items:center;justify-content:center;';
    mgr.onclick = (e)=>{ if(e.target===mgr) mgr.remove(); };
    document.body.appendChild(mgr);
  }

  mgr.innerHTML = `
    <div style="background:var(--surface);border-radius:16px;padding:24px;width:420px;max-width:95vw;max-height:80vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,0.18);">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
        <div style="font-size:1rem;font-weight:800;">🏷 Gerenciar Tags</div>
        <button onclick="document.getElementById('manageTagsModal').remove()" aria-label="Fechar" style="background:none;border:none;font-size:1.1rem;cursor:pointer;color:var(--muted);"><span aria-hidden="true">✕</span></button>
      </div>
      <div style="font-size:0.75rem;color:var(--muted);margin-bottom:14px;">Tags padrão não podem ser removidas. Tags personalizadas podem ser excluídas.</div>
      <div id="mgrTagsList">
        ${allTags.map(({label,isDefault})=>`
          <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:var(--surface2);border-radius:8px;margin-bottom:6px;">
            <span style="font-size:0.82rem;font-weight:600;">${escH(label)}</span>
            <div style="display:flex;align-items:center;gap:8px;">
              ${isDefault
                ? '<span style="font-size:0.68rem;color:var(--muted);background:var(--border);padding:2px 8px;border-radius:100px;">Padrão</span>'
                : `<button onclick="window._deleteTag('${escH(label)}')" style="background:none;border:1.5px solid var(--danger,#EF4444);color:var(--danger,#EF4444);border-radius:6px;padding:3px 10px;font-size:0.72rem;font-weight:700;cursor:pointer;">🗑 Remover</button>`
              }
            </div>
          </div>`).join('')}
      </div>
    </div>`;
};

window._deleteTag = async (tag) => {
  if(!state.isManager) return;
  if(!confirm(`Remover a tag "${tag}"? Ela será removida da lista da equipe.`)) return;
  const newList = state.customTags.filter(t => t !== tag);
  try {
    await set(customTagsRef, newList.length ? newList : null);
    showToast('Tag removida', `"${tag}" foi removida.`);
    // Re-renderiza o modal com a lista atualizada
    setTimeout(()=>openManageTagsModal(), 300);
  } catch(e) {
    showToast('Erro','Não foi possível remover a tag.');
    console.error(e);
  }
};

// Cria novo projeto personalizado — aparece no select com ícone ＋
window.openAddProjectModal = () => {
  const label = prompt('Nome do novo projeto:');
  if(!label || !label.trim()) return;
  const key = 'custom_' + label.trim().toLowerCase().replace(/[^a-z0-9]/g,'_').replace(/__+/g,'_');
  // Checa duplicatas
  const defaultKeys = Object.keys(state.PROJECTS);
  if(defaultKeys.includes(key) || state.customProjects.some(p => p.key === key || p.label.toLowerCase() === label.trim().toLowerCase())){
    showToast('Projeto já existe', `"${label.trim()}" já está na lista.`);
    return;
  }
  const newProj = { key, label: label.trim(), color: '#94A3B8', amountPerHour: 0 };
  const newList = [...state.customProjects, newProj];
  // Registra em memória imediatamente para cálculos
  state.PROJECTS[key] = newProj;
  set(customProjectsRef, newList)
    .then(() => showToast('✅ Projeto criado', `"${label.trim()}" já aparece no seletor.`))
    .catch(() => showToast('Erro', 'Não foi possível salvar o projeto.'));
};

// ── DUPLICAR REGISTRO ────────────────────────────────────────────────────────
// duplicateEntry removido — reiniciar demanda substitui essa função


// ── COLLAB AVATAR ────────────────────────────────────────────────────────────
window.updateCollabAvatar = ()=>{
  const v=document.getElementById('collabSelect').value, c=state.COLLABS[v];if(!c)return;
  const av=document.getElementById('collabAvatar');av.textContent=c.initials;av.style.background=c.color;
};

// ── DATE NAV ─────────────────────────────────────────────────────────────────
window.changeDay = d=>{state.viewDate=new Date(state.viewDate.getTime()+d*MS_PER_DAY);updateDateNav();renderCurrentPage();};
window.goToday = ()=>{state.viewDate=new Date();state.viewDate.setHours(0,0,0,0);updateDateNav();renderCurrentPage();};
// updateDateNav → js/dashboard.js
window.changeDashDay = d=>{state.dashDay=new Date(state.dashDay.getTime()+d*MS_PER_DAY);updateDashDayLabel();renderDashboard();};
window.goDashToday = ()=>{state.dashDay=new Date();state.dashDay.setHours(0,0,0,0);updateDashDayLabel();renderDashboard();};
window.setDashDay = val=>{if(!val)return;const[y,m,d]=val.split('-').map(Number);state.dashDay=new Date(y,m-1,d);updateDashDayLabel();renderDashboard();};
// updateDashDayLabel → js/dashboard.js
window.changeWeek = d=>{
  state.weekOffset+=d;updateWeekLabel();renderWeekTable();window._refreshActiveDashTable?.();
  if(document.getElementById('page-dashboard')?.classList.contains('active')) try{renderDashDemandasWeek();}catch(e){}
};
window.goCurrentWeek = ()=>{
  state.weekOffset=0;updateWeekLabel();renderWeekTable();window._refreshActiveDashTable?.();
  if(document.getElementById('page-dashboard')?.classList.contains('active')) try{renderDashDemandasWeek();}catch(e){}
};
window.setWeekFromDate = val=>{
  if(!val)return;
  const[y,m,d]=val.split('-').map(Number);
  const picked=new Date(y,m-1,d);picked.setHours(0,0,0,0);
  const today=new Date();today.setHours(0,0,0,0);
  const todayMon=new Date(today);const td=today.getDay();todayMon.setDate(today.getDate()-(td===0?6:td-1));
  const pickedMon=new Date(picked);const pd=picked.getDay();pickedMon.setDate(picked.getDate()-(pd===0?6:pd-1));
  state.weekOffset=Math.round((pickedMon-todayMon)/MS_PER_WEEK);
  updateWeekLabel();renderWeekTable();window._refreshActiveDashTable?.();
  const pk=document.getElementById('weekPicker');if(pk)pk.value=pickedMon.toISOString().slice(0,10);
};
// updateWeekLabel → js/dashboard.js
window.changeProjDay = d=>{state.projDate=new Date(state.projDate.getTime()+d*MS_PER_DAY);renderProjCards();};
window.goProjToday = ()=>{state.projDate=new Date();state.projDate.setHours(0,0,0,0);renderProjCards();};

// ── TIMER ────────────────────────────────────────────────────────────────────
// ✅ Race condition: flag previne cliques duplos
// // → js/timer.js


// → js/timer.js
// → js/timer.js


// ── ENTRY DETAIL DRAWER ───────────────────────────────────────────────────────
// Exibe o histórico completo de uma entrada: períodos, edições, autores
// openEntryDetail → js/entries.js
;

// closeEntryDetail → js/entries.js
;

// ── AUTORIZAÇÃO CLIENT-SIDE ──────────────────────────────────────────────────
// assertCanWrite → js/entries.js
// openModal → js/entries.js
;

// ── HELPERS DE EDIÇÃO DE PERÍODOS ────────────────────────────────────────────
window._updatePeriodDuration = (idx)=>{
  const wrap=document.getElementById('mPeriodsWrap');
  if(!wrap) return;
  const ds=wrap.querySelector(`.period-date-start[data-idx="${idx}"]`)?.value;
  const ts=wrap.querySelector(`.period-time-start[data-idx="${idx}"]`)?.value;
  const de=wrap.querySelector(`.period-date-end[data-idx="${idx}"]`)?.value;
  const te=wrap.querySelector(`.period-time-end[data-idx="${idx}"]`)?.value;
  if(!ds||!ts||!de||!te) return;
  const [sy,sm,sd]=ds.split('-').map(Number);
  const [sh2,smin]=ts.split(':').map(Number);
  const [ey,em2,ed]=de.split('-').map(Number);
  const [eh2,emin]=te.split(':').map(Number);
  const sTs=new Date(sy,sm-1,sd,sh2,smin).getTime();
  const eTs=new Date(ey,em2-1,ed,eh2,emin).getTime();
  const dur=Math.max(0,eTs-sTs);
  const durEl=wrap.querySelector(`.period-dur-display[data-idx="${idx}"]`);
  if(durEl) durEl.textContent=fmtDur(dur);
};

window._removePeriod = (idx)=>{
  if(!state.editingId||!state.allEntries[state.editingId]) return;
  // ✅ INTEGRIDADE: opera em cópia — não muta state.allEntries antes de confirmar no Firebase
  const orig=state.allEntries[state.editingId];
  const periods=[...(orig.periods||[])];
  if(periods.length<=1){showToast('Não permitido','A entrada deve ter pelo menos 1 período.');return;}
  if(!confirm('Remover este período?')) return;
  const newPeriods=periods.filter((_,i)=>i!==idx);
  const totalDuration=newPeriods.reduce((s,p)=>s+(p.duration||(p.endTime-p.startTime)),0);
  // Guarda draft temporário para o modal — state.allEntries NÃO é alterado aqui
  window._periodDraft={
    ...orig,
    periods:newPeriods,
    startTime:newPeriods[0].startTime,
    endTime:newPeriods[newPeriods.length-1].endTime,
    duration:totalDuration
  };
  // Abre o modal usando o draft; saveModal persiste no Firebase ao salvar
  _openModalWithDraft(state.editingId, window._periodDraft);
};

// Abre o modal preenchido com um draft local (sem alterar state.allEntries)
// _openModalWithDraft → js/entries.js
// closeModal → js/entries.js
;
// saveModal → js/entries.js
;
document.getElementById('modalOverlay').addEventListener('click',e=>{if(e.target===e.currentTarget)closeModal();});

// ── DELETE / CLEAR ────────────────────────────────────────────────────────────
// deleteEntry → js/entries.js
;
// clearDay → js/entries.js
;

// ── RESTORE TIMER APÓS RELOAD ─────────────────────────────────────────────────
// → js/timer.js

// ── SYNC CAMPOS DO TIMER EM TEMPO REAL ───────────────────────────────────────
// → js/timer.js
// syncTimerDebounced → js/timer.js
document.addEventListener('DOMContentLoaded',()=>{
  ['taskInput','obsInput'].forEach(id=>{
    document.getElementById(id)?.addEventListener('input',syncTimerDebounced);
  });
  document.getElementById('projectSearch')?.addEventListener('input',syncTimerDebounced);
  window._initProjectCombo?.();   // dropdown próprio do seletor de projeto (rolável + busca)
  // Converte os <select> (registro manual, card do Kanban e filtros) em comboboxes digitáveis/roláveis
  ['mProject','mCollab','kcColumn','kcModule','collabSelect','archChoiceModSelect',
   'kanbanFilterCollab','kanbanFilterType',
   'filterCollabD','filterProjD','dashDemandasCollab',
   'arquivoModFilter','arquivoCollabFilter','arquivoTypeFilter',
   'indMesFilter','indColabFilter','indTipoFilter'].forEach(id=>{
    const el = document.getElementById(id);
    if(el) window.enhanceSelectToCombo?.(el);
  });
  // E1: itens de menu são <div onclick> — torna-os focáveis e ativáveis por teclado
  document.querySelectorAll('.nav-item').forEach(el=>{
    if(!el.hasAttribute('tabindex')) el.setAttribute('tabindex','0');
    if(!el.hasAttribute('role'))     el.setAttribute('role','button');
    el.addEventListener('keydown', e=>{
      if(e.key==='Enter' || e.key===' '){ e.preventDefault(); el.click(); }
    });
  });
  // E1+: opções de avatar/cor (Personalizar Perfil) também acessíveis por teclado
  document.querySelectorAll('.avatar-opt, .color-opt').forEach(el=>{
    if(!el.hasAttribute('tabindex')) el.setAttribute('tabindex','0');
    if(!el.hasAttribute('role'))     el.setAttribute('role','button');
    if(!el.hasAttribute('aria-label')){
      const m = el.getAttribute('onclick')?.match(/'(#[0-9a-fA-F]{3,8})'/);
      if(m) el.setAttribute('aria-label','Cor '+m[1]);
    }
    el.addEventListener('keydown', e=>{
      if(e.key==='Enter' || e.key===' '){ e.preventDefault(); el.click(); }
    });
  });
});

// ── ALL FIREBASE LISTENERS ─────────────────────────────────────────────────────
// activeTimers listener consolidado em startDataListeners() acima

// ── RENDER CURRENT PAGE ───────────────────────────────────────────────────────
// renderCurrentPage, renderDebounced → js/ui.js (inicializados via initUI abaixo)

function renderPage(id){
  invalidateCalcDay();   // nova visualização: calcDay fresco (cobre edições de config off-dashboard)
  switch(id){
    case 'timer': renderTimerPage();break;
    case 'meuhistorico': renderMyHistory();break;
    case 'dashboard': updateDashDayLabel();updateWeekLabel();renderDashboard();break;
    case 'online': renderOnline();break;
    case 'demandas': renderDemandas();break;
    case 'projetos': renderProjCards();break;
    case 'graficos': renderCharts();break;
    case 'meu-dashboard': renderMeuDashboard();break;
    case 'historico4s': render4Weeks();break;
    case 'inconsistencias': renderInconsistencias();break;
    case 'relatorio': renderRelatorio(); break;
  case 'indicadores': if(typeof window.renderIndicadores === 'function') window.renderIndicadores(); break;
    case 'importar': break;
    case 'usuarios': renderUsuarios(); if(state.isManager) renderApprovals(); break;
    case 'kanban': renderKanban();break;
    case 'ferramentas': _renderFerramentasHub(); break;
    case 'arquivo': _initArquivoFilters(); window.renderArquivo?.(); break;
  }
}

// ── PAGE: FERRAMENTAS HUB ─────────────────────────────────────────────────────
function _initArquivoFilters(){
  const sel = document.getElementById('arquivoModFilter');
  if(sel && state.MODS?.length && sel.options.length <= 1){
    state.MODS.forEach(m=>{ const o=document.createElement('option'); o.value=m.id; o.textContent=m.label; sel.appendChild(o); });
  }
  const cs = document.getElementById('arquivoCollabFilter');
  if(cs && Object.keys(state.COLLABS).length && cs.options.length <= 1){
    Object.entries(state.COLLABS).forEach(([k,c])=>{ const o=document.createElement('option'); o.value=k; o.textContent=c.label; cs.appendChild(o); });
  }
}

function _renderFerramentasHub(){
  const pending = Object.values(state.allApprovals||{}).filter(r=>r.status==='pending').length;
  const badge = document.getElementById('ferrAprovBadge');
  if(badge){ badge.textContent = pending||''; badge.style.display = pending>0?'inline':'none'; }
  // Mostra/oculta card de aprovações (só gestora)
  const aprovCard = document.getElementById('ferrAprovacoes');
  if(aprovCard) aprovCard.style.display = state.isManager ? '' : 'none';
}

// ── PAGE: TIMER ───────────────────────────────────────────────────────────────
function renderTimerPage(){
  // V2: campo de projeto digitável — reconstrói o datalist a partir de state.PROJECTS
  if(Object.keys(state.PROJECTS).length) _refreshProjectSelects();

  const dk=dKey(state.viewDate);
  const filter=state.currentCollabKey;
  const allDay=getEntriesForDay(dk,filter);
  const allUserEntries = getEntriesArray()
    .filter(([,e])=>e.collab===state.currentCollabKey)
    .map(([k,e])=>({...e,_key:k}))
    .sort((a,b)=>{
      // Ordena pela atividade mais recente: reiniciadas sobem ao topo
      const ta = Math.max(a.modifiedAt||0, a.endTime||0);
      const tb = Math.max(b.modifiedAt||0, b.endTime||0);
      return tb - ta;
    })
    .slice(0,5);
  // ✅ FIX: usa _dayDuration para contar só o tempo do dia, não o total da entrada
  const totalMs=allDay.reduce((s,e)=>s+(e._dayDuration??e.duration),0);
  const h=Math.floor(totalMs/3600000),m=Math.floor((totalMs%3600000)/60000);
  document.getElementById('statToday').textContent=`${h}h ${String(m).padStart(2,'0')}m`;
  document.getElementById('statCount').textContent=allDay.length;
  if(allDay.length){const last=allDay.reduce((a,b)=>b.endTime>a.endTime?b:a);document.getElementById('statLast').textContent=fmtTime(last.endTime);}
  else document.getElementById('statLast').textContent='—';
  const conquDiv=document.getElementById('minhasConquistas');
  if(conquDiv){const cq=getConquistas(state.currentCollabKey);conquDiv.innerHTML=cq.length?cq.map(c=>`<span class="conquista-badge ${c.cls}" style="font-size:0.72rem;padding:4px 10px;">${c.icon} ${c.label}</span>`).join(''):'';}
  document.getElementById('entriesTitle').textContent='Últimos 5 registros';
  // Skeleton enquanto dados ainda não chegaram do Firebase
  if(!Object.keys(state.allEntries).length){
    const el=document.getElementById('entriesList');
    if(el) el.innerHTML=skeletonEntries(3);
  } else {
    renderEntriesList('entriesList',allUserEntries);
  }
}

// ── PAGE: MEU HISTÓRICO ───────────────────────────────────────────────────────
// ── PAGE RENDERS (renderMyHistory…renderInconsistencias) → js/demandas.js ─────

// ── MURAL + DESAFIO → js/demandas.js ──────────────────────────────────────────
document.getElementById('desafioOverlay')?.addEventListener('click',e=>{if(e.target===e.currentTarget)closeDesafioModal();});

if(state.isManager){
  const editBtn = document.getElementById('desafioEditBtn');
  if(editBtn) editBtn.style.display='block';
}

// ── CONQUISTAS AUTOMÁTICAS ────────────────────────────────────────────────────
// renderConquistasBadges → js/dashboard.js
// ── IMPORTADORES (CSV, Trello, Avaliações) → js/importadores.js ────────────────

// ── RELATÓRIO ─────────────────────────────────────────────────────────────────
// ── RELATÓRIO SEMANAL (KRN-063) ───────────────────────────────────────────────

// ── RELATÓRIO (relChangeWeek … renderRelatorio) → js/demandas.js ───────────────

window.relGerarResumo = (prodRows, finalizadas, emAndamento, totalPDF, totalHTML, days)=>{
  // Permite chamar sem parâmetros (botão Regenerar)
  if(!prodRows){
    renderRelatorio();
    return;
  }
  const fmtDate = d => d.toLocaleDateString('pt-BR',{day:'2-digit',month:'long',year:'numeric'});
  const semStr = `${fmtDate(days[0])} a ${fmtDate(days[5])}`;

  // Colaboradores com mais disciplinas na semana
  const collabCount = {};
  prodRows.forEach(r=>{ collabCount[r.collab]=(collabCount[r.collab]||0)+1; });
  const collabRank = Object.entries(collabCount).sort((a,b)=>b[1]-a[1]);
  const collabTexto = collabRank.map(([nome,qtd])=>`${nome} (${qtd})`).join(', ');

  const total = totalPDF + totalHTML;

  let resumo = `RELATÓRIO SEMANAL DE PRODUÇÃO\n`;
  resumo += `Período de referência: ${semStr}\n\n`;
  resumo += `PRODUÇÃO\n`;
  resumo += `No período analisado, foram registradas ${prodRows.length} disciplina${prodRows.length!==1?'s':''} em produção, `;
  resumo += `das quais ${finalizadas} encontram-se finalizadas e ${emAndamento} em andamento.\n`;
  if(collabRank.length){
    resumo += `A produção foi distribuída entre os seguintes colaboradores: ${collabTexto}.\n`;
  }
  resumo += `\nDEMANDAS REALIZADAS\n`;
  resumo += `Foram realizadas ${total} demanda${total!==1?'s':''} no período, sendo ${totalPDF} em formato PDF e ${totalHTML} em formato HTML.\n`;

  if(finalizadas === prodRows.length && prodRows.length > 0){
    resumo += `\nTodas as disciplinas registradas na semana foram concluídas dentro do prazo.`;
  } else if(emAndamento > 0){
    resumo += `\nAs disciplinas em andamento seguem em acompanhamento para conclusão nas próximas semanas.`;
  }

  const el = document.getElementById('relResumoText');
  if(el) el.value = resumo;
};

window.generateSummary = ()=>renderRelatorio();
window.copySummary     = ()=>{ const t=document.getElementById('summaryText'); if(t) navigator.clipboard.writeText(t.textContent).then(()=>showToast('Copiado!','Texto copiado.')); };
window.exportPDF       = ()=>window.print();


// ── RESTART ENTRY ────────────────────────────────────────────────────────────
window.restartEntry = (key)=>{
  if(state.isRunning){ showToast('Timer ativo','Pare o timer atual antes de reiniciar uma tarefa.'); return; }
  const entry = state.allEntries[key];
  if(!entry) return;
  document.getElementById('taskInput').value = entry.task||'';
  document.getElementById('projectSelect').value = entry.project||'gestao';
  window._syncProjectSearchFromHidden?.();
  if(state.isManager){
    const cs = document.getElementById('collabSelect');
    if(cs) cs.value = entry.collab||state.currentCollabKey;
  }
  if(entry.obs) document.getElementById('obsInput').value = entry.obs||'';
  clearTags(document.getElementById('timerTags'));
  setTags(document.getElementById('timerTags'), entry.tags||[]);
  window._restartingFromKey = key;
  startTimer();
  showToast('Tarefa reiniciada',`"${(entry.task||'').slice(0,30)}" — timer iniciado!`);
};

// ── EXPORT CSV ────────────────────────────────────────────────────────────────
window.exportCSV = ()=>{
  const dk=dKey(state.viewDate);
  const filter=state.isManager?null:state.currentCollabKey;
  const rows=getEntriesForDay(dk,filter);
  if(!rows.length){alert('Nenhum registro neste dia.');return;}
  const header='Data,Colaborador,Tarefa,Projeto,Início,Fim,Duração(h),% Tempo,% Amount,% Total,Tags,Observação';
  const lines=rows.map(e=>{
    const proj=state.PROJECTS[e.project]||{label:e.project};const col=state.COLLABS[e.collab]||{label:e.collab};
    const durH=(e.duration/3600000).toFixed(4);const dayGoal=getDailyGoalMs(dk)||state.DAILY_GOAL_MS;const pt=(e.duration/dayGoal*100).toFixed(2);
    const pa=calcAmount(e.project,e.duration,e.peso).toFixed(2);const tot=(+pt+ +pa).toFixed(2);
    return[new Date(e.startTime).toLocaleDateString('pt-BR'),col.label,`"${(e.task||'').replace(/"/g,'""')}"`,proj.label,fmtTime(e.startTime),fmtTime(e.endTime),durH,pt+'%',pa+'%',tot+'%',`"${(e.tags||[]).join('; ')}"`,`"${(e.obs||'').replace(/"/g,'""')}"`].join(',');
  });
  dlCSV([header,...lines].join('\n'),`kronos_${state.viewDate.toISOString().slice(0,10)}.csv`);
};

// Exporta a grade semanal em SpreadsheetML com extensão .xls — abre direto no Excel
// como planilha (a instrução <?mso-application?> reforça a associação com o Excel).
window.exportWeekExcel = ()=>{
  const days=getWeekDays(state.weekOffset);
  const _x = s => String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
  const cell  = (v,t)=>`<Cell><Data ss:Type="${t}">${_x(v)}</Data></Cell>`;
  const hcell = v   =>`<Cell ss:StyleID="hdr"><Data ss:Type="String">${_x(v)}</Data></Cell>`;
  const headers=['Colaborador','Data','% Tempo','% Amount','% Total','Horas'];
  const dataRows=[];
  // Mesmo recorte da tabela semanal na tela: só ativos
  Object.keys(state.COLLABS).filter(k=>isActive(k)).forEach(k=>{days.forEach(d=>{
    const r=calcDay(k,dKey(d));
    const h=Math.floor(r.totalMs/3600000),m=Math.floor((r.totalMs%3600000)/60000);
    dataRows.push('<Row>'+
      cell(state.COLLABS[k].label,'String')+
      cell(d.toLocaleDateString('pt-BR'),'String')+
      cell(r.percTime.toFixed(2),'Number')+
      cell(r.percAmount.toFixed(2),'Number')+
      cell(r.percTotal.toFixed(2),'Number')+
      cell(`${h}h${String(m).padStart(2,'0')}m`,'String')+
    '</Row>');
  });});
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:html="http://www.w3.org/TR/REC-html40">
 <Styles><Style ss:ID="hdr"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#F15A24" ss:Pattern="Solid"/><Alignment ss:Horizontal="Center"/></Style></Styles>
 <Worksheet ss:Name="Semana">
  <Table>
   <Row>${headers.map(hcell).join('')}</Row>
   ${dataRows.join('\n   ')}
  </Table>
 </Worksheet>
</Workbook>`;
  const blob=new Blob([xml],{type:'application/vnd.ms-excel;charset=utf-8;'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=`kronos_semana_${new Date().toISOString().slice(0,10)}.xls`;a.click();URL.revokeObjectURL(url);
};

// ── USER MANAGEMENT (renderUsuarios … dlCSV) → js/usuarios.js ──────────────────
// ── NAV ───────────────────────────────────────────────────────────────────────
// showPage → js/ui.js (registrado via initUI)
window.showPage = showPage;
patchShowPageForConfig(showPage);

function updateCollabSelects(){
  const selects = ['collabSelect','mCollab'];
  selects.forEach(id=>{
    const sel = document.getElementById(id);
    if(!sel) return;
    [...sel.options].forEach(opt=>{
      if(state.KANBAN_ROLES.gestora.includes(opt.value)) return;
      opt.hidden = !isActive(opt.value);
    });
  });
}

// ── KANBAN ────────────────────────────────────────────────────────────────────

// state.K_COLS é carregado dinamicamente pelo bootV2 — declarado como let no topo do arquivo
// Valores default definidos em _initDefaultConfig()

// ── KANBAN (K_TIMER_COLS … renderKanban) → js/kanban.js ──────────

// ── CFG (renderCfgColaboradores … renderCfgColunas) → js/config.js ─────────────────


// ── INIT ──────────────────────────────────────────────────────────────────────
initUI({ renderPage });
enhanceA11y();   // Bloco A: semântica de teclado nos divs-botão (nav, ferramentas…)

// Registra funções auxiliares no timer.js (evita import circular)
initTimer({ getSelectedTags, clearTags, setTags, assertCanWrite });

// Registra contexto no entries.js
initEntries({ getSelectedTags, clearTags, setTags, getEntriesForDay, calcAmount, getCollabAvatar, updateProjectColorDot, _updateTaskSuggestions, _refreshKanbanTypeFilter, renderTimerPage });

window.toggleTimer       = toggleTimer;
window.openEntryDetail   = openEntryDetail;
window.closeEntryDetail  = closeEntryDetail;
window.openModal         = openModal;
window.closeModal        = closeModal;
window.saveModal         = saveModal;
window.deleteEntry       = deleteEntry;
window.clearDay          = clearDay;
window.renderCurrentPage = renderDebounced;
// Funções de tags usadas pelo kanban.js
window.clearTags         = clearTags;
window.setTags           = setTags;
window.getSelectedTags   = getSelectedTags;
document.getElementById('taskInput').addEventListener('keydown',e=>{if(e.key==='Enter')toggleTimer();});

// ── ATALHOS DE TECLADO GLOBAIS ────────────────────────────────────────────
document.addEventListener('keydown', e => {
  // Alt+T — iniciar/parar timer (não dispara se foco está em input/textarea)
  if(e.altKey && e.key === 't'){
    const tag = document.activeElement?.tagName?.toLowerCase();
    if(tag === 'input' || tag === 'textarea' || tag === 'select') return;
    e.preventDefault();
    // Navega para a página do timer se não estiver nela
    if(!document.getElementById('page-timer')?.classList.contains('active')){
      showPage('timer', document.querySelector('[onclick*="timer"]'));
    }
    toggleTimer();
  }
});

// ── DEBOUNCE NAS BUSCAS ──────────────────────────────────────────────────────
// Evita re-render a cada keystroke em campos de pesquisa
const _debouncedRenderMyHistory        = debounce(()=>window.renderMyHistory?.(), 200);
const _debouncedRenderDashDemandas     = debounce(()=>window.renderDashDemandasWeek?.(), 200);
const _debouncedRenderDemandas         = debounce(()=>window.renderDemandas?.(true), 200);
const _debouncedRenderKanban           = debounce(()=>window.renderKanban?.(), 200);
const _debouncedRenderArquivo          = debounce(()=>window.renderArquivo?.(), 200);
window._debouncedRenderMyHistory       = _debouncedRenderMyHistory;
window._debouncedRenderDashDemandas    = _debouncedRenderDashDemandas;
window._debouncedRenderDemandas        = _debouncedRenderDemandas;
window._debouncedRenderKanban          = _debouncedRenderKanban;
window._debouncedRenderArquivo         = _debouncedRenderArquivo;

// ── CONTADOR DE CARACTERES no task input ─────────────────────────────────────
(function(){
  const input   = document.getElementById('taskInput');
  const counter = document.getElementById('taskCharCounter');
  if(!input || !counter) return;
  const MAX = 200;
  input.addEventListener('input', () => {
    const rem = MAX - input.value.length;
    counter.textContent = rem;
    counter.className = 'task-char-counter' + (rem <= 20 ? ' danger' : rem <= 50 ? ' warn' : '');
  });
})();
document.addEventListener('click',e=>{
  const panel=document.getElementById('notifPanel');
  const wrap=panel?.parentElement;   // container que agrupa sino + badge + painel
  // Fecha só em clique REALMENTE fora do bloco de notificações. Antes usava
  // previousElementSibling (que é o badge, não o sino) → o próprio clique de abrir
  // era tratado como "fora" e fechava o painel na hora.
  if(panel&&panel.style.display==='block'&&wrap&&!wrap.contains(e.target)){
    panel.style.display='none';
  }
});
scheduleAutoStop();
cleanLixeira();
document.getElementById('topbarDate').textContent=new Date().toLocaleDateString('pt-BR',{weekday:'short',day:'2-digit',month:'short',year:'numeric'});
updateDateNav();
updateWeekLabel();
if(typeof updateDashDayLabel === 'function') updateDashDayLabel();


// ── CFG (showPage wrap … cfgDelArquivoCol) → js/config.js ─────────────────────
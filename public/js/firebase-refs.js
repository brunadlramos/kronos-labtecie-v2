// ── KRONOS · FIREBASE — Inicialização e Refs ─────────────────────────────────
// Ponto único de inicialização do Firebase e de todos os database refs.
// _buildRefs(equipeId) reatribui todos os refs quando a equipe muda.
// Exporta live bindings — módulos importadores veem sempre o ref atualizado.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, createUserWithEmailAndPassword, signOut }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { getDatabase, ref }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';
import { getAnalytics, logEvent }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-analytics.js';

// ── Init ──────────────────────────────────────────────────────────────────────
const firebaseConfig = window.firebaseConfig;
export const firebaseApp = initializeApp(firebaseConfig);
export const auth        = getAuth(firebaseApp);
export const db          = getDatabase(firebaseApp);

// Analytics (opcional) — só inicializa se houver measurementId no config.
// Sem isso, evita carregar o gtag/Tag Manager à toa (fonte de ruído no console).
let _analytics = null;
try { if (firebaseConfig?.measurementId) _analytics = getAnalytics(firebaseApp); }
catch(e) { console.warn('[analytics]', e); }
export { _analytics as analytics };

// ── Equipe ativa ──────────────────────────────────────────────────────────────
export let EQUIPE_ID = 'diagramacao';

// ── Database Refs (inicializados com equipe padrão) ───────────────────────────
export let entriesRef          = ref(db, `equipes/${EQUIPE_ID}/entries`);
export let kanbanRef           = ref(db, `equipes/${EQUIPE_ID}/kanban`);
export let customTagsRef       = ref(db, `equipes/${EQUIPE_ID}/customTags`);
export let removedTagsRef      = ref(db, `equipes/${EQUIPE_ID}/removedDefaultTags`);
export let customProjectsRef   = ref(db, `equipes/${EQUIPE_ID}/customProjects`);
export let muralRef            = ref(db, `equipes/${EQUIPE_ID}/mural`);
export let desafioRef          = ref(db, `equipes/${EQUIPE_ID}/desafio`);
export let usersRef            = ref(db, `equipes/${EQUIPE_ID}/users`);
export let notifsRef           = ref(db, `equipes/${EQUIPE_ID}/notifs`);
export let avatarsRef          = ref(db, `equipes/${EQUIPE_ID}/avatars`);
export let arquivoRef          = ref(db, `equipes/${EQUIPE_ID}/arquivo`);
export let approvalRequestsRef = ref(db, `equipes/${EQUIPE_ID}/approvalRequests`);
export let activeTimersRef     = ref(db, `equipes/${EQUIPE_ID}/activeTimers`);
export let holidaysRef         = ref(db, `equipes/${EQUIPE_ID}/holidays`);
export let folgasRef           = ref(db, `equipes/${EQUIPE_ID}/folgas`);
export let logsRef             = ref(db, `equipes/${EQUIPE_ID}/logs`);
export let indicadoresManuaisRef = ref(db, `equipes/${EQUIPE_ID}/indicadoresManuais`);
export let capDiaRef           = ref(db, `equipes/${EQUIPE_ID}/capDia`);

// ── _buildRefs — reatribui todos os refs ao trocar de equipe ─────────────────
export function _buildRefs(equipeId) {
  EQUIPE_ID           = equipeId;
  entriesRef          = ref(db, `equipes/${equipeId}/entries`);
  kanbanRef           = ref(db, `equipes/${equipeId}/kanban`);
  customTagsRef       = ref(db, `equipes/${equipeId}/customTags`);
  removedTagsRef      = ref(db, `equipes/${equipeId}/removedDefaultTags`);
  customProjectsRef   = ref(db, `equipes/${equipeId}/customProjects`);
  muralRef            = ref(db, `equipes/${equipeId}/mural`);
  desafioRef          = ref(db, `equipes/${equipeId}/desafio`);
  usersRef            = ref(db, `equipes/${equipeId}/users`);
  notifsRef           = ref(db, `equipes/${equipeId}/notifs`);
  avatarsRef          = ref(db, `equipes/${equipeId}/avatars`);
  arquivoRef          = ref(db, `equipes/${equipeId}/arquivo`);
  approvalRequestsRef = ref(db, `equipes/${equipeId}/approvalRequests`);
  activeTimersRef     = ref(db, `equipes/${equipeId}/activeTimers`);
  holidaysRef         = ref(db, `equipes/${equipeId}/holidays`);
  folgasRef           = ref(db, `equipes/${equipeId}/folgas`);
  logsRef             = ref(db, `equipes/${equipeId}/logs`);
  indicadoresManuaisRef = ref(db, `equipes/${equipeId}/indicadoresManuais`);
  capDiaRef           = ref(db, `equipes/${equipeId}/capDia`);
}

// ── Segunda instância Firebase — cria usuários sem deslogar a gestora ─────────
let _secondaryAuth = null;
export function _getSecondaryAuth() {
  if (_secondaryAuth) return _secondaryAuth;
  try {
    const secondary = initializeApp(firebaseConfig, 'kronos-create-user');
    _secondaryAuth = getAuth(secondary);
  } catch(e) {
    try {
      _secondaryAuth = getAuth(initializeApp(firebaseConfig, 'kronos-create-user'));
    } catch(e2) {
      console.warn('[_getSecondaryAuth] fallback para instância principal');
      _secondaryAuth = auth;
    }
  }
  return _secondaryAuth;
}

// Re-exporta funções usadas em outros módulos para evitar imports duplicados
export { createUserWithEmailAndPassword, signOut, logEvent };

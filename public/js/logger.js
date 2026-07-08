// ── KRONOS · BANCO DE LOGS DE ERRO (error_logs) ──────────────────────────────
// Registra ERROS/eventos relevantes num nó GLOBAL /error_logs (admin vê todas as
// equipes num painel só). Guarda contexto suficiente para resolver sem reproduzir:
// quem (nome + email + uid), quando, em qual módulo/ação, mensagem e stack.
//
// Princípios (do PRD, adaptados ao Kronos = vanilla JS + RTDB, plano Spark → só
// captura no cliente):
//  • 4 níveis: info | warn | error | fatal.
//  • MASCARAMENTO POR ALLOWLIST: no `extra`, só os campos abaixo podem ser gravados;
//    todo o resto é cortado. O padrão é "não grava" — nunca senha/token/dado sensível.
//  • Fire-and-forget e à prova de falha: o logger NUNCA pode quebrar o app.

import { app as state }   from './state.js';
import { errorLogsRef }   from './firebase-refs.js';
import { push } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

// Único lugar que decide o que PODE ser gravado no contexto extra do log.
const EXTRA_ALLOWLIST = [
  'collab','collabKey','project','projectId','entryKey','cardKey','equipeId',
  'column','count','tab','page','field','status','code','durationMs','key','id'
];

function _maskExtra(extra){
  if(!extra || typeof extra !== 'object') return null;
  const out = {};
  for(const k of EXTRA_ALLOWLIST){
    const v = extra[k];
    if(v === undefined || v === null) continue;
    out[k] = (typeof v === 'object' ? JSON.stringify(v) : String(v)).slice(0, 200);
  }
  return Object.keys(out).length ? out : null;
}

let _reqSeq = 0;
// Amarra vários logs de uma mesma ação (para seguir o rastro).
export function newRequestId(){
  return `${Date.now().toString(36)}-${(_reqSeq++).toString(36)}-${Math.random().toString(36).slice(2,6)}`;
}

const LEVELS = ['info','warn','error','fatal'];

async function _write(level, o = {}){
  try {
    const rec = {
      ts:        Date.now(),
      level:     LEVELS.includes(level) ? level : 'error',
      modulo:    String(o.modulo || 'geral').slice(0, 60),
      action:    String(o.action || '').slice(0, 120),
      message:   String(o.message || '').slice(0, 1000),
      stack:     String(o.stack || '').slice(0, 2000),
      requestId: String(o.requestId || '').slice(0, 60),
      // Quem — nome do colaborador (pedido), + email + uid p/ identificar sem ambiguidade.
      userId:    state.currentUser?.uid || 'anon',
      userName:  state.COLLABS?.[state.currentCollabKey]?.label
                 || state.currentUser?.displayName
                 || (state.currentUser?.email || '').split('@')[0] || 'desconhecido',
      userEmail: (state.currentUser?.email || '').slice(0, 120),
      equipeId:  state.equipeAtiva || '',
      url:       ((location && location.pathname) || '') + ((location && location.hash) || ''),
      resolved:  false
    };
    const masked = _maskExtra(o.extra);
    if(masked) rec.extra = masked;
    push(errorLogsRef, rec).catch(() => {});   // rejeição assíncrona não propaga
  } catch(_){ /* o logger nunca quebra o fluxo do app */ }
}

export const logInfo  = (o) => _write('info',  o);
export const logWarn  = (o) => _write('warn',  o);
export const logError = (o) => _write('error', o);
export const logFatal = (o) => _write('fatal', o);

// ── KRONOS · TIMER ───────────────────────────────────────────────────────────
// Funções do timer: start, stop, restore, sync e auto-stop às 18h30.
// Usa state.* de state.js — sem callbacks, sem colisão com Firebase app.

import { app as state } from './state.js';
import { db, entriesRef, kanbanRef, activeTimersRef } from './firebase-refs.js';
import { ref, set, push, remove, child } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';
import { fmtDur, debounce } from './utils.js';
import { ICONS }            from './icons.js';
import { showToast, setSyncStatus } from './ui.js';

export const LATE_CUTOFF_HOUR   = 18;
export const LATE_CUTOFF_MINUTE = 30;

// ── Funções auxiliares injetadas (evitam import circular) ─────────────────────
// São registradas pelo initTimer() em index_v2.js
let _getSelectedTags = () => [];
let _clearTags       = () => {};
let _setTags         = () => {};
let _assertCanWrite  = () => {};
export function initTimer({ getSelectedTags, clearTags, setTags, assertCanWrite }) {
  _getSelectedTags = getSelectedTags;
  _clearTags       = clearTags;
  _setTags         = setTags;
  _assertCanWrite  = assertCanWrite;
}

// ── resetNoActivityTimer ──────────────────────────────────────────────────────
export function resetNoActivityTimer() {
  if (state.noActivityTimer) clearTimeout(state.noActivityTimer);
  if (state.isRunning) return;
  state.noActivityTimer = setTimeout(() => {
    if (!state.isRunning && Notification.permission === 'granted') {
      new Notification('Kronos · Labtecie', {
        body: 'Você está há 10 minutos sem registrar. Não esqueça de iniciar o timer!',
        icon: 'Labtecie.png'
      });
    } else if (Notification.permission === 'default') {
      Notification.requestPermission().then(p => { if (p === 'granted') resetNoActivityTimer(); });
    }
  }, 10 * 60 * 1000);
}

// ── toggleTimer ───────────────────────────────────────────────────────────────
export async function toggleTimer() {
  if (state.timerOperationInProgress) return;
  state.timerOperationInProgress = true;
  try { state.isRunning ? await stopTimer() : startTimer(); }
  finally { state.timerOperationInProgress = false; }
}

// ── startTimer ────────────────────────────────────────────────────────────────
export function startTimer() {
  state.isRunning = true;
  state.startTime = Date.now();
  state.elapsed   = 0;

  document.getElementById('timerCard')?.classList.add('running');
  document.getElementById('startBtn')?.classList.add('running');
  document.getElementById('timerDisplay')?.classList.add('running');
  const btnIcon = document.getElementById('btnIcon');
  if (btnIcon) btnIcon.innerHTML = '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>';
  document.getElementById('startBtn')?.setAttribute('aria-label', 'Parar timer');

  if (state.intervalId) clearInterval(state.intervalId);
  state.intervalId = setInterval(() => {
    state.elapsed = Date.now() - state.startTime;
    const el = document.getElementById('timerDisplay');
    if (el) el.textContent = fmtDur(state.elapsed);
    document.title = fmtDur(state.elapsed) + ' · Kronos';
  }, 1000);

  document.getElementById('timerDisplay').textContent = fmtDur(0);

  const collab = state.isManager
    ? (document.getElementById('collabSelect')?.value || state.currentCollabKey)
    : state.currentCollabKey;

  // Refresh-safe: lembra sob qual collab o timer foi salvo, pois o collabSelect do gestor
  // reseta ao recarregar a página e o restore precisa achar o timer certo.
  try { localStorage.setItem('kronos_timerCollab', collab||''); } catch(e) {}

  // Bug: set() retorna Promise — a rejeição é assíncrona, então usa .catch (try/catch síncrono não pegava)
  set(child(activeTimersRef, collab), {
    task:      document.getElementById('taskInput')?.value || 'Em andamento',
    project:   document.getElementById('projectSelect')?.value,
    obs:       document.getElementById('obsInput')?.value || '',
    tags:      _getSelectedTags(document.getElementById('timerTags')),
    startTime: state.startTime,
    collab
  }).catch(e => console.error('[startTimer] activeTimers', e));

  if (state.noActivityTimer) clearTimeout(state.noActivityTimer);
}

// ── stopTimer ─────────────────────────────────────────────────────────────────
export async function stopTimer(endTime = null) {
  clearInterval(state.intervalId);
  state.isRunning = false;

  const task    = (document.getElementById('taskInput')?.value.trim() || 'Sem título').slice(0, 200);
  const project = document.getElementById('projectSelect')?.value;
  // Para gestora/admin usa o colaborador selecionado no topbar, igual ao startTimer
  const collab  = state.isManager
    ? (document.getElementById('collabSelect')?.value || state.currentCollabKey)
    : state.currentCollabKey;
  const obs     = document.getElementById('obsInput')?.value.trim().slice(0, 500) || '';
  const tags    = _getSelectedTags(document.getElementById('timerTags'));
  const fin = endTime || Date.now();
  const dur = fin - state.startTime;

  if (dur <= 2000 && dur > 0) {
    showToast('Registro descartado', 'Timer muito curto — mínimo de 2 segundos para salvar.', 'warning');
  }

  if (dur > 2000) {
    try { _assertCanWrite(collab); }
    catch(err) { showToast('Sem permissão', err.message); return; }

    setSyncStatus('loading', 'Salvando...');
    const restartKey = window._restartingFromKey;

    try {
      if (restartKey && state.allEntries[restartKey]) {
        const orig    = state.allEntries[restartKey];
        const periods = orig.periods || [{ startTime: orig.startTime, endTime: orig.endTime, duration: orig.duration }];
        periods.push({ startTime: state.startTime, endTime: fin, duration: dur });
        const totalDuration = periods.reduce((s, p) => s + (p.duration || 0), 0);
        await set(child(entriesRef, restartKey), {
          ...orig,
          obs: obs || orig.obs || '',
          periods,
          duration:   totalDuration,
          endTime:    fin,
          modifiedAt: Date.now(),
          modifiedBy: state.currentUser?.email || 'desconhecido'
        });
        const linked = Object.entries(state.kanbanCards || {}).find(([, c]) => c.fromEntryKey === restartKey);
        if (linked) {
          const [cardKey, cardData] = linked;
          await set(child(kanbanRef, cardKey), { ...cardData, updatedAt: fin });
        }
      } else {
        await push(entriesRef, { task, project, collab, obs, tags, startTime: state.startTime, endTime: fin, duration: dur, createdAt: fin });
      }
      window._restartingFromKey = null;
      setSyncStatus('ok', 'Sincronizado ✓');
    } catch(saveErr) {
      setSyncStatus('err', 'Erro ao salvar');
      showToast('Erro ao salvar registro', 'O timer parou mas o registro pode não ter sido salvo. Verifique sua conexão.');
      console.error('[stopTimer] save failed:', saveErr);
      window._restartingFromKey = null;
    }
  }

  // Bug: reutiliza 'collab' (que tem o fallback p/ currentCollabKey) — antes usava 'c'
  // sem fallback e podia deixar o nó activeTimers órfão quando o select estava vazio
  remove(child(activeTimersRef, collab)).catch(()=>{});
  try { localStorage.removeItem('kronos_timerCollab'); } catch(e) {}

  ['timerCard', 'startBtn', 'timerDisplay'].forEach(id => document.getElementById(id)?.classList.remove('running'));
  document.getElementById('timerDisplay').textContent = '00:00:00';
  document.title = 'Kronos · Labtecie';
  document.getElementById('taskInput').value  = '';
  document.getElementById('obsInput').value   = '';
  const btnIcon = document.getElementById('btnIcon');
  if (btnIcon) btnIcon.innerHTML = '<path d="M8 5v14l11-7z"/>';
  document.getElementById('startBtn')?.setAttribute('aria-label', 'Iniciar timer');
  _clearTags(document.getElementById('timerTags'));
  resetNoActivityTimer();
  // Re-renderiza a página do timer imediatamente para refletir a nova ordem
  setTimeout(() => {
    if(document.getElementById('page-timer')?.classList.contains('active')){
      window.renderCurrentPage?.();
    }
  }, 300);
}

// ── restoreTimerFromFirebase ───────────────────────────────────────────────────
export function restoreTimerFromFirebase(timers) {
  if (state.isRunning) return;
  // Prioriza o collab salvo no início (resiste ao reset do collabSelect no refresh)
  let savedCollab = ''; try { savedCollab = localStorage.getItem('kronos_timerCollab')||''; } catch(e) {}
  const fallback = state.isManager
    ? (document.getElementById('collabSelect')?.value || state.currentCollabKey)
    : state.currentCollabKey;
  const collab = (savedCollab && timers[savedCollab]) ? savedCollab : fallback;
  const active = timers[collab];
  if (!active || !active.startTime) return;
  // Timer do Kanban: aparece em "Em andamento agora", mas NÃO deve restaurar a UI
  // do timer principal (ele tem seu próprio restore via localStorage no kanban.js).
  if (active.kanban) return;
  // Gestor: re-seleciona o colaborador do timer para que o stop/sync escrevam no lugar certo
  if (state.isManager) {
    const cs = document.getElementById('collabSelect');
    if (cs && collab && cs.value !== collab) cs.value = collab;
  }

  const timerDate = new Date(active.startTime);
  const now = new Date();
  if (timerDate.toDateString() !== now.toDateString()) {
    try { remove(child(activeTimersRef, collab)); } catch(e) {}
    return;
  }

  state.isRunning = true;
  state.startTime = active.startTime;
  state.elapsed   = Date.now() - state.startTime;

  const taskInput     = document.getElementById('taskInput');
  const projectSelect = document.getElementById('projectSelect');
  const obsInput      = document.getElementById('obsInput');
  if (taskInput    && active.task)    taskInput.value     = active.task;
  if (projectSelect && active.project){ projectSelect.value = active.project; window._syncProjectSearchFromHidden?.(); }
  if (obsInput     && active.obs)     obsInput.value      = active.obs;
  if (active.tags?.length) {
    try { _setTags(document.getElementById('timerTags'), active.tags); } catch(e) {}
  }

  document.getElementById('timerCard')?.classList.add('running');
  document.getElementById('startBtn')?.classList.add('running');
  document.getElementById('timerDisplay')?.classList.add('running');
  const btnIcon = document.getElementById('btnIcon');
  if (btnIcon) btnIcon.innerHTML = '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>';

  if (state.intervalId) clearInterval(state.intervalId);
  state.intervalId = setInterval(() => {
    state.elapsed = Date.now() - state.startTime;
    const el = document.getElementById('timerDisplay');
    if (el) el.textContent = fmtDur(state.elapsed);
    document.title = fmtDur(state.elapsed) + ' · Kronos';
  }, 1000);

  const el = document.getElementById('timerDisplay');
  if (el) el.textContent = fmtDur(Date.now() - state.startTime);
  if (state.noActivityTimer) clearTimeout(state.noActivityTimer);

  showToast('Timer restaurado', '"' + (active.task || 'Em andamento') + '" continua rodando.');
  setTimeout(checkRetroActiveStop, 500);
}

// ── syncActiveTimerFields ─────────────────────────────────────────────────────
export function syncActiveTimerFields() {
  if (!state.isRunning) return;
  const collab = state.isManager
    ? document.getElementById('collabSelect')?.value || state.currentCollabKey
    : state.currentCollabKey;
  set(child(activeTimersRef, collab), {
    task:      document.getElementById('taskInput')?.value || 'Em andamento',
    project:   document.getElementById('projectSelect')?.value || '',
    obs:       document.getElementById('obsInput')?.value || '',
    tags:      _getSelectedTags(document.getElementById('timerTags')),
    startTime: state.startTime,
    collab
  }).catch(e => console.error('[syncActiveTimerFields]', e));
}
export const syncTimerDebounced = debounce(syncActiveTimerFields, 2000);

// ── checkRetroActiveStop ──────────────────────────────────────────────────────
export async function checkRetroActiveStop() {
  if (!state.isRunning || !state.startTime) return;
  const startDate = new Date(state.startTime);
  const cutoff    = new Date(startDate);
  cutoff.setHours(LATE_CUTOFF_HOUR, LATE_CUTOFF_MINUTE, 0, 0);
  const now = new Date();
  if (now > cutoff && startDate < cutoff) {
    await stopTimer(cutoff.getTime());
    showToast('Timer finalizado automaticamente',
      `O timer foi encerrado retroativamente às ${LATE_CUTOFF_HOUR}h${String(LATE_CUTOFF_MINUTE).padStart(2,'0')} do dia em que estava rodando.`);
  }
}

// ── scheduleAutoStop ──────────────────────────────────────────────────────────
export function scheduleAutoStop() {
  const now    = new Date();
  const cutoff = new Date();
  cutoff.setHours(LATE_CUTOFF_HOUR, LATE_CUTOFF_MINUTE, 0, 0);
  let msUntil = cutoff - now;
  if (msUntil < 0) msUntil += 24 * 60 * 60 * 1000;
  setTimeout(async () => {
    if (state.isRunning) {
      if (new Date(state.startTime).getHours() >= LATE_CUTOFF_HOUR) {
        scheduleAutoStop();
        return;
      }
      await stopTimer(cutoff.getTime());
      showToast('Timer finalizado automaticamente',
        `O timer foi encerrado às ${LATE_CUTOFF_HOUR}h${String(LATE_CUTOFF_MINUTE).padStart(2,'0')} para evitar registros incorretos.`);
    }
    scheduleAutoStop();
  }, msUntil);
}

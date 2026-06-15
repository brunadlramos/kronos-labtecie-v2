// ── KRONOS · ENTRIES — CRUD de Registros de Horas ────────────────────────────
// openModal, closeModal, saveModal, deleteEntry, clearDay,
// openEntryDetail, closeEntryDetail, assertCanWrite
// Usa state.* de state.js — sem callbacks desnecessários.

import { app as state }  from './state.js';
import { db, entriesRef, approvalRequestsRef, notifsRef, EQUIPE_ID } from './firebase-refs.js';
import { ref, push, set, remove, get, child }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';
import { escH, fmtDur, fmtTime, dKey, dateKey, MS_PER_DAY } from './utils.js';
import { ICONS }                                   from './icons.js';
import { showToast, setSyncStatus, trapFocus, releaseFocus } from './ui.js';


// ── Contexto injetado pelo initEntries() ─────────────────────────────────────
let _ctx = {
  getSelectedTags:         () => [],
  clearTags:               () => {},
  setTags:                 () => {},
  getEntriesForDay:        () => [],
  calcAmount:              () => 0,
  getCollabAvatar:         k  => ({ display: k?.slice(0,2)?.toUpperCase()||'?', color:'#94A3B8', isEmoji:false }),
  updateProjectColorDot:   () => {},
  _updateTaskSuggestions:  () => {},
  _refreshKanbanTypeFilter:() => {},
  renderTimerPage:         () => {},
};
export function initEntries(context) { Object.assign(_ctx, context); }

// ── assertCanWrite ────────────────────────────────────────────────────────────
export function assertCanWrite(targetCollab) {
  if (!state.currentUser) throw new Error('Não autenticado');
  if (state.isManager)    return true;
  if (targetCollab && targetCollab !== state.currentCollabKey) {
    console.warn('[assertCanWrite]', state.currentUser.email, 'tentou escrever como', targetCollab);
    throw new Error('Sem permissão para escrever como outro colaborador');
  }
  return true;
}

// ── openEntryDetail ───────────────────────────────────────────────────────────
export function openEntryDetail(key) {
  const e = state.allEntries[key]; if (!e) return;
  const proj = state.PROJECTS[e.project] || { label: escH(e.project||'?'), color: '#94A3B8' };
  const col  = state.COLLABS[e.collab]   || { label: escH(e.collab||'?'), initials: '?', color: '#94A3B8' };

  const periods = e.periods || [{ startTime: e.startTime, endTime: e.endTime, duration: e.duration }];
  const periodsHtml = periods.map((p, i) => {
    const dur  = fmtDur(p.duration || (p.endTime - p.startTime));
    const date = new Date(p.startTime).toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric' });
    return `<div style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:var(--surface2);border-radius:8px;margin-bottom:6px;">
      <div style="font-size:0.7rem;font-weight:800;color:var(--muted);min-width:20px;text-align:center">#${i+1}</div>
      <div style="flex:1"><div style="font-size:0.78rem;font-weight:700">${fmtTime(p.startTime)} → ${fmtTime(p.endTime)}</div>
        <div style="font-size:0.68rem;color:var(--muted)">${date}</div></div>
      <div style="font-family:var(--mono);font-size:0.75rem;font-weight:700;color:var(--orange)">${dur}</div>
    </div>`;
  }).join('');

  let historyHtml = '';
  if (e.modifiedAt) {
    historyHtml = `<div style="display:flex;align-items:flex-start;gap:10px;padding:8px 12px;background:var(--surface2);border-radius:8px;">
      <div style="font-size:0.85rem">${ICONS.edit}</div>
      <div><div style="font-size:0.78rem;font-weight:700">Editado por ${escH(e.modifiedBy||'?')}</div>
        <div style="font-size:0.68rem;color:var(--muted)">${new Date(e.modifiedAt).toLocaleString('pt-BR')}</div></div>
    </div>`;
  }
  if (e.importedFrom === 'clockify_csv') {
    historyHtml += `<div style="display:flex;align-items:flex-start;gap:10px;padding:8px 12px;background:var(--surface2);border-radius:8px;margin-top:6px;">
      <div>${ICONS.import}</div>
      <div><div style="font-size:0.78rem;font-weight:700">Importado do Clockify</div>
        <div style="font-size:0.68rem;color:var(--muted)">${new Date(e.createdAt||e.startTime).toLocaleString('pt-BR')}</div></div>
    </div>`;
  }
  if (!historyHtml) historyHtml = `<div style="font-size:0.78rem;color:var(--muted);text-align:center;padding:8px">Sem alterações registradas</div>`;

  const totalDur  = fmtDur(e.duration);
  const tagsHtml  = (e.tags||[]).map(t => `<span class="entry-tag">${escH(t)}</span>`).join('') || '<span style="color:var(--muted);font-size:0.75rem">—</span>';
  const canEdit   = state.isManager || e.collab === state.currentCollabKey;

  let drawer = document.getElementById('entryDetailDrawer');
  if (!drawer) {
    drawer = document.createElement('div');
    drawer.id = 'entryDetailDrawer';
    drawer.setAttribute('role','dialog'); drawer.setAttribute('aria-modal','true');
    drawer.setAttribute('aria-label','Detalhes do Registro');
    drawer.style.cssText = 'position:fixed;top:0;right:0;width:380px;max-width:95vw;height:100vh;background:var(--surface);border-left:1.5px solid var(--border);box-shadow:-4px 0 24px rgba(0,0,0,0.10);z-index:1200;display:flex;flex-direction:column;transition:transform 0.25s ease;transform:translateX(100%)';
    document.body.appendChild(drawer);
    const overlay = document.createElement('div');
    overlay.id = 'entryDetailOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.18);z-index:1199;display:none';
    overlay.onclick = closeEntryDetail;
    document.body.appendChild(overlay);
  }

  drawer.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:18px 20px;border-bottom:1px solid var(--border);flex-shrink:0">
      <div style="font-size:0.95rem;font-weight:800">Detalhes do Registro</div>
      <button onclick="window.closeEntryDetail()" style="background:none;border:none;cursor:pointer;color:var(--muted);display:flex;align-items:center;padding:4px;border-radius:6px;transition:all 0.2s;" title="Fechar">${ICONS.x}</button>
    </div>
    <div style="flex:1;overflow-y:auto;padding:20px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
        <div style="width:36px;height:36px;border-radius:50%;background:${col.color};display:flex;align-items:center;justify-content:center;font-size:0.6rem;font-weight:800;color:#fff;flex-shrink:0">${col.initials}</div>
        <div>
          <div style="font-size:0.88rem;font-weight:800">${escH(e.task)}</div>
          <div style="font-size:0.72rem;color:var(--muted);margin-top:2px">${escH(col.label)} · <span style="color:${proj.color};font-weight:700">${escH(proj.label)}</span></div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:20px">
        <div style="background:var(--surface2);border-radius:8px;padding:10px 12px">
          <div style="font-size:0.65rem;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px">Duração total</div>
          <div style="font-family:var(--mono);font-size:1rem;font-weight:700;color:var(--orange)">${totalDur}</div>
        </div>
        <div style="background:var(--surface2);border-radius:8px;padding:10px 12px">
          <div style="font-size:0.65rem;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px">Períodos</div>
          <div style="font-family:var(--mono);font-size:1rem;font-weight:700">${periods.length}x</div>
        </div>
      </div>
      ${e.tags?.length ? `<div style="margin-bottom:16px"><div style="font-size:0.65rem;font-weight:800;color:var(--muted);text-transform:uppercase;margin-bottom:6px">Tags</div><div style="display:flex;flex-wrap:wrap;gap:4px">${tagsHtml}</div></div>` : ''}
      ${e.obs ? `<div style="margin-bottom:16px"><div style="font-size:0.65rem;font-weight:800;color:var(--muted);text-transform:uppercase;margin-bottom:6px">Observação</div><div style="font-size:0.82rem;font-style:italic;color:var(--muted)">"${escH(e.obs)}"</div></div>` : ''}
      <div style="margin-bottom:16px"><div style="font-size:0.65rem;font-weight:800;color:var(--muted);text-transform:uppercase;margin-bottom:8px">Períodos registrados</div>${periodsHtml}</div>
      <div><div style="font-size:0.65rem;font-weight:800;color:var(--muted);text-transform:uppercase;margin-bottom:8px">Histórico</div>${historyHtml}</div>
    </div>
    ${canEdit ? `<div style="padding:16px 20px;border-top:1px solid var(--border);flex-shrink:0">
      <button onclick="window.closeEntryDetail();window.openModal('${key}')" style="width:100%;background:var(--orange);color:#fff;border:none;border-radius:10px;padding:10px;font-weight:700;font-size:0.85rem;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;">${ICONS.edit} Editar registro</button>
    </div>` : ''}`;

  const overlay = document.getElementById('entryDetailOverlay');
  if (overlay) overlay.style.display = 'block';
  setTimeout(() => { drawer.style.transform = 'translateX(0)'; }, 10);
}

export function closeEntryDetail() {
  const drawer  = document.getElementById('entryDetailDrawer');
  const overlay = document.getElementById('entryDetailOverlay');
  if (drawer)  drawer.style.transform = 'translateX(100%)';
  if (overlay) overlay.style.display  = 'none';
}

// ── openModal ─────────────────────────────────────────────────────────────────
export function openModal(id) {
  state.editingId = id;
  window._periodDraft = null;
  document.getElementById('modalTitle').textContent = id ? 'Editar Registro' : 'Novo Registro';
  if (id) {
    const e = state.allEntries[id];
    if (!e) return;
    document.getElementById('mTask').value    = e.task || '';
    document.getElementById('mCollab').value  = e.collab || state.currentCollabKey;
    document.getElementById('mProject').value = e.project || 'gestao';
    _ctx.updateProjectColorDot(document.getElementById('mProject'), 'mProjectColorDot');
    const d = new Date(e.startTime);
    document.getElementById('mDate').value  = d.toISOString().slice(0,10);
    document.getElementById('mStart').value = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    const de = new Date(e.endTime);
    document.getElementById('mEnd').value   = `${String(de.getHours()).padStart(2,'0')}:${String(de.getMinutes()).padStart(2,'0')}`;
    document.getElementById('mObs').value   = e.obs || '';
    _ctx.clearTags(document.getElementById('mTagsContainer'));
    _ctx.setTags(document.getElementById('mTagsContainer'), e.tags || []);
    // Períodos editáveis
    if (e.periods && e.periods.length > 1) {
      _openModalWithDraft(id, e);
      return;
    }
  } else {
    const now = new Date();
    const endDefault = new Date(now.getTime() + 3600000); // +1h padrão
    document.getElementById('mDate').value  = now.toISOString().slice(0,10);
    document.getElementById('mStart').value = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    document.getElementById('mEnd').value   = `${String(endDefault.getHours()).padStart(2,'0')}:${String(endDefault.getMinutes()).padStart(2,'0')}`;
    document.getElementById('mObs').value   = '';
    // Para gestora/admin: deixa mCollab sem valor fixo para forçar seleção consciente
    const collabSel = document.getElementById('mCollab');
    if(collabSel) collabSel.value = state.isManager ? (collabSel.options[1]?.value || state.currentCollabKey || '') : (state.currentCollabKey || '');
    document.getElementById('mProject').value = 'trabalho';
    _ctx.updateProjectColorDot(document.getElementById('mProject'), 'mProjectColorDot');
    _ctx.clearTags(document.getElementById('mTagsContainer'));
    document.getElementById('mPeriodsWrap').style.display = 'none';
    document.getElementById('mSimpleTimeFields').style.display = 'contents';
  }
  document.getElementById('modalOverlay').classList.add('open');
  const _mo = document.getElementById('modalOverlay'); if(_mo) trapFocus(_mo);
}

function _openModalWithDraft(id, draft) {
  const e = draft || state.allEntries[id];
  if (!e || !e.periods) return openModal(id);
  const wrap = document.getElementById('mPeriodsWrap');
  const simpleFields = document.getElementById('mSimpleTimeFields');
  if (simpleFields) simpleFields.style.display = 'none';
  if (wrap) {
    wrap.style.display = 'block';
    wrap.innerHTML = e.periods.map((p, i) => {
      const ds = new Date(p.startTime), de2 = new Date(p.endTime);
      const fmt = d => `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
      const fmtDate = d => d.toISOString().slice(0,10);
      return `<div class="period-edit-row" data-idx="${i}" style="background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:10px 12px;margin-bottom:8px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
          <span style="font-size:0.72rem;font-weight:800;color:var(--muted)">Período #${i+1}</span>
          <button onclick="window._removePeriod(${i})" style="background:none;border:1.5px solid var(--danger);color:var(--danger);border-radius:6px;padding:3px 8px;cursor:pointer;font-size:0.68rem;" title="Remover período" aria-label="Remover período ${i+1}">${ICONS.trash}</button>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:6px;">
          <div><label style="font-size:0.62rem;font-weight:700;color:var(--muted)">Data início</label>
            <input class="modal-input period-date-start" type="date" data-idx="${i}" value="${fmtDate(ds)}" oninput="window._updatePeriodDuration(${i})"></div>
          <div><label style="font-size:0.62rem;font-weight:700;color:var(--muted)">Hora início</label>
            <input class="modal-input period-time-start" type="time" data-idx="${i}" value="${fmt(ds)}" oninput="window._updatePeriodDuration(${i})"></div>
          <div><label style="font-size:0.62rem;font-weight:700;color:var(--muted)">Data fim</label>
            <input class="modal-input period-date-end" type="date" data-idx="${i}" value="${fmtDate(de2)}" oninput="window._updatePeriodDuration(${i})"></div>
          <div><label style="font-size:0.62rem;font-weight:700;color:var(--muted)">Hora fim</label>
            <input class="modal-input period-time-end" type="time" data-idx="${i}" value="${fmt(de2)}" oninput="window._updatePeriodDuration(${i})"></div>
        </div>
        <div style="font-size:0.72rem;color:var(--muted);margin-top:4px">Duração: <span class="period-dur-display" style="font-family:var(--mono);color:var(--orange)">${fmtDur(p.duration||(p.endTime-p.startTime))}</span></div>
      </div>`;
    }).join('');
  }
  document.getElementById('modalOverlay').classList.add('open');
}

// ── closeModal ────────────────────────────────────────────────────────────────
export function closeModal() {
  releaseFocus();
  document.getElementById('modalOverlay').classList.remove('open');
  state.editingId  = null;
  window._periodDraft = null;
}

// ── saveModal ─────────────────────────────────────────────────────────────────
export async function saveModal() {
  const task    = (document.getElementById('mTask').value.trim() || 'Sem título').slice(0,200);
  const collab  = state.isManager ? document.getElementById('mCollab').value : state.currentCollabKey;
  if(state.isManager && !collab){
    const el = document.getElementById('mCollab');
    if(el){ el.style.borderColor='var(--danger)'; setTimeout(()=>el.style.borderColor='',3000); }
    showToast('Colaborador obrigatório','Selecione o colaborador para este registro.');
    return;
  }
  const project = document.getElementById('mProject').value;
  const obs     = document.getElementById('mObs').value.trim().slice(0,500);
  const tags    = _ctx.getSelectedTags(document.getElementById('mTagsContainer'));
  const [sh,sm] = document.getElementById('mStart').value.split(':').map(Number);
  const [eh,em] = document.getElementById('mEnd').value.split(':').map(Number);
  const dateVal = document.getElementById('mDate').value;
  let base;
  if (dateVal) { const [y,mo,d] = dateVal.split('-').map(Number); base = new Date(y,mo-1,d); }
  else if (state.editingId) { base = new Date(state.allEntries[state.editingId]?.startTime || Date.now()); }
  else { base = state.viewDate; }
  const sTs = new Date(base.getFullYear(),base.getMonth(),base.getDate(),sh,sm).getTime();
  let eTs   = new Date(base.getFullYear(),base.getMonth(),base.getDate(),eh,em).getTime();
  if (eTs < sTs) eTs += MS_PER_DAY;
  if (eTs - sTs < 60000) {
    ['mStart','mEnd'].forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.style.borderColor='var(--danger)'; el.style.boxShadow='0 0 0 3px var(--danger-bg)'; setTimeout(()=>{el.style.borderColor='';el.style.boxShadow='';},3000); }
    });
    showToast('Duração inválida','O registro precisa ter pelo menos 1 minuto.');
    return;
  }
  const now = Date.now();
  const origEntry = (state.editingId && window._periodDraft && window._periodDraft === Object(window._periodDraft))
    ? window._periodDraft : (state.editingId ? state.allEntries[state.editingId] : null);
  let payload;
  if (state.editingId) {
    const orig = origEntry;
    const hasPeriods = orig?.periods?.length > 1;
    if (hasPeriods) {
      const wrap = document.getElementById('mPeriodsWrap');
      const rows = wrap ? wrap.querySelectorAll('.period-edit-row') : [];
      const newPeriods = Array.from(rows).map(row => {
        const idx = parseInt(row.dataset.idx);
        const ds2 = wrap.querySelector(`.period-date-start[data-idx="${idx}"]`)?.value;
        const ts2 = wrap.querySelector(`.period-time-start[data-idx="${idx}"]`)?.value;
        const de2 = wrap.querySelector(`.period-date-end[data-idx="${idx}"]`)?.value;
        const te2 = wrap.querySelector(`.period-time-end[data-idx="${idx}"]`)?.value;
        if (!ds2||!ts2||!de2||!te2) return orig.periods[idx];
        const [sy,sm2,sd] = ds2.split('-').map(Number);
        const [sh3,smin]  = ts2.split(':').map(Number);
        const [ey2,em3,ed]= de2.split('-').map(Number);
        const [eh3,emin]  = te2.split(':').map(Number);
        const pSts = new Date(sy,sm2-1,sd,sh3,smin).getTime();
        let   pEts = new Date(ey2,em3-1,ed,eh3,emin).getTime();
        if (pEts<=pSts) pEts = pSts+60000;
        return { startTime:pSts, endTime:pEts, duration:pEts-pSts };
      });
      const totalDuration = newPeriods.reduce((s,p)=>s+p.duration,0);
      payload = { ...orig, task, collab, project, obs, tags, periods:newPeriods,
        startTime:newPeriods[0].startTime, endTime:newPeriods[newPeriods.length-1].endTime,
        duration:totalDuration, modifiedAt:now, modifiedBy:state.currentUser?.email||'desconhecido' };
    } else {
      payload = { ...orig, task, collab, project, obs, tags, startTime:sTs, endTime:eTs,
        duration:eTs-sTs, modifiedAt:now, modifiedBy:state.currentUser?.email||'desconhecido' };
    }
  }
  if (!state.isManager) {
    const entryTs = state.editingId ? (origEntry?.startTime||sTs) : sTs;
    const ageDays = (now - entryTs) / MS_PER_DAY;
    if (ageDays > state.EDIT_WINDOW_DAYS) {
      const approvalPayload = state.editingId ? payload : {task,project,collab,obs,tags,startTime:sTs,endTime:eTs,duration:eTs-sTs,createdAt:now};
      try {
        await push(approvalRequestsRef, { type:state.editingId?'edit':'new', entryKey:state.editingId||null,
          payload:approvalPayload, requestedBy:state.currentCollabKey,
          requestedByEmail:state.currentUser?.email||'', requestedAt:now, status:'pending' });
        if (state.KANBAN_ROLES.gestora[0]) {
          try {
            await push(notifsRef, { to:state.KANBAN_ROLES.gestora[0], title:'Aprovação solicitada',
              msg:`${state.COLLABS[state.currentCollabKey]?.label||state.currentCollabKey} solicitou aprovação para um registro fora da janela de ${state.EDIT_WINDOW_DAYS} dias.`,
              from:state.currentCollabKey, ts:now, read:false });
          } catch(_){}
        }
        closeModal();
        showToast('Solicitação enviada',`Registro fora da janela de ${state.EDIT_WINDOW_DAYS} dias. A gestora receberá a solicitação para aprovar.`);
      } catch(err) {
        showToast('Erro','Não foi possível enviar a solicitação. Verifique sua conexão.');
        console.error('[saveModal approval]',err);
      }
      return;
    }
  }
  const saveBtn = document.querySelector('#modalOverlay .btn-save');
  if (saveBtn) { saveBtn.disabled=true; saveBtn.style.opacity='0.6'; }
  setSyncStatus('loading','Salvando...');
  try {
    if (state.editingId) { await set(child(entriesRef, state.editingId), payload); }
    else {
      const dur = eTs - sTs;
      await push(entriesRef, {task,project,collab,obs,tags,startTime:sTs,endTime:eTs,duration:dur,createdAt:now});
    }
    setSyncStatus('ok','Sincronizado ✓');
    closeModal();
  } catch(err) {
    setSyncStatus('err','Erro ao salvar');
    const errMsg = err?.code==='PERMISSION_DENIED' ? 'Sem permissão para salvar este registro.' : 'Verifique sua conexão e tente novamente.';
    showToast('Erro ao salvar', errMsg);
    console.error('[saveModal]',err);
  } finally {
    if (saveBtn) { saveBtn.disabled=false; saveBtn.style.opacity=''; }
  }
}

// ── deleteEntry ───────────────────────────────────────────────────────────────
export async function deleteEntry(key) {
  if (!confirm('Remover este registro?')) return;
  if (!state.isManager) {
    const e = state.allEntries[key];
    if (e) {
      const ageDays = (Date.now() - e.startTime) / MS_PER_DAY;
      if (ageDays > state.EDIT_WINDOW_DAYS) {
        try {
          await push(approvalRequestsRef, { type:'delete', entryKey:key, payload:e,
            requestedBy:state.currentCollabKey, requestedByEmail:state.currentUser?.email||'',
            requestedAt:Date.now(), status:'pending' });
          if (state.KANBAN_ROLES.gestora[0]) {
            try {
              await push(notifsRef, { to:state.KANBAN_ROLES.gestora[0], title:'Exclusão solicitada',
                msg:`${state.COLLABS[state.currentCollabKey]?.label||state.currentCollabKey} solicitou exclusão de um registro fora da janela de ${state.EDIT_WINDOW_DAYS} dias.`,
                from:state.currentCollabKey, ts:Date.now(), read:false });
            } catch(_){}
          }
          showToast('Solicitação enviada',`Remoção fora da janela de ${state.EDIT_WINDOW_DAYS} dias. A gestora receberá a solicitação para aprovar.`);
        } catch(err) {
          showToast('Erro','Não foi possível enviar a solicitação.');
          console.error('[deleteEntry approval]',err);
        }
        return;
      }
    }
  }
  try { await remove(child(entriesRef, key)); }
  catch(err) { showToast('Erro ao remover','Verifique sua conexão e tente novamente.'); console.error('[deleteEntry]',err); }
}

// ── clearDay ──────────────────────────────────────────────────────────────────
export async function clearDay() {
  const dk     = dKey(state.viewDate);
  const filter = state.isManager ? null : state.currentCollabKey;
  const day    = _ctx.getEntriesForDay(dk, filter);
  if (!day.length) return;
  if (!confirm(`Remover ${day.length} registro(s)?`)) return;
  try {
    for (const e of day) await remove(child(entriesRef, e._key));
  } catch(err) {
    showToast('Erro ao limpar dia','Verifique sua conexão e tente novamente.');
    console.error('[clearDay]',err);
  }
}

// ── KRONOS · DEMANDAS & PÁGINAS ──────────────────────────────────────────────
// Renders: Meu Histórico, Demandas, Projetos, Gráficos, 4 Semanas,
//          Inconsistências, Mural, Desafio, Relatório

import { app as state } from './state.js';
import { ICONS, medalIcon } from './icons.js';
import {
  escH, dKey, dateKey, todayKey, fmtDur, fmtTime, fmtDate, fmtShortDate,
  getWeekDays, getMonthWeeks
} from './utils.js';
import {
  db, entriesRef, muralRef, desafioRef, EQUIPE_ID
} from './firebase-refs.js';
import {
  ref, push, set, remove, get, child, onValue, query, orderByChild, limitToLast
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';
import {
  calcDay, calcAmount, getEntriesArray, getEntriesForDay,
  getCollabAvatar, getDailyGoalMs, chartPalette,
  isActive, renderMeuDashboard, isCapped, capValue, isRankable
} from './dashboard.js';
import { showToast, setSyncStatus, trapFocus, releaseFocus } from './ui.js';
import { resolveSeriesColors } from './colors.js';   // Bloco B: regra de cor gestor-first

// Craft: desenho dos gráficos um pouco mais suave/premium (easing global do Chart.js)
if(typeof Chart !== 'undefined' && Chart.defaults?.animation){
  Chart.defaults.animation.duration = 850;
  Chart.defaults.animation.easing = 'easeOutQuart';
}

export function renderMyHistory(){
  const searchFilter = (document.getElementById('myRecordsSearch')?.value||'').toLowerCase().trim();
  const fromVal = document.getElementById('myRecordsDateFrom')?.value;
  const toVal   = document.getElementById('myRecordsDateTo')?.value;
  // Se só um campo (de/até) for preenchido, filtra apenas aquele dia.
  const _from = fromVal || toVal, _to = toVal || fromVal;
  const fromTs = _from ? new Date(_from + 'T00:00:00').getTime() : null;
  const toTs   = _to   ? new Date(_to   + 'T23:59:59').getTime() : null;

  // Sempre mostra os registros do próprio usuário logado
  const collabKey = state.currentCollabKey;

  let entries = getEntriesArray()
    .filter(([,e]) => {
      if(e.collab !== collabKey) return false;
      // Filtro de período
      const entryTs = e.startTime;
      if(fromTs && entryTs < fromTs) return false;
      if(toTs   && entryTs > toTs)   return false;
      return true;
    })
    .map(([k,e])=>({...e,_key:k}))
    .sort((a,b)=>{
      const ta = Math.max(a.modifiedAt||0, a.endTime||0);
      const tb = Math.max(b.modifiedAt||0, b.endTime||0);
      return tb - ta;
    });

  // Sem filtro de data: limita a 50 para performance
  if(!fromTs && !toTs) entries = entries.slice(0, 50);

  if(searchFilter){
    entries = entries.filter(e=>{
      const task=(e.task||'').toLowerCase();
      const proj=(state.PROJECTS[e.project]?.label||e.project||'').toLowerCase();
      const obs=(e.obs||'').toLowerCase();
      return task.includes(searchFilter)||proj.includes(searchFilter)||obs.includes(searchFilter);
    });
  }
  renderEntriesGrouped('entriesList2', entries, collabKey);
};

// ── ENTRIES LIST ──────────────────────────────────────────────────────────────
export function skeletonEntries(count=3){
  return Array.from({length:count},()=>`
    <div class="skeleton-card">
      <div class="skeleton-row">
        <div class="skeleton skeleton-avatar"></div>
        <div style="flex:1;display:flex;flex-direction:column;gap:6px;">
          <div class="skeleton skeleton-line medium"></div>
          <div class="skeleton skeleton-line short"></div>
        </div>
        <div class="skeleton skeleton-line" style="width:60px;height:20px;border-radius:100px;"></div>
      </div>
    </div>`).join('');
}

const _EMPTY_ENTRIES = `<div class="empty-state">
    <div class="empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div>
    <div class="empty-title">Sem registros</div>
    <div class="empty-text">Inicie o timer ou adicione um registro manualmente.</div>
  </div>`;

// HTML de UM registro (reutilizado pela lista plana e pela agrupada por data)
function _entryItemHTML(e){
  // ✅ SEC: fallbacks escapados — valores podem vir corrompidos do Firebase
  const proj=state.PROJECTS[e.project]||{label:escH(e.project||'?'),color:'#94A3B8'};
  const col=state.COLLABS[e.collab]||{label:escH(e.collab||'?'),initials:'?',color:'#94A3B8'};
  const amt=calcAmount(e.project,e.duration,e.peso);
  const tagsHtml=(e.tags||[]).map(t=>`<span class="entry-tag">${escH(t)}</span>`).join('');
  // ✅ AUDIT: modifiedBy exibido no badge de edição
  const modBadge=e.modifiedAt?`<span class="modified-badge">${ICONS.edit} editado ${fmtTime(e.modifiedAt)}${e.modifiedBy?' por '+escH(e.modifiedBy):''}</span>`:'';
  const canEdit=state.isManager||e.collab===state.currentCollabKey;
  // ✅ FIX BUG 6: verificação segura com fallback para objeto vazio
  const isInKanban = Object.values(state.kanbanCards||{}).some(c => c.fromEntryKey === e._key);
  return`<div class="entry-item">
      <div class="entry-dot" style="background:${proj.color}"></div>
      <div class="entry-main">
        <div class="entry-task" onclick="openEntryDetail('${e._key}')" style="cursor:pointer" title="Ver detalhes do registro">${escH(e.task)}</div>
        <div class="entry-meta">
          <span class="badge collab-badge"><span class="mini-av" style="background:${col.color}">${col.initials}</span>${col.label}</span>
          <span class="badge">${proj.label}</span>
          <span class="badge" style="color:var(--success);border-color:rgba(34,197,94,0.3)">+${amt.toFixed(2)}% amt</span>
          ${modBadge}
        </div>
        ${e.obs?`<div class="entry-obs">"${escH(e.obs)}"</div>`:''}
        ${tagsHtml?`<div class="entry-tags">${tagsHtml}</div>`:''}
      </div>
      <div class="entry-right">
        <div class="entry-date-label" style="font-family:var(--mono);font-size:0.6rem;color:var(--muted);font-weight:600;text-align:right;margin-bottom:2px;">
          ${new Date(e.startTime).toLocaleDateString('pt-BR',{weekday:'short',day:'2-digit',month:'2-digit',year:'numeric'})}
        </div>
        <div class="entry-time-range">
          ${e.periods && e.periods.length > 1
            ? e.periods.map((p,i)=>`<span style="display:block;font-size:0.6rem;">${i>0?'↩ ':''}${fmtTime(p.startTime)} → ${fmtTime(p.endTime)}</span>`).join('')
            : `${fmtTime(e.startTime)} → ${fmtTime(e.endTime)}`
          }
        </div>
        <div class="entry-duration">${fmtDur(e.duration)}</div>
        <div class="entry-actions">
          <button class="btn-add-kanban ${isInKanban ? 'added' : ''}"
            id="kbtn-${e._key}"
            onclick="addEntryToKanban('${e._key}')"
            title="Adicionar ao Fluxo de Demandas"
            ${isInKanban ? 'disabled' : ''}>
            ${isInKanban ? '✅ No Kanban' : 'Curadoria'}
          </button>
          <button class="entry-btn" onclick="restartEntry('${e._key}')" title="Reiniciar esta tarefa" aria-label="Reiniciar e retomar tarefa: ${escH(e.task)}">${ICONS.play}</button>
          ${canEdit?`<button class="entry-btn" onclick="openModal('${e._key}')" title="Editar" aria-label="Editar registro">${ICONS.edit}</button>`:''}
          ${canEdit?`<button class="entry-btn del" onclick="deleteEntry('${e._key}')" title="Remover" aria-label="Remover registro">${ICONS.trash}</button>`:''}
        </div>
      </div>
    </div>`;
}

export function renderEntriesList(listId,day){
  const list=document.getElementById(listId);if(!list)return;
  if(!day.length){list.innerHTML=_EMPTY_ENTRIES;return;}
  list.innerHTML=day.map(_entryItemHTML).join('');
}

// Lista AGRUPADA por data (Meus Registros): cabeçalho recolhível com % e tempo total do dia.
export function renderEntriesGrouped(listId, entries, collabKey){
  const list=document.getElementById(listId);if(!list)return;
  if(!entries.length){list.innerHTML=_EMPTY_ENTRIES;return;}
  // Agrupa preservando a ordem (entries já vêm ordenados do mais recente p/ o mais antigo)
  const order=[]; const groups={};
  for(const e of entries){
    const dk=dKey(new Date(e.startTime));
    if(!groups[dk]){ groups[dk]=[]; order.push(dk); }
    groups[dk].push(e);
  }
  list.innerHTML=order.map(dk=>{
    const day=calcDay(collabKey, dk);
    const [y,m,d]=dk.split('-').map(Number);
    // dKey usa getMonth() (0-indexado), então o mês já é 0-base — NÃO subtrair de novo
    const label=new Date(y,m,d).toLocaleDateString('pt-BR',{weekday:'long',day:'2-digit',month:'long',year:'numeric'});
    const bodyId='egrp_'+dk;
    return `<div class="entry-group">
      <button class="entry-group-header" type="button" onclick="window._toggleEntryGroup('${bodyId}')" aria-expanded="true" aria-controls="${bodyId}">
        <span class="entry-group-caret" id="${bodyId}_caret">▾</span>
        <span class="entry-group-date">${label}</span>
        <span class="entry-group-count">${groups[dk].length} registro${groups[dk].length!==1?'s':''}</span>
        <span class="entry-group-stats">
          <span class="entry-group-time">${fmtDur(day.totalMs)}</span>
          <span class="entry-group-perc">${day.percTotal.toFixed(1)}%</span>
        </span>
      </button>
      <div class="entry-group-body" id="${bodyId}">${groups[dk].map(_entryItemHTML).join('')}</div>
    </div>`;
  }).join('');
}
window._toggleEntryGroup=(id)=>{
  const body=document.getElementById(id); if(!body) return;
  const caret=document.getElementById(id+'_caret');
  const open=body.style.display!=='none';
  body.style.display=open?'none':'';
  if(caret) caret.textContent=open?'▸':'▾';
  const header=body.previousElementSibling;
  if(header) header.setAttribute('aria-expanded', open?'false':'true');
};

// ── PAGE: DASHBOARD ───────────────────────────────────────────────────────────
// renderDashboardOnline → js/dashboard.js
// renderDashboard → js/dashboard.js
// renderDashCards → js/dashboard.js
// renderWeekTable → js/dashboard.js
// ── MEU DASHBOARD (colaborador individual) ────────────────────────────────────

window.mdChangeWeek = (d) => { state.mdWeekOffset += d; renderMeuDashboard(); };
window.mdGoThisWeek = () => { state.mdWeekOffset = 0; renderMeuDashboard(); };

// renderMeuDashboard → js/dashboard.js
// ── DASHBOARD RH ─────────────────────────────────────────────────────────────
// rhWeekOffset, rhChangeWeek, rhGoCurrentWeek → js/dashboard.js

// renderRHDashboard → js/dashboard.js
// ── DEMANDAS DA SEMANA DA DASHBOARD ─────────────────────────────────────────
// renderDashDemandasWeek → js/dashboard.js (registered on window there)
// window.renderDashDemandasWeek = ()=>{
//   if(!Object.keys(state.allEntries).length) return;
//   const days = getWeekDays(state.weekOffset);
//   const collabFilter = document.getElementById('dashDemandasCollab')?.value || '';
//   const searchFilter = (document.getElementById('dashDemandasSearch')?.value||'').toLowerCase().trim();
//   renderDemandasSemana('dashDemandasBody', days, collabFilter, searchFilter);
// };
// 
// // ── DEMANDAS DA SEMANA (reutilizável para gestora e RH) ──────────────────────
// // renderDemandasSemana → js/dashboard.js
// ── PAGE: ONLINE ──────────────────────────────────────────────────────────────
// renderOnline → js/dashboard.js
// ── PAGE: DEMANDAS ────────────────────────────────────────────────────────────

export function renderDemandas(resetPage=false){
  if(resetPage) state._demandasPage = 1;
  const tbody=document.getElementById('demandasBody');
  const dateStart=document.getElementById('filterDateStart')?.value||'';
  const dateEnd=document.getElementById('filterDateEnd')?.value||'';
  const collabFilter=document.getElementById('filterCollabD')?.value||'';
  const projFilter=document.getElementById('filterProjD')?.value||'';
  const searchFilter=(document.getElementById('filterSearchD')?.value||'').toLowerCase().trim();
  // Inativo sai da listagem; os registros seguem no banco e nas exportações CSV
  let data=getEntriesArray().map(([k,e])=>({...e,_key:k})).filter(e=>isActive(e.collab));
  if(dateStart || dateEnd){
    // Se só um campo (de/até) for preenchido, filtra apenas aquele dia.
    const _from = dateStart || dateEnd, _to = dateEnd || dateStart;
    const startTs = new Date(_from+'T00:00:00').getTime();
    const endTs   = new Date(_to  +'T23:59:59').getTime();
    // Inclui a demanda se o início OU qualquer período (reinício em outro dia) cair no intervalo.
    data=data.filter(e=>{
      if(e.startTime >= startTs && e.startTime <= endTs) return true;
      if(Array.isArray(e.periods) && e.periods.some(p=>p.startTime>=startTs && p.startTime<=endTs)) return true;
      return false;
    });
  }
  if(collabFilter)data=data.filter(e=>e.collab===collabFilter);
  if(projFilter)data=data.filter(e=>e.project===projFilter);
  if(searchFilter){
    data=data.filter(e=>{
      const task=(e.task||'').toLowerCase();
      const collab=(state.COLLABS[e.collab]?.label||e.collab||'').toLowerCase();
      const proj=(state.PROJECTS[e.project]?.label||e.project||'').toLowerCase();
      const obs=(e.obs||'').toLowerCase();
      return task.includes(searchFilter)||collab.includes(searchFilter)||proj.includes(searchFilter)||obs.includes(searchFilter);
    });
  }
  data.sort((a,b)=>b.startTime-a.startTime);

  // Barra de ações — só gestora
  const actionsBar=document.getElementById('demandasActionsBar');
  if(actionsBar) actionsBar.style.display=state.isManager?'flex':'none';
  _updateDemandasActionBar();

  const totalResults = data.length;
  const totalPages = Math.ceil(totalResults / state._demandasPageSize);
  if(state._demandasPage > totalPages) state._demandasPage = Math.max(1, totalPages);
  const pageStart = (state._demandasPage - 1) * state._demandasPageSize;
  const pageData = data.slice(pageStart, pageStart + state._demandasPageSize);

  // Paginação UI
  const paginationEl = document.getElementById('demandasPagination');
  if(paginationEl){
    if(totalPages > 1){
      paginationEl.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;padding:10px 0;font-family:var(--mono);font-size:0.72rem;color:var(--muted);">
          <button class="btn-sm" onclick="demandasGoPage(-1,${totalPages})" ${state._demandasPage<=1?'disabled':''} aria-label="Página anterior">${ICONS.back}</button>
          <span>Pág. <strong style="color:var(--text)">${state._demandasPage}</strong> de ${totalPages} · ${totalResults} registros</span>
          <button class="btn-sm" onclick="demandasGoPage(1,${totalPages})" ${state._demandasPage>=totalPages?'disabled':''} aria-label="Próxima página">${ICONS.forward}</button>
        </div>`;
    } else {
      paginationEl.innerHTML = totalResults > 0
        ? `<div style="font-family:var(--mono);font-size:0.65rem;color:var(--muted);padding:6px 0;">${totalResults} registro${totalResults!==1?'s':''}</div>`
        : '';
    }
  }

  if(!pageData.length){tbody.innerHTML=`<tr><td colspan="${state.isManager?11:10}" style="text-align:center;padding:32px;color:var(--muted);font-size:0.82rem">Nenhum registro encontrado.</td></tr>`;return;}
  tbody.innerHTML=pageData.map(e=>{
    const proj=state.PROJECTS[e.project]||{label:escH(e.project||'?'),color:'#94A3B8'};
    const col=state.COLLABS[e.collab]||{label:escH(e.collab||'?'),initials:'?',color:'#94A3B8'};
    const amt=calcAmount(e.project,e.duration,e.peso);
    const modBadge=e.modifiedAt?`<span class="modified-badge" title="Editado por ${escH(e.modifiedBy||'?')} às ${fmtTime(e.modifiedAt)}">${ICONS.edit}</span>`:'';
    const hasPeriods=e.periods&&e.periods.length>1;
    const periodsBadge=hasPeriods?`<span style="font-size:0.65rem;background:var(--orange-light,#fff3e0);color:var(--orange);border-radius:4px;padding:1px 5px;font-weight:700;margin-left:4px">${e.periods.length}×</span>`:'';
    const isSelected=state._demandasSelected.has(e._key);
    const checkCell=state.isManager
      ?`<td style="width:32px;text-align:center"><input type="checkbox" class="demanda-chk" data-key="${e._key}" ${isSelected?'checked':''} onchange="window._toggleDemandasSelect('${e._key}',this.checked)" style="width:15px;height:15px;cursor:pointer;accent-color:var(--orange)"></td>`
      :'';
    return`<tr style="${isSelected?'background:var(--orange-light,#fff7f0);':''}">
      ${checkCell}
      <td><div style="display:flex;align-items:center;gap:6px"><div class="mini-av" style="background:${col.color}">${col.initials}</div><strong>${col.label}</strong></div></td>
      <td style="cursor:pointer" onclick="openEntryDetail('${e._key}')" title="Ver detalhes e histórico">
        <strong style="color:var(--text)">${escH(e.task)}${periodsBadge}</strong>
        <div style="font-size:0.7rem;color:var(--muted)">${new Date(e.startTime).toLocaleDateString('pt-BR')}</div>
      </td>
      <td><span style="color:${proj.color};font-weight:700;font-size:0.78rem">${proj.label}</span></td>
      <td style="font-family:var(--mono);font-size:0.75rem">${fmtTime(e.startTime)}</td>
      <td style="font-family:var(--mono);font-size:0.75rem">${fmtTime(e.endTime)}</td>
      <td style="font-family:var(--mono);font-size:0.75rem">${fmtDur(e.duration)}</td>
      <td style="font-family:var(--mono);font-size:0.75rem;color:var(--success)">+${amt.toFixed(2)}%</td>
      <td>${(e.tags||[]).map(t=>`<span class="entry-tag">${escH(t)}</span>`).join('')}</td>
      <td style="font-size:0.75rem;color:var(--muted);font-style:italic">${escH(e.obs||'—')}</td>
      <td>
        <span onclick="openEntryDetail('${e._key}')" style="cursor:pointer" title="Ver detalhes e histórico">
          ${modBadge||'<span style="color:var(--muted);font-size:0.75rem;opacity:0.5">🔍</span>'}
        </span>
      </td>
    </tr>`;
  }).join('');
};

// ── Helpers de seleção ────────────────────────────────────────────────────────
window._toggleDemandasSelect=(key,checked)=>{
  if(checked)state._demandasSelected.add(key);else state._demandasSelected.delete(key);
  _updateDemandasActionBar();
};
window._selectAllDemandas=(checked)=>{
  document.querySelectorAll('.demanda-chk').forEach(chk=>{
    chk.checked=checked;
    if(checked)state._demandasSelected.add(chk.dataset.key);
    else state._demandasSelected.delete(chk.dataset.key);
  });
  _updateDemandasActionBar();
};
function _updateDemandasActionBar(){
  const bar=document.getElementById('demandasActionsBar');if(!bar)return;
  const count=state._demandasSelected.size;
  const countEl=document.getElementById('demandasSelectedCount');
  const btnRemove=document.getElementById('btnRemoveSelected');
  if(countEl)countEl.textContent=count>0?`${count} selecionado${count>1?'s':''}` :'';
  if(btnRemove){btnRemove.style.display=count>0?'inline-flex':'none';btnRemove.innerHTML=`${ICONS.trash} Remover ${count} registro${count>1?'s':''}`;}
}
window.deleteSelectedDemandas=async()=>{
  if(!state.isManager){showToast('Sem permissão','Apenas a gestora pode remover registros.');return;}
  const count=state._demandasSelected.size;if(!count)return;
  if(!confirm(`Remover ${count} registro${count>1?'s':''} selecionado${count>1?'s':''}? Esta ação não pode ser desfeita.`))return;
  const keys=[...state._demandasSelected];
  state._demandasSelected.clear();_updateDemandasActionBar();
  setSyncStatus('loading','Removendo...');
  let removed=0,failed=0;
  for(const key of keys){
    try{await remove(child(entriesRef,key));removed++;}
    catch(err){failed++;console.error('[deleteSelectedDemandas]',key,err);}
  }
  setSyncStatus('ok','Sincronizado ✓');
  if(failed)showToast('Remoção parcial',`${removed} removidos, ${failed} falharam.`);
  else showToast('Registros removidos',`${removed} registro${removed>1?'s':''} removido${removed>1?'s':''} com sucesso.`);
  renderDemandas();
};

// ── PAGE: PROJETOS ────────────────────────────────────────────────────────────
export function renderProjCards(){
  const dk=dKey(state.projDate);
  document.getElementById('projDateLabel').textContent=fmtDate(state.projDate);
  const dayEntries=getEntriesForDay(dk);
  const container=document.getElementById('projCards');
  const projData=Object.entries(state.PROJECTS).map(([key,p])=>{
    const entries=dayEntries.filter(e=>e.project===key);
    // ✅ FIX: usa _dayDuration para projetos também
    const totalMs=entries.reduce((s,e)=>s+(e._dayDuration??e.duration),0);
    return{key,...p,count:entries.length,totalMs};
  }).filter(p=>p.count>0).sort((a,b)=>b.count-a.count);
  if(!projData.length){container.innerHTML=`<div class="empty-state" style="grid-column:1/-1">
    <div class="empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></div>
    <div class="empty-title">Sem registros</div>
    <div class="empty-text">Nenhuma atividade registrada neste dia.</div>
  </div>`;return;}
  container.innerHTML=projData.map(p=>{
    const h=Math.floor(p.totalMs/3600000),m=Math.floor((p.totalMs%3600000)/60000);
    return`<div class="proj-card">
      <div class="proj-card-header"><div class="proj-dot" style="background:${p.color}"></div><div class="proj-name">${p.label}</div></div>
      <div class="proj-count">${p.count}</div>
      <div class="proj-hours" style="color:var(--muted)">${h}h ${String(m).padStart(2,'0')}m total</div>
      <div class="proj-hours">+${(p.count>0?calcAmount(p.key,p.totalMs):0).toFixed(1)}% amount</div>
    </div>`;
  }).join('');
}

// ── PAGE: GRÁFICOS ────────────────────────────────────────────────────────────
// ✅ NOVO: controles de data para os gráficos
window._chartsDayKey = null; // null = hoje
window.changeChartsWeek = (d)=>{ state.chartsWeekOffset+=d; renderCharts(); };
window.goChartsCurrentWeek = ()=>{ state.chartsWeekOffset=0; window._chartsDayKey=null; renderCharts(); };
window.setChartsDay = (val)=>{
  if(!val){ window._chartsDayKey=null; }
  else{ const[y,m,d]=val.split('-').map(Number); window._chartsDayKey=dKey(new Date(y,m-1,d)); }
  renderCharts();
};

// ── Helper de cores para Chart.js respeitando dark mode ───────────────────
// chartPalette → js/dashboard.js
export function renderCharts(){
  const tk=todayKey();
  // ✅ NOVO: usa state.chartsWeekOffset dedicado para os gráficos (independente da tabela semanal)
  const days=getWeekDays(state.chartsWeekOffset);
  // ✅ NOVO: pizza e ranking usam o dia selecionado (chartsDayKey)
  const chartsDk = window._chartsDayKey || tk;
  const cp = chartPalette();
  Object.values(state.charts).forEach(c=>{try{c.destroy();}catch(e){}});
  state.charts={};
  const projHours={};
  getEntriesForDay(chartsDk).forEach(e=>{projHours[e.project]=(projHours[e.project]||0)+e.duration/3600000;});
  const pizzaKeys=Object.keys(projHours).filter(k=>projHours[k]>0);
  if(pizzaKeys.length&&document.getElementById('chartPizza')){
    const pizzaColors=resolveSeriesColors(pizzaKeys.map(k=>state.PROJECTS[k]?.color||'#94A3B8'), pizzaKeys.map(k=>projHours[k]));
    state.charts.pizza=new Chart(document.getElementById('chartPizza'),{
      type:'doughnut',
      data:{labels:pizzaKeys.map(k=>state.PROJECTS[k]?.label||k),datasets:[{data:pizzaKeys.map(k=>projHours[k].toFixed(2)),backgroundColor:pizzaColors,borderWidth:2,borderColor:cp.surface}]},
      options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'right',labels:{font:{size:11},color:cp.legend}}}}
    });
  }
  // isRankable = ativo E não-gestor: inativo sai das análises (o histórico de registros continua)
  const collabRank=Object.keys(state.COLLABS).filter(k=>isRankable(k)).map(k=>({...state.COLLABS[k],...calcDay(k,chartsDk)})).sort((a,b)=>b.percTotal-a.percTotal);
  if(document.getElementById('chartRanking')){
    state.charts.ranking=new Chart(document.getElementById('chartRanking'),{
      type:'bar',
      data:{labels:collabRank.map(c=>c.label),datasets:[{label:'% Total',data:collabRank.map(c=>c.percTotal.toFixed(1)),backgroundColor:collabRank.map(c=>c.color),borderRadius:6}]},
      options:{responsive:true,maintainAspectRatio:false,indexAxis:'y',plugins:{legend:{display:false}},scales:{x:{grid:{color:cp.grid},ticks:{color:cp.tick,font:{size:10}}},y:{ticks:{color:cp.tick,font:{size:11}}}}}
    });
  }
  if(document.getElementById('chartLinha')){
    state.charts.linha=new Chart(document.getElementById('chartLinha'),{
      type:'line',
      data:{
        labels:days.map(d=>fmtShortDate(d)),
        datasets:Object.keys(state.COLLABS).filter(k=>isActive(k)).map((k)=>({
          label:state.COLLABS[k].label,
          data:days.map(d=>calcDay(k,dKey(d)).percTotal.toFixed(1)),
          borderColor:state.COLLABS[k].color,backgroundColor:state.COLLABS[k].color+'22',
          tension:0.4,fill:false,pointRadius:4,borderWidth:2
        }))
      },
      options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{font:{size:10},color:cp.legend}}},scales:{y:{grid:{color:cp.grid},ticks:{color:cp.tick,font:{size:10}}},x:{ticks:{color:cp.tick,font:{size:10}}}}}
    });
  }
  if(document.getElementById('chartBarras')){
    const topProjs=Object.keys(state.PROJECTS).filter(k=>days.some(d=>getEntriesForDay(dKey(d)).some(e=>e.project===k))).slice(0,5);
    const barTotals=topProjs.map(k=>days.reduce((s,d)=>s+getEntriesForDay(dKey(d)).filter(e=>e.project===k).reduce((a,e)=>a+e.duration/3600000,0),0));
    const barColors=resolveSeriesColors(topProjs.map(k=>state.PROJECTS[k]?.color||'#94A3B8'), barTotals);
    state.charts.barras=new Chart(document.getElementById('chartBarras'),{
      type:'bar',
      data:{
        labels:days.map(d=>fmtShortDate(d)),
        datasets:topProjs.map((k,i)=>({
          label:state.PROJECTS[k].label,
          data:days.map(d=>(getEntriesForDay(dKey(d)).filter(e=>e.project===k).reduce((s,e)=>s+e.duration/3600000,0)).toFixed(2)),
          backgroundColor:barColors[i]+'CC',borderRadius:4
        }))
      },
      options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{font:{size:10},color:cp.legend}}},scales:{x:{stacked:false,ticks:{color:cp.tick,font:{size:10}}},y:{stacked:false,ticks:{color:cp.tick,font:{size:10}},grid:{color:cp.grid}}}}
    });
  }
}

// ── PAGE: 4 SEMANAS ───────────────────────────────────────────────────────────
// ── HISTÓRICO MENSAL UNIFICADO ───────────────────────────────────────────────
// Reúne o gráfico de linhas (4 semanas do mês) + navegação por mês + ranking mensal

window.changeHist4Month = (d)=>{
  state.hist4Month += d;
  if(state.hist4Month < 0){ state.hist4Month = 11; state.hist4Year--; }
  if(state.hist4Month > 11){ state.hist4Month = 0; state.hist4Year++; }
  render4Weeks();
};
window.goHist4Current = ()=>{
  state.hist4Year = new Date().getFullYear();
  state.hist4Month = new Date().getMonth();
  render4Weeks();
};
// Escalabilidade #6: pular direto para qualquer mês/ano (não só ◀▶)
window.jumpHist4 = (val)=>{
  if(!val) return;
  const [y,m] = val.split('-').map(Number);
  if(!y || !m) return;
  state.hist4Year = y; state.hist4Month = m - 1;
  render4Weeks();
};

// getMonthWeeks → js/utils.js

export function render4Weeks(){
  const y = state.hist4Year, m = state.hist4Month;
  const weeks = getMonthWeeks(y, m);
  const weekLabels = weeks.map(w=>`${w[0].toLocaleDateString('pt-BR',{day:'2-digit',month:'short'})}`);

  // Atualiza label do mês
  const monthLabel = new Date(y,m,1).toLocaleDateString('pt-BR',{month:'long',year:'numeric'});
  const labelEl = document.getElementById('hist4MonthLabel');
  if(labelEl) labelEl.textContent = monthLabel.charAt(0).toUpperCase()+monthLabel.slice(1);
  const pickEl = document.getElementById('hist4MonthPicker');   // #6: mantém o seletor em sincronia
  if(pickEl) pickEl.value = `${y}-${String(m+1).padStart(2,'0')}`;

  // F10: subtítulo "<mês> — N semanas" removido (não é necessário)
  const numWeeks = weeks.length;   // ainda usado no ranking ("N sem.")
  const subEl = document.getElementById('hist4Sub');
  if(subEl) subEl.textContent = '';

  // Gráfico de linhas
  try{state.charts.w4?.destroy();}catch(e){}
  if(document.getElementById('chartMensal')){
    state.charts.w4=new Chart(document.getElementById('chartMensal'),{
      type:'line',
      data:{
        labels:weekLabels,
        datasets:Object.keys(state.COLLABS).filter(k=>isActive(k)).map(k=>{
          const _gestor=!isRankable(k);   // gestores aparecem (linha tracejada + "(Gestão)")
          return {
          label:state.COLLABS[k].label+(_gestor?' (Gestão)':''),
          data:weeks.map(w=>{
            // aplica o piso de 100% (capDia) por dia, igual à tabela semanal
            const avgs=w.map(d=>{const dk=dKey(d);const cd=calcDay(k,dk);return cd.count>0?(isCapped(k,dk)?capValue(cd.percTotal):cd.percTotal):0;});
            const active=avgs.filter(v=>v>0);
            return active.length?(active.reduce((s,v)=>s+v,0)/active.length).toFixed(1):0;
          }),
          borderColor:state.COLLABS[k].color,backgroundColor:state.COLLABS[k].color+'22',
          borderDash:_gestor?[6,4]:[],
          tension:0.4,fill:false,pointRadius:5,borderWidth:2
          };
        })
      },
      options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{font:{size:11},color:chartPalette().legend}}},scales:{y:{grid:{color:chartPalette().grid},ticks:{color:chartPalette().tick,font:{size:10}}},x:{ticks:{color:chartPalette().tick,font:{size:10}}}}}
    });
  }

  // Ranking mensal do mês selecionado
  const monthDays = [];
  const md = new Date(y,m,1);
  while(md.getMonth()===m){monthDays.push(new Date(md));md.setDate(md.getDate()+1);}
  // média mensal com piso de 100% (capDia) aplicado por dia — mesma lógica da semana
  const _monthAvg=(k)=>{
    let sum=0, active=0;
    monthDays.forEach(d=>{
      const dk=dKey(d); const cd=calcDay(k,dk);
      if(cd.count>0){ active++; sum += (isCapped(k,dk)?capValue(cd.percTotal):cd.percTotal); }
    });
    return { avg: active?sum/active:0, activeDays:active };
  };
  // Colaboradores entram no ranking; gestores aparecem, mas SEM posição de destaque.
  const ranking = Object.keys(state.COLLABS).filter(k=>isActive(k)&&isRankable(k))
    .map(k=>({...state.COLLABS[k],key:k,..._monthAvg(k)})).sort((a,b)=>b.avg-a.avg);
  const gestores = Object.keys(state.COLLABS).filter(k=>isActive(k)&&!isRankable(k))
    .map(k=>({...state.COLLABS[k],key:k,..._monthAvg(k)})).sort((a,b)=>b.avg-a.avg);
  const max=ranking[0]?.avg||1;
  const _rankItem=(c,posHtml,highlight)=>`<div class="ranking-item" style="${highlight?'border-color:var(--orange-border);background:var(--orange-light);':''}${posHtml==='__GESTAO__'?'opacity:0.92;':''}">
      <div class="ranking-pos">${posHtml==='__GESTAO__'?`<span style="font-size:0.5rem;font-weight:800;color:var(--orange);text-transform:uppercase;letter-spacing:0.3px;">Gestão</span>`:posHtml}</div>
      <div class="ranking-av" style="background:${c.color}">${c.initials}</div>
      <div class="ranking-name">${c.label}<div style="font-size:0.65rem;color:var(--muted);font-weight:600">${c.activeDays} dias ativos · ${numWeeks} sem.</div></div>
      <div class="ranking-bar-wrap"><div class="ranking-bar-track"><div class="ranking-bar-fill" style="width:${(c.avg/max*100).toFixed(0)}%;background:${c.color}"></div></div></div>
      <div class="ranking-val">${c.avg.toFixed(1)}%<div style="font-size:0.6rem;color:var(--muted)">média/dia</div></div>
    </div>`;
  const rankEl = document.getElementById('rankingList4w');
  if(rankEl) rankEl.innerHTML =
    ranking.map((c,i)=>_rankItem(c, medalIcon(i+1), i===0)).join('') +
    gestores.map(c=>_rankItem(c, '__GESTAO__', false)).join('');
}


// ── PAGE: INCONSISTÊNCIAS ─────────────────────────────────────────────────────
export function renderInconsistencias(){
  const alerts=[];
  const today=new Date();today.setHours(0,0,0,0);
  for(let i=0;i<7;i++){
    const d=new Date(today);d.setDate(today.getDate()-i);
    const dk=dKey(d);const dayStr=d.toLocaleDateString('pt-BR',{weekday:'short',day:'2-digit',month:'2-digit'});
    if(d.getDay()===0)continue;
    // Inativo não registra mais: sem o filtro, viraria um "sem registros" diário eterno
    Object.keys(state.COLLABS).filter(k=>isActive(k)).forEach(k=>{
      const data=calcDay(k,dk);
      if(data.count===0&&i<5){alerts.push({type:'warn',icon:'👻',text:`${state.COLLABS[k].label} sem registros`,sub:`${dayStr} — nenhum registro encontrado`});}
      else if(data.totalMs>10*3600000){alerts.push({type:'warn',icon:'⏰',text:`${state.COLLABS[k].label} com mais de 10h registradas`,sub:`${dayStr} — ${(data.totalMs/3600000).toFixed(1)}h registradas`});}
      data.entries.filter(e=>e.duration<5*60*1000).forEach(e=>{alerts.push({type:'danger',icon:'⚡',text:`Registro muito curto: "${escH(e.task)}"`,sub:`${state.COLLABS[k].label} · ${dayStr} · ${fmtDur(e.duration)}`});});
    });
  }
  const list=document.getElementById('inconList');
  if(!alerts.length){list.innerHTML=`<div class="empty-state">
    <div class="empty-icon" style="color:var(--success);border-color:var(--success-border);background:var(--success-bg);"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></div>
    <div class="empty-title" style="color:var(--success)">Tudo certo!</div>
    <div class="empty-text">Nenhuma inconsistência encontrada nos últimos 7 dias.</div>
  </div>`;return;}
  list.innerHTML=alerts.slice(0,20).map(a=>`<div class="incon-item ${a.type}"><div class="incon-icon">${a.icon}</div><div><div class="incon-text">${a.text}</div><div class="incon-sub">${a.sub}</div></div></div>`).join('');
}

// ── MURAL DA EQUIPE ──────────────────────────────────────────────────────────

export function initMuralListener() {
  return onValue(query(muralRef, orderByChild('ts'), limitToLast(20)),(snap)=>{
  state.muralPosts = snap.val() || {};
  renderMural();
  });
}

function renderMural(){
  const container = document.getElementById('muralPosts');
  if(!container) return;
  const posts = Object.entries(state.muralPosts)
    .map(([k,v])=>({...v,_key:k}))
    .sort((a,b)=>b.ts-a.ts)
    .slice(0,15);
  const count = document.getElementById('muralCount');
  if(count) count.textContent = posts.length ? `${posts.length} posts` : '';
  if(!posts.length){
    container.innerHTML=`<div style="font-size:0.72rem;color:var(--muted);text-align:center;padding:8px">Seja o primeiro a postar! 👋</div>`;
    return;
  }
  container.innerHTML = posts.map(p=>{
    const col = state.COLLABS[p.collab]||{initials:'?',color:'#94A3B8',label:'?'};
    const time = new Date(p.ts).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
    const date = new Date(p.ts).toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'});
    const isToday = new Date(p.ts).toDateString()===new Date().toDateString();
    const canDelete = state.isManager || p.collab===state.currentCollabKey;
    return `<div class="mural-post" style="position:relative;">
      <div class="mural-post-header">
        <div class="mural-post-av" style="background:${col.color}">${col.initials}</div>
        <span class="mural-post-name">${col.label}</span>
        <span class="mural-post-time">${isToday?time:date}</span>
        ${canDelete?`<button onclick="deleteMuralPost('${p._key}')" title="Excluir" aria-label="Excluir post" style="background:none;border:none;color:var(--muted);cursor:pointer;padding:0 2px;display:flex;align-items:center;margin-left:auto;transition:color 0.2s;" onmouseover="this.style.color='var(--danger)'" onmouseout="this.style.color='var(--muted)'">${ICONS.x}</button>`:''}
      </div>
      <div class="mural-post-text">${escH(p.text)}</div>
    </div>`;
  }).join('');
}

window.clearMural = async()=>{
  if(!state.isManager){ showToast('Sem permissão','Apenas a gestora pode limpar o mural.'); return; }
  const count = Object.keys(state.muralPosts).length;
  if(!count) return;
  if(!confirm(`Limpar todos os ${count} posts do mural?`)) return;
  await set(muralRef, null);
  showToast('Mural limpo','Todos os posts foram removidos.');
};

window.deleteMuralPost = async(key)=>{
  const post = state.muralPosts[key];
  if(!post) return;
  if(!state.isManager && post.collab !== state.currentCollabKey){
    showToast('Sem permissão','Você só pode excluir seus próprios posts.'); return;
  }
  await remove(child(muralRef, key));
  showToast('Post removido','');
};

window.sendMuralPost = async()=>{
  const input = document.getElementById('muralInput');
  const text = input?.value.trim();
  if(!text || !state.currentUser) return;
  await push(muralRef,{text,collab:state.currentCollabKey,ts:Date.now()});
  input.value = '';
  showToast('Mural','Mensagem publicada! 💬');
};
document.addEventListener('keydown',e=>{
  if(e.target?.id==='muralInput'&&e.key==='Enter') window.sendMuralPost();
});

// ── DESAFIO DO DIA ────────────────────────────────────────────────────────────

export function initDesafioListener() {
  return onValue(desafioRef,(snap)=>{
  const data = snap.val();
  const banner = document.getElementById('desafioBanner');
  const editBtn = document.getElementById('desafioEditBtn');
  if(!banner) return;
  const isToday = data?.date === new Date().toLocaleDateString('pt-BR');
  if(data?.text && isToday){
    document.getElementById('desafioText').textContent = data.text;
    banner.style.display = 'flex';
    if(editBtn) editBtn.style.display = state.isManager?'block':'none';
  } else {
    banner.style.display = 'none';
  }
  });
}

window.openDesafioModal = ()=>{
  const cur = document.getElementById('desafioText')?.textContent||'';
  document.getElementById('desafioModalInput').value = cur;
  const overlay = document.getElementById('desafioOverlay');
  overlay.classList.add('open');
  // A11y: prende o foco no modal e fecha com Escape (paridade com os demais modais)
  overlay.onkeydown = (e)=>{ if(e.key==='Escape') window.closeDesafioModal(); };
  trapFocus(overlay);
  document.getElementById('desafioModalInput')?.focus();
};
window.closeDesafioModal = ()=>{
  releaseFocus();
  document.getElementById('desafioOverlay').classList.remove('open');
};
window.saveDesafio = async()=>{
  const text = document.getElementById('desafioModalInput').value.trim();
  if(!text) return;
  await set(desafioRef,{text,date:new Date().toLocaleDateString('pt-BR'),by:state.currentCollabKey,ts:Date.now()});
  closeDesafioModal();
  showToast('Desafio publicado!','O desafio do dia apareceu para toda a equipe! 🎯');
};
window.clearDesafio = async()=>{
  await set(desafioRef,null);
  closeDesafioModal();
};

window.relChangeWeek  = d => { state.relWeekOffset += d; renderRelatorio(); };
window.relGoThisWeek  = ()=> { state.relWeekOffset = 0;  renderRelatorio(); };

// Mapa de tipos a partir das tags
const REL_TIPOS = [
  'Antigas','Trilha do Conhecimento','Pós-graduação','Projeto | Práticas',
  'Graduação','Simulado ENADE','UC - Diagramação','Adaptadas'
];

// CUR = passou de em_curadoria (está em aguardando_ajustes ou além)
// AJU = passou de aguardando_ajustes (está em recuradoria ou além)
// LIB = está em finalizacao, liberacao ou concluido
// A1: a ordem das colunas vem da config da equipe — não mais fixa à Diagramação.
// As marcas CUR/AJU/LIB abaixo só fazem sentido em equipes cujas colunas tenham
// esses ids; nas demais ficam neutras ("—"). (Este relatório será removido em G2.)
function _colIndex(colId){ return (state.K_COLS||[]).findIndex(c=>c.id===colId); }

function _cardStatusForEntry(entryKey){
  const card = Object.values(state.kanbanCards||{}).find(c=>c.fromEntryKey===entryKey);
  if(!card) return {cur:false,aju:false,lib:false};
  const idx = _colIndex(card.column||'standby');
  return {
    cur: idx >= _colIndex('aguardando_ajustes'),
    aju: idx >= _colIndex('recuradoria'),
    lib: idx >= _colIndex('finalizacao')
  };
}

function _weekOfMonth(date){
  const d = new Date(date.getFullYear(), date.getMonth(), 1);
  return Math.ceil((date.getDate() + d.getDay()) / 7);
}

function _fmt(val){ return val ? 'OK' : '—'; }

export function renderRelatorio(){
  const days   = getWeekDays(state.relWeekOffset);
  const startTs = days[0].getTime();
  const endTs   = new Date(days[5].getFullYear(), days[5].getMonth(), days[5].getDate(), 23,59,59).getTime();

  // Label da semana
  const fmt = d => d.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'});
  const labelEl = document.getElementById('relWeekLabel');
  if(labelEl) labelEl.textContent = `${fmt(days[0])} a ${fmt(days[5])} de ${days[0].getFullYear()}`;

  // Entries da semana (o antigo filtro por DISC_PROJECTS era código morto — removido)
  const weekEntries = getEntriesArray()
    .map(([k,e])=>({...e,_key:k}))
    .filter(e=>{
      const t = e.startTime;
      return t>=startTs && t<=endTs && isActive(e.collab);
    });

  // ── TABELA PRODUÇÃO ──────────────────────────────────────────────────────
  const prodBody = document.getElementById('relProducaoBody');
  const prodResumo = document.getElementById('relProducaoResumo');

  // Deduplica por entry key (cada entry = uma disciplina)
  const seen = new Set();
  const prodRows = [];
  weekEntries.forEach(e=>{
    if(seen.has(e._key)) return;
    seen.add(e._key);
    const collab = state.COLLABS[e.collab]?.label || e.collab || '—';
    const tags = e.tags || [];
    const formato = tags.find(t=>['PDF','HTML'].includes(t.toUpperCase()))?.toUpperCase() || '—';
    const padrao  = tags.filter(t=>!['PDF','HTML'].includes(t.toUpperCase())).join(', ') || '—';
    const d = new Date(e.startTime);
    const mes = d.toLocaleDateString('pt-BR',{month:'long'});
    const semana = `Semana ${_weekOfMonth(d)}`;
    const status = _cardStatusForEntry(e._key);
    prodRows.push({mes,semana,collab,formato,padrao,disciplina:e.task||'—',status});
  });

  // Ordenar: mês, semana, diagramador, disciplina
  prodRows.sort((a,b)=>a.disciplina.localeCompare(b.disciplina));

  const finalizadas = prodRows.filter(r=>r.status.lib).length;
  const emAndamento = prodRows.length - finalizadas;
  if(prodResumo) prodResumo.textContent = `${prodRows.length} disciplinas — ${finalizadas} finalizadas — ${emAndamento} em andamento`;

  if(prodBody){
    if(!prodRows.length){
      prodBody.innerHTML=`<tr><td colspan="9" style="text-align:center;padding:24px;color:var(--muted);">Nenhum registro encontrado para esta semana.</td></tr>`;
    } else {
      prodBody.innerHTML = prodRows.map(r=>`<tr>
        <td style="text-transform:capitalize">${r.mes}</td>
        <td>${r.semana}</td>
        <td>${escH(r.collab)}</td>
        <td><strong>${escH(r.formato)}</strong></td>
        <td style="font-size:0.78rem;color:var(--muted)">${escH(r.padrao)}</td>
        <td><strong>${escH(r.disciplina)}</strong></td>
        <td style="text-align:center;color:${r.status.cur?'var(--success)':'var(--muted)'};font-weight:700">${_fmt(r.status.cur)}</td>
        <td style="text-align:center;color:${r.status.aju?'var(--success)':'var(--muted)'};font-weight:700">${_fmt(r.status.aju)}</td>
        <td style="text-align:center;color:${r.status.lib?'var(--success)':'var(--muted)'};font-weight:700">${_fmt(r.status.lib)}</td>
      </tr>`).join('');
    }
  }

  // ── TABELA DEMANDAS ──────────────────────────────────────────────────────
  const demBody   = document.getElementById('relDemandasBody');
  const demPeriodo = document.getElementById('relDemandasPeriodo');
  if(demPeriodo) demPeriodo.textContent = `${fmt(days[0])} a ${fmt(days[5])}`;

  // Conta por tipo × formato, usando entries da semana
  const demCounts = {};
  REL_TIPOS.forEach(t=>{ demCounts[t]={PDF:0,HTML:0}; });

  weekEntries.forEach(e=>{
    const tags = e.tags||[];
    const formato = tags.find(t=>['PDF','HTML'].includes(t.toUpperCase()))?.toUpperCase();
    if(!formato) return;
    const tipo = REL_TIPOS.find(t=> tags.some(tag=> tag.toLowerCase()===t.toLowerCase()));
    if(!tipo) return;
    demCounts[tipo][formato]++;
  });

  let totalPDF=0, totalHTML=0;
  if(demBody){
    demBody.innerHTML = REL_TIPOS.map(tipo=>{
      const pdf  = demCounts[tipo].PDF;
      const html = demCounts[tipo].HTML;
      totalPDF  += pdf;
      totalHTML += html;
      return `<tr>
        <td>${tipo}</td>
        <td style="text-align:center;font-weight:${pdf?700:400};color:${pdf?'var(--text)':'var(--muted)'};">${pdf||'—'}</td>
        <td style="text-align:center;font-weight:${html?700:400};color:${html?'var(--text)':'var(--muted)'};">${html||'—'}</td>
      </tr>`;
    }).join('') + `<tr style="background:var(--surface2);font-weight:800;border-top:2px solid var(--border);">
        <td>REALIZADOS</td>
        <td style="text-align:center;font-size:1rem;">${totalPDF}</td>
        <td style="text-align:center;font-size:1rem;">${totalHTML}</td>
      </tr>`;
  }

  // ── RESUMO AUTOMÁTICO ─────────────────────────────────────────────────────
  window.relGerarResumo?.(prodRows, finalizadas, emAndamento, totalPDF, totalHTML, days);
}

// ── Window registrations ──────────────────────────────────────────────────────
// Paginação das Demandas: handler global (onclick inline roda no escopo do window,
// onde `state` não existe — por isso os botões manipulam a página por aqui).
window.demandasGoPage = (delta, totalPages) => {
  const max = totalPages || 1;
  state._demandasPage = Math.min(max, Math.max(1, (state._demandasPage || 1) + delta));
  renderDemandas();
};
window.renderDemandas   = renderDemandas;
window.renderMyHistory  = renderMyHistory;

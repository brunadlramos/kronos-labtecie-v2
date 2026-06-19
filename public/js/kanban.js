// ── KRONOS · KANBAN ─────────────────────────────────────────────────────────
// Render, CRUD e timer do quadro Kanban

import { app as state } from './state.js';
import { ICONS }        from './icons.js';
import {
  escH, dKey, fmtDur, fmtTime, fmtDate, fmtShortDate,
  todayKey, getWeekDays, sanitizeUrl, resizeImageToDataURL
} from './utils.js';
import {
  db, kanbanRef, entriesRef, approvalRequestsRef, notifsRef,
  usersRef, avatarsRef, arquivoRef, activeTimersRef, indicadoresManuaisRef, EQUIPE_ID
} from './firebase-refs.js';
import {
  ref, push, set, update, get, remove, child, onValue, query, orderByChild
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';
import { isActive, calcDay, getCollabAvatar, getDailyGoalMs, renderDashCards } from './dashboard.js';
import { showToast, setSyncStatus, trapFocus, releaseFocus, renderDebounced } from './ui.js';
import { stopTimer }                 from './timer.js';
import { registrarLog }              from './log.js';

export function isManagerUser(){
  return state.currentUser && (state.userPapel === 'gestora' || state.userPapel === 'admin');
}
export function isCuradora(userKey){
  return state.KANBAN_ROLES.curadoras.includes(userKey) || isManagerUser();
}
export function isRecuradora(userKey){
  return state.KANBAN_ROLES.recuradoria.includes(userKey) || isManagerUser();
}

// ── MÚLTIPLOS RESPONSÁVEIS ────────────────────────────────────────────────────
// Fonte da verdade: card.assignees[] (array, pode ser vazio = sem responsável).
// card.assignee continua existindo como "principal" (= assignees[0]) para manter
// compatível filtros/relatórios/notificações antigos que liam um único responsável.
export function kCardAssignees(card){
  if(Array.isArray(card?.assignees) && card.assignees.length) return card.assignees.filter(Boolean);
  return card?.assignee ? [card.assignee] : [];
}
export function kIsAssignee(card, key){
  return !!key && kCardAssignees(card).includes(key);
}

// Chips de seleção de responsáveis no modal (substitui o <select> único).
// _kcAssignees preserva a ORDEM de seleção → o 1º é o responsável principal.
let _kcAssignees = [];
function _renderKcAssignees(){
  const wrap = document.getElementById('kcAssigneeWrap');
  if(!wrap) return;
  const entries = Object.entries(state.COLLABS||{})
    .filter(([,c])=>c.active!==false)
    .sort((a,b)=>(a[1].label||'').localeCompare(b[1].label||'','pt-BR'));
  wrap.innerHTML = entries.map(([k,c])=>{
    const idx = _kcAssignees.indexOf(k);
    const on  = idx>=0;
    const order = (on && _kcAssignees.length>1) ? `<span class="kc-assignee-order">${idx+1}</span>` : '';
    return `<button type="button" class="kc-assignee-chip${on?' on':''}" data-collab="${escH(k)}" aria-pressed="${on}" onclick="toggleKcAssignee('${escH(k)}')"><span class="kc-assignee-av" style="background:${c.color||'#94A3B8'}">${escH(c.initials||'?')}</span>${escH(c.label||k)}${order}</button>`;
  }).join('') || '<span style="font-size:0.72rem;color:var(--muted);padding:4px;">Nenhum colaborador ativo</span>';
}
window.toggleKcAssignee = (k)=>{
  const i = _kcAssignees.indexOf(k);
  if(i>=0) _kcAssignees.splice(i,1); else _kcAssignees.push(k);
  _renderKcAssignees();
};
function _setKcAssignees(keys){ _kcAssignees = [...new Set((keys||[]).filter(Boolean))]; _renderKcAssignees(); }
function _getKcAssignees(){ return [..._kcAssignees]; }

export function _refreshKanbanTypeFilter(){
  const sel = document.getElementById('kanbanFilterType');
  if(!sel) return;
  const cur = sel.value;
  // Pega todas as tags únicas usadas nos cards atuais + state.customTags
  const usedTags = new Set();
  Object.values(state.kanbanCards||{}).forEach(c=>(c.tags||[]).forEach(t=>usedTags.add(t)));
  (state.customTags||[]).forEach(t=>usedTags.add(t));
  const sorted = [...usedTags].sort((a,b)=>a.localeCompare(b,'pt-BR'));
  sel.innerHTML = `<option value="">Todos os tipos</option>` +
    sorted.map(t=>`<option value="${escH(t)}">${escH(t)}</option>`).join('');
  if(cur && sel.querySelector(`option[value="${cur}"]`)) sel.value = cur;
}

function _refreshArquivoTypeFilter(){
  const sel = document.getElementById('arquivoTypeFilter');
  if(!sel) return;
  const cur = sel.value;
  const usedTags = new Set();
  Object.values(state.arquivoCards||{}).forEach(c=>(c.tags||[]).forEach(t=>usedTags.add(t)));
  Object.values(state.kanbanCards||{}).filter(c=>c.archived).forEach(c=>(c.tags||[]).forEach(t=>usedTags.add(t)));
  (state.customTags||[]).forEach(t=>usedTags.add(t));
  const sorted = [...usedTags].sort((a,b)=>a.localeCompare(b,'pt-BR'));
  sel.innerHTML = `<option value="">Todos os tipos</option>` +
    sorted.map(t=>`<option value="${escH(t)}">${escH(t)}</option>`).join('');
  if(cur && sel.querySelector(`option[value="${escH(cur)}"]`)) sel.value = cur;
}

// Reconstrói o select de colunas do kanban no modal de nova disciplina
export function _refreshKColSelect(){
  const sel = document.getElementById('kcColumn');
  if(!sel || !state.K_COLS.length) return;
  const cur = sel.value;
  sel.innerHTML = state.K_COLS.map(c=>`<option value="${c.id}">${escH(c.label)}</option>`).join('');
  if(cur && sel.querySelector(`option[value="${cur}"]`)) sel.value = cur;
  else if(state.K_COLS.length) sel.value = state.K_COLS[0].id;
}

// K_MOVE_PERMS removido (A9): era código morto — kCanMove adota o modelo livre
// (Trello), sem permissões por coluna hardcoded à Diagramação.

const K_TIMER_COLS = {
  em_curadoria:       {project:'curadoria',  label:'Iniciar curadoria'},
  aguardando_ajustes: {project:'ajustes',    label:'Iniciar ajustes'},
  recuradoria:        {project:'recuradoria',label:'Iniciar recuradoria'},
  finalizacao:        {project:'ajustes',    label:'Iniciar finalização'},
};

const K_LABEL_COLORS = {
  'PDF - Graduação':     {bg:'#dcfce7',border:'#86efac',color:'#16a34a'},
  'PDF - Pós-graduação': {bg:'#dcfce7',border:'#86efac',color:'#16a34a'},
  'PDF - Antigas':       {bg:'#dcfce7',border:'#86efac',color:'#16a34a'},
  'PDF - Material de Leitura':{bg:'#dcfce7',border:'#86efac',color:'#16a34a'},
  'PDF-Outros':          {bg:'#dcfce7',border:'#86efac',color:'#16a34a'},
  'HTML':                {bg:'#fef9c3',border:'#fde047',color:'#ca8a04'},
  'HTML-Pós Graduação':  {bg:'#fef9c3',border:'#fde047',color:'#ca8a04'},
  'HTML-Outros':         {bg:'#fef9c3',border:'#fde047',color:'#ca8a04'},
  'ENADE':               {bg:'#dbeafe',border:'#93c5fd',color:'#1d4ed8'},
  'CURSO PROFISSIONALIZANTE':{bg:'#f3e8ff',border:'#d8b4fe',color:'#7c3aed'},
  'TRILHA DO CONHECIMENTO':{bg:'#fce7f3',border:'#f9a8d4',color:'#be185d'},
  'Antigas':             {bg:'#fee2e2',border:'#fca5a5',color:'#dc2626'},
  'STANDBY':             {bg:'#fee2e2',border:'#fca5a5',color:'#dc2626'},
};

// A8: cor da tag vem da config da equipe (state.customTagColors), com o mapa legado
// da Diagramação como fallback e cinza neutro para tags sem cor definida.
const _K_LABEL_FALLBACK = {bg:'#f1f5f9',border:'#cbd5e1',color:'#475569'};
function kLabelColor(tag){
  return (state.customTagColors && state.customTagColors[tag])
    || K_LABEL_COLORS[tag]
    || _K_LABEL_FALLBACK;
}

// initKanban — configura o listener de kanban para a equipe atual
export function initKanban() {
  return onValue(kanbanRef,(snap)=>{
  const fresh = snap.val()||{};
  // Merge inteligente: para cada card, preserva SEMPRE os campos de avaliação
  // do cache local se existirem — independente do que chegou no snapshot
  // Isso evita race condition entre update() do Firebase e chegada do onValue
  Object.keys(fresh).forEach(k=>{
    const local = state.kanbanCards[k];
    if(!local) return;
    // Preserva campos de avaliação sempre que o cache local os tiver
    const ajusteFields = ['ajuste_diagramacao','ajuste_curadoria','ajuste_avaliado_em','ajuste_diagramacao_obs','ajuste_curadoria_obs'];
    ajusteFields.forEach(f=>{
      if(local[f] !== undefined) fresh[k][f] = local[f];
    });
    // C1: preserva também cards criados otimisticamente (antes do round-trip)
    if(local._localOnly) fresh[k] = {...fresh[k], ...local};
  });
  state.kanbanCards = fresh;
  // Refresh-safe: restaura o timer do Kanban salvo em localStorage (1x, após cards carregarem)
  window.restoreKanbanTimer?.();
  // C1: este é o ÚNICO listener de kanban (o duplicado em index_v2.js foi removido,
  // pois sobrescrevia a nota recém-salva). Renderiza kanban ou a página ativa.
  if(document.getElementById('page-kanban')?.classList.contains('active')) renderKanban();
  else renderDebounced();
  _refreshEvalInPlace();
  updateNotifBell();
  });
}

// Atualiza as estrelas do modal aberto SEM substituir elementos DOM
// (evita race condition onde onValue destrói o <span> durante um clique)
function _refreshEvalInPlace(){
  const key = state.currentKanbanDetailId;
  if(!key) return;
  const card = state.kanbanCards[key] || window._arquivoCards?.[key];
  if(!card) return;
  // Se as estrelas ainda não existem no DOM (card abriu antes do Firebase carregar),
  // faz render completo uma única vez para montar a seção
  if(!document.querySelectorAll('.ajuste-star-btn').length){
    kdRenderAvaliacao({...card, _key:key});
    return;
  }
  // Atualiza apenas as cores/label — sem substituir os <span>
  ['ajuste_diagramacao','ajuste_curadoria'].forEach(field=>{
    const lv = ajusteLabel(card[field]);
    const savedStars = lv?.stars||0;
    document.querySelectorAll(`.ajuste-star-btn[data-field="${field}"]`).forEach(s=>{
      s.style.color = parseInt(s.dataset.stars)<=savedStars ? '#F59E0B' : '#D1D5DB';
    });
    const labelEl = document.querySelector(`.ajuste-star-label[data-field="${field}"]`);
    if(labelEl) labelEl.innerHTML = lv
      ? `<span style="color:${lv.color}">${lv.label} · ${lv.nota}</span>`
      : '<span style="font-style:italic;color:var(--muted);font-weight:400;">Clique para avaliar</span>';
  });
}

function kColLabel(id){ return state.K_COLS.find(c=>c.id===id)?.label||id; }
function kColColor(id){ return state.K_COLS.find(c=>c.id===id)?.color||'#94A3B8'; }
function kFmtHours(min){ if(!min) return '0m'; const h=Math.floor(min/60),m=min%60; return h>0?`${h}h ${m}m`:`${m}m`; }
function kFmtDate(ts){ return new Date(ts).toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'}); }

// A3: identifica o curador a partir do PRÓPRIO card — nunca de uma lista de papéis
// global (que atribuía a avaliação a quem nem está na equipe). Prioriza quem registrou
// uma ação de curadoria no histórico do card; senão, quem mais logou tempo nele.
// Retorna null quando não há como identificar (exibido como "—").
function _getCuradoraForCard(card){
  // 0) Curador explícito (ex.: demanda manual permite escolher o curador)
  if(card.curador && state.COLLABS[card.curador]) return card.curador;
  // 1) Quem atuou na curadoria deste card, pelo histórico do próprio card
  if(Array.isArray(card.history)){
    const ev = [...card.history].reverse()
      .find(h => h && h.by && h.action && /curad/i.test(h.action));
    if(ev && state.COLLABS[ev.by]) return ev.by;
  }
  // 2) Fallback: maior tempo logado no card (alguém que realmente o trabalhou)
  if(card.workers){
    const top = Object.entries(card.workers)
      .filter(([k]) => state.COLLABS[k])
      .sort((a, b) => b[1] - a[1])[0];
    if(top) return top[0];
  }
  return null;
}

// Sem restrições de movimento — qualquer colaborador pode mover cards (modelo Trello)
function kCanMove(card, toCol) {
  const BLOCKED = ['lixeira'];
  if(BLOCKED.includes(toCol) && !state.isManager) return false;
  return true;
}
// Qualquer colaborador pode usar o timer kanban em colunas de trabalho ativas
function kCanTimer(card){
  const SKIP = ['lixeira','concluido'];
  if(SKIP.includes(card.column)) return false;
  return true;
}
function kGetNext(colId){ const i=state.K_COLS.findIndex(c=>c.id===colId); return i>=0&&i<state.K_COLS.length-1?state.K_COLS[i+1]:null; }
function kGetPrev(colId){ const i=state.K_COLS.findIndex(c=>c.id===colId); return i>0?state.K_COLS[i-1]:null; }

// Retorna botões configurados para a coluna, ou padrão sequencial se não configurado
function kGetColBotoes(colId){
  const col = state.K_COLS.find(c=>c.id===colId);
  if(col?.botoes === 'none') return [];          // coluna configurada explicitamente SEM botões
  if(Array.isArray(col?.botoes) && col.botoes.length) return col.botoes;
  // Padrão (só quando a coluna nunca teve botões configurados): timer + avançar + voltar
  const botoes = [];
  if(!['lixeira','concluido'].includes(colId)) botoes.push({tipo:'timer'});
  const prev = kGetPrev(colId);
  const next = kGetNext(colId);
  if(prev && !['lixeira'].includes(prev.id)) botoes.push({tipo:'mover',label:`← ${prev.label}`,destino:prev.id});
  if(next && !['lixeira'].includes(next.id)){
    const isLast = !kGetNext(next.id);
    if(isLast) botoes.push({tipo:'concluir'});
    else botoes.push({tipo:'mover',label:`→ ${next.label}`,destino:next.id});
  }
  return botoes;
}

// Move card para qualquer coluna (livre)
window.kMoveToCol = async(key, destColId)=>{
  const card = state.kanbanCards[key]; if(!card) return;
  // Valida que a coluna destino existe no K_COLS atual
  if(!state.K_COLS.find(c=>c.id===destColId)){
    showToast('Erro','Coluna destino não encontrada. Recarregue a página.'); return;
  }
  const now = Date.now();
  const hist = [...(card.history||[]),{action:`Movido para ${kColLabel(destColId)}`,by:state.currentCollabKey,byEmail:state.currentUser?.email||'',ts:now}];
  try{
    await set(child(kanbanRef,key),{...card,column:destColId,history:hist,updatedAt:now,modifiedBy:state.currentUser?.email||'desconhecido'});
    showToast('Card movido',`→ ${kColLabel(destColId)}`);
    registrarLog('mover', `Moveu "${(card.name||'').slice(0,40)}"`, `→ ${kColLabel(destColId)}`);
  }catch(err){
    showToast('Erro','Falha ao mover card. Tente novamente.');
    console.error('[kMoveToCol]',err);
  }
};

// ── PAN HORIZONTAL DO BOARD (arrastar com mouse) ────────────────────────────
function _setupPan(elId){
  const el = document.getElementById(elId);
  if(!el||el._panSetup) return;
  el._panSetup = true;
  let isDown=false, startX=0, scrollLeft=0;
  el.addEventListener('mousedown', e=>{
    if(e.target.closest('.k-card,.btn-sm,button,select,input,a')) return;
    isDown=true; startX=e.pageX-el.offsetLeft; scrollLeft=el.scrollLeft;
    el.style.cursor='grabbing'; el.style.userSelect='none';
  });
  el.addEventListener('mouseleave', ()=>{ isDown=false; el.style.cursor=''; el.style.userSelect=''; });
  el.addEventListener('mouseup',   ()=>{ isDown=false; el.style.cursor=''; el.style.userSelect=''; });
  el.addEventListener('mousemove', e=>{
    if(!isDown) return;
    e.preventDefault();
    const x = e.pageX-el.offsetLeft;
    el.scrollLeft = scrollLeft-(x-startX);
  });
}
function _setupKanbanPan(){ _setupPan('kanbanBoardScroll'); }
function _setupArquivoPan(){ _setupPan('arquivoBoardScroll'); }

// ── RENDER KANBAN ─────────────────────────────────────────────────────────────
// ── COLUNAS RETRÁTEIS — estado de collapse/pin por coluna ────────────────────
export function _initKColState(){
  state.K_COLS.forEach(c=>{ if(!state.kColState[c.id]) state.kColState[c.id]={collapsed:false,pinned:false}; });
  try{
    const saved=JSON.parse(localStorage.getItem('kronos_kcol_state')||'{}');
    Object.entries(saved).forEach(([id,s])=>{ if(state.kColState[id]) state.kColState[id]={...state.kColState[id],...s}; });
  }catch(e){}
}

function kSaveColState(){
  try{ localStorage.setItem('kronos_kcol_state', JSON.stringify(state.kColState)); }catch(e){}
}
window.kToggleCollapse = (colId)=>{
  if(state.kColState[colId].pinned) return;
  state.kColState[colId].collapsed = !state.kColState[colId].collapsed;
  kSaveColState(); renderKanban();
};
window.kTogglePin = (colId, e)=>{
  e.stopPropagation();
  state.kColState[colId].pinned = !state.kColState[colId].pinned;
  if(state.kColState[colId].pinned) state.kColState[colId].collapsed = false;
  kSaveColState(); renderKanban();
};

// ── RENDER KANBAN ─────────────────────────────────────────────────────────────
export function renderKanban(){
  // (also registered on window below)

  const board = document.getElementById('kanbanBoard'); if(!board) return;
  _refreshKanbanTypeFilter();
  const search = (document.getElementById('kanbanSearch')?.value||'').toLowerCase().trim();
  const fcCollab = document.getElementById('kanbanFilterCollab')?.value||'';
  const fcType = document.getElementById('kanbanFilterType')?.value||'';
  // Exclui cards arquivados — eles vivem no Arquivo Morto, não no Kanban
  const allCards = Object.entries(state.kanbanCards)
    .map(([k,v])=>({...v,_key:k}))
    .filter(c=>!c.archived);

  // Memoiza botões por coluna — evita recalcular para cada card individualmente
  const _botoesMemo = {};
  state.K_COLS.forEach(col=>{ _botoesMemo[col.id] = kGetColBotoes(col.id); });

  board.innerHTML = state.K_COLS.map(col=>{
    let colCards = allCards.filter(c=>c.column===col.id);
    if(search) colCards = colCards.filter(c=>(c.name||'').toLowerCase().includes(search));
    if(fcCollab) colCards = colCards.filter(c=>kIsAssignee(c,fcCollab));
    if(fcType) colCards = colCards.filter(c=>(c.tags||[]).some(t=>t.includes(fcType)));
    colCards.sort((a,b)=>((b.urgente?1:0)-(a.urgente?1:0)) || ((b.updatedAt||b.createdAt||0)-(a.updatedAt||a.createdAt||0)));
    const st = state.kColState[col.id]||{};
    const isCollapsed = st.collapsed && !st.pinned;
    const isPinned = st.pinned;
    return `<div class="k-col${isCollapsed?' k-col-collapsed':''}" style="${isCollapsed?'width:44px;min-width:44px;flex-shrink:0;':''}">
      <div class="k-col-header" style="border-bottom:3px solid ${col.color};cursor:pointer;user-select:none;"
        role="button" tabindex="0" aria-expanded="${!isCollapsed}"
        aria-label="${escH(col.label)} — ${isCollapsed?'expandir':'recolher'} coluna"
        onclick="kToggleCollapse('${col.id}')"
        onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();kToggleCollapse('${col.id}')}">
        ${isCollapsed
          ? `<div style="writing-mode:vertical-rl;transform:rotate(180deg);font-size:0.68rem;font-weight:700;color:var(--text);padding:8px 2px;white-space:nowrap;">${col.label} <span style="color:${col.color}">(${colCards.length})</span></div>`
          : `<div style="display:flex;align-items:center;justify-content:space-between;width:100%;gap:4px;">
               <div style="display:flex;align-items:center;gap:6px;">
                 <div class="k-col-title">${col.label}</div>
                 <div class="k-col-count">${colCards.length}</div>
               </div>
               <div style="display:flex;align-items:center;gap:2px;" onclick="event.stopPropagation()">
                 <button onclick="kTogglePin('${col.id}',event)" title="${isPinned?'Desafixar':'Fixar coluna expandida'}"
                   aria-label="${isPinned?'Desafixar coluna':'Fixar coluna expandida'}" aria-pressed="${isPinned}"
                   style="background:none;border:none;cursor:pointer;font-size:0.72rem;padding:2px 4px;opacity:${isPinned?1:0.3};color:${isPinned?'var(--orange)':'var(--muted)'};transition:opacity .15s;"><span aria-hidden="true">📌</span></button>
                 <span aria-hidden="true" style="font-size:0.6rem;color:var(--muted);pointer-events:none;">▴</span>
               </div>
             </div>`
        }
      </div>
      ${!isCollapsed?`<div class="k-col-body" id="kcol-${col.id}"
        ondragover="kDragOver(event,'${col.id}')"
        ondragleave="kDragLeave(event)"
        ondrop="kDrop(event,'${col.id}')">
        ${colCards.map(c=>renderKCard(c, _botoesMemo)).join('')}
      </div>`:''}
    </div>`;
  }).join('');
};

function renderKCard(card, botoesMemo){
  const assignees = kCardAssignees(card);
  const timerCol = K_TIMER_COLS[card.column];
  const timerLabel = timerCol?.label || kColLabel(card.column) || 'Iniciar';
  const cycles = card.adjustCycles||0;
  const canSeeCycles = state.isManager||kIsAssignee(card,state.currentCollabKey);
  // Avatares empilhados de todos os responsáveis (+ rótulo do principal ou "+N")
  const assigneeHtml = assignees.length
    ? `<div class="k-card-assignee">
        <div class="k-card-av-stack">${assignees.slice(0,4).map(a=>{
          const ac = state.COLLABS[a]||{initials:'?',color:'#94A3B8'};
          return `<div class="k-card-av" style="background:${ac.color}" title="${escH(ac.label||a)}">${escH(ac.initials||'?')}</div>`;
        }).join('')}</div>
        <span>${escH((state.COLLABS[assignees[0]]||{label:assignees[0]}).label||assignees[0])}${assignees.length>1?` +${assignees.length-1}`:''}</span>
      </div>`
    : `<div class="k-card-assignee" style="color:var(--muted)"><div class="k-card-av" style="background:#94A3B8">—</div>Sem responsável</div>`;
  const modColors = {MOD1:'#7C6AFF',MOD2:'#10B981',MOD3:'#F59E0B',MOD4:'#EF4444'};
  const modBadge = card.module&&card.module!=='none'
    ?`<span style="font-family:var(--mono);font-size:0.55rem;font-weight:700;padding:2px 6px;border-radius:4px;background:${modColors[card.module]||'#94A3B8'}22;border:1px solid ${modColors[card.module]||'#94A3B8'}55;color:${modColors[card.module]||'#94A3B8'}">${card.module}</span>`:'';
  const labelsHtml = (card.tags||[]).map(t=>{
    const lc=kLabelColor(t);
    return `<span class="k-card-label" style="background:${lc.bg};border:1px solid ${lc.border};color:${lc.color}">${escH(t)}</span>`;
  }).join('');
  const linksHtml = (card.links||[]).filter(Boolean).map(l=>`<a class="k-card-link" href="${escH(sanitizeUrl(l))}" target="_blank" rel="noopener noreferrer">${ICONS.link} ${escH(l.replace(/https?:\/\/(www\.)?/,'').slice(0,25))}</a>`).join('');
  const workers = card.workers||{};
  const workersSummary = Object.entries(workers).map(([k,mins])=>{
    const wc=state.COLLABS[k]||{initials:'?',color:'#94A3B8'};
    return `<span style="display:inline-flex;align-items:center;gap:3px;margin-right:4px;"><span style="width:14px;height:14px;border-radius:50%;background:${wc.color};display:inline-flex;align-items:center;justify-content:center;font-size:0.4rem;font-weight:800;color:#fff">${wc.initials}</span><span style="font-family:var(--mono);font-size:0.58rem;color:var(--muted)">${kFmtHours(mins)}</span></span>`;
  }).join('');
  const commentCount = Object.keys(card.comments||{}).length;

  // ── Botões configuráveis por coluna (usa memo pré-calculado se disponível) ──
  const botoes = botoesMemo?.[card.column] ?? kGetColBotoes(card.column);
  const timerAtivo = state.kTimerState?.cardKey === card._key;
  const botoesHtml = botoes.map(b=>{
    if(b.tipo==='timer'){
      if(timerAtivo) return `<button class="k-btn-timer" style="background:var(--orange);color:#fff;" disabled>🔴 Timer ativo</button>`;
      if(state.isRunning && !timerAtivo) return '';
      return `<button class="k-btn-timer" onclick="startKanbanTimer('${card._key}')">${ICONS.play} ${timerLabel}</button>`;
    }
    if(b.tipo==='mover'&&b.destino){
      const destCol = state.K_COLS.find(c=>c.id===b.destino);
      const lbl = b.label || (destCol?`→ ${destCol.label}`:b.destino);
      return `<button class="k-btn-move" onclick="kMoveToCol('${card._key}','${b.destino}')">${escH(lbl)}</button>`;
    }
    if(b.tipo==='concluir'){
      if(!state.isManager&&!kIsAssignee(card,state.currentCollabKey)) return '';
      return `<button class="k-btn-move" style="border-color:rgba(34,197,94,0.4);color:var(--success);" onclick="concludeKanbanCard('${card._key}')">${ICONS.check} ${b.label||'Concluir'}</button>`;
    }
    return '';
  }).join('');

  const canFlag = state.isManager || kIsAssignee(card, state.currentCollabKey);
  const urgenteBadge = card.urgente
    ? `<span class="k-card-urgent-badge">🔴 URGENTE</span>` : '';
  const urgenteBtn = canFlag
    ? `<button onclick="toggleUrgente('${card._key}',event)" title="${card.urgente?'Remover urgência':'Marcar como urgente'}" aria-label="Alternar urgência" style="background:none;border:none;cursor:pointer;font-size:0.8rem;padding:2px 4px;flex-shrink:0;line-height:1;opacity:${card.urgente?'1':'0.4'};">🔴</button>` : '';

  return `<div class="k-card${card.urgente?' urgent':''}" id="kcard-${card._key}"
    draggable="true"
    ondragstart="kDragStart(event,'${card._key}')"
    ondragend="kDragEnd(event)">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:4px;margin-bottom:6px;">
      <div class="k-card-name" onclick="openKanbanDetail('${card._key}')" style="flex:1">${escH(card.name||'Sem título')}</div>
      ${urgenteBtn}
      <button onclick="openArchiveChoiceModal('${card._key}')" title="Arquivar (escolher: coluna do mês ou lixeira)" aria-label="Arquivar card" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:0.75rem;padding:2px 4px;flex-shrink:0;line-height:1;" onmouseover="this.style.color='var(--danger)'" onmouseout="this.style.color='var(--muted)'">⤵</button>
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px;">
      ${urgenteBadge}${modBadge}${labelsHtml}
      ${canSeeCycles&&cycles>0?`<span style="font-family:var(--mono);font-size:0.55rem;font-weight:700;padding:2px 6px;border-radius:4px;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);color:var(--danger)">↩ ${cycles}x ajuste${cycles>1?'s':''}</span>`:''}
    </div>
    ${card.obs?`<div class="k-card-obs">"${escH(card.obs)}"</div>`:''}
    ${linksHtml?`<div class="k-card-links">${linksHtml}</div>`:''}
    <div class="k-card-meta">
      ${assigneeHtml}
      <div style="display:flex;align-items:center;gap:6px;">
        ${commentCount>0?`<span style="font-family:var(--mono);font-size:0.58rem;color:var(--muted)">💬${commentCount}</span>`:''}
        ${card.hours?`<span class="k-card-hours">${ICONS.clock} ${kFmtHours(card.hours)}</span>`:''}
      </div>
    </div>
    ${workersSummary?`<div style="margin-top:5px;display:flex;flex-wrap:wrap;align-items:center;">${workersSummary}</div>`:''}
    ${botoesHtml}
  </div>`;
}

// ── DRAG & DROP ───────────────────────────────────────────────────────────────
// Setup pan ao renderizar o board
_setupKanbanPan();
let dragData = { cardKey: null, sourceCol: null };

window.kDragStart = (e, key) => {
  dragData.cardKey = key;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', key);
  document.getElementById('kcard-' + key)?.classList.add('dragging');
};

window.kDragEnd = (e) => {
  document.querySelectorAll('.k-card').forEach(c => c.classList.remove('dragging'));
  document.querySelectorAll('.k-col-body').forEach(c => c.classList.remove('drag-over'));
  dragData = { cardKey: null, sourceCol: null };
};

window.kDragOver = (e, col) => {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  document.getElementById('kcol-' + col)?.classList.add('drag-over');
};

window.kDragLeave = (e) => {
  e.currentTarget.classList.remove('drag-over');
};

// ✅ FIX BUG 1: única declaração de kDrop — sem duplicação
window.kDrop = async (e, colId) => {
  e.preventDefault();
  const droppedKey = e.dataTransfer.getData('text/plain');
  if (!droppedKey || !state.kanbanCards[droppedKey]) return;

  const card = state.kanbanCards[droppedKey];
  if (card.column === colId) return;

  if (!kCanMove({ ...card, _key: droppedKey }, colId)) {
    showToast('Sem permissão', 'Você não pode mover este card para esta coluna.');
    return;
  }

  // ✅ FIX BUG 3: state.currentCollabKey em vez de state.currentUser
  const now_drop = Date.now();
  const hist = [ ...(card.history || []), {
    action: `Movido para ${kColLabel(colId)}`,
    by: state.currentCollabKey,
    byEmail: state.currentUser?.email||'desconhecido',
    ts: now_drop
  }];

  try {
    // ✅ AUDIT: updatedAt e modifiedBy registrados em toda movimentação
    await set(child(kanbanRef, droppedKey), { ...card, column: colId, history: hist, updatedAt: now_drop, modifiedBy: state.currentUser?.email||'desconhecido' });
    showToast('Card movido', `→ ${kColLabel(colId)}`);
    registrarLog('mover', `Moveu "${(card.name||'').slice(0,40)}"`, `→ ${kColLabel(colId)}`);
  } catch (err) {
    console.error('Kanban move error:', err);
    showToast('Erro', 'Falha ao mover card. Tente novamente.');
  }

  document.querySelectorAll('.k-col-body').forEach(c => c.classList.remove('drag-over'));
};

// ── MOVE NEXT ─────────────────────────────────────────────────────────────────
// ✅ FIX BUG 3: state.currentCollabKey em vez de state.currentUser
;

;

// ── KANBAN TIMER ──────────────────────────────────────────────────────────────
// ── Persistência do timer do Kanban ──────────────────────────────────────────
// Antes o kTimerState vivia só em memória → qualquer refresh perdia o timer.
// Agora salvamos em localStorage e restauramos ao carregar o Kanban.
function _saveKTimer(){
  try {
    if(state.kTimerState) localStorage.setItem('kronos_kTimer', JSON.stringify(state.kTimerState));
    else localStorage.removeItem('kronos_kTimer');
  } catch(e) {}
}
function _kTimerStartInterval(){
  if(state.kTimerInterval) clearInterval(state.kTimerInterval);
  const paint = ()=>{
    if(!state.kTimerState) return;
    const el=Date.now()-state.kTimerState.startTime;
    const s=Math.floor(el/1000),h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=s%60;
    const d=document.getElementById('kTimerDisplay');
    if(d) d.textContent=`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  };
  paint();
  state.kTimerInterval=setInterval(paint,1000);
}
window.restoreKanbanTimer = function(){
  if(state.kTimerState) return;                       // já rodando nesta sessão
  let saved=null;
  try { saved=JSON.parse(localStorage.getItem('kronos_kTimer')||'null'); } catch(e) { saved=null; }
  if(!saved || !saved.startTime || !saved.cardKey) return;
  // Só restaura do próprio colaborador e do mesmo dia
  if(saved.collab && state.currentCollabKey && saved.collab!==state.currentCollabKey) return;
  if(new Date(saved.startTime).toDateString()!==new Date().toDateString()){
    try{ localStorage.removeItem('kronos_kTimer'); }catch(e){}
    return;
  }
  state.kTimerState=saved;
  const widget=document.getElementById('kTimerWidget');
  if(widget) widget.style.display='block';
  const card=state.kanbanCards?.[saved.cardKey];
  const taskEl=document.getElementById('kTimerTask');
  if(taskEl) taskEl.textContent=card?.name||'Em andamento';
  _kTimerStartInterval();
  _publishKActiveTimer(state.kTimerState, card);   // re-publica em "Em andamento agora" após refresh
};

// Projeto associado a uma coluna (mesma lógica usada ao parar o timer do Kanban)
function _kColProject(column){
  const colCfg = state.K_COLS.find(c=>c.id===column);
  return colCfg?.project || K_TIMER_COLS[column]?.project || Object.keys(state.PROJECTS||{})[0] || 'trabalho';
}
// Publica o timer do Kanban no nó activeTimers → aparece em "Em andamento agora".
// Marcado com kanban:true para o restore do timer PRINCIPAL ignorá-lo (não sequestra a UI do timer).
function _publishKActiveTimer(ks, card){
  if(!ks) return;
  const collab = ks.collab || state.currentCollabKey;
  if(!collab) return;
  set(child(activeTimersRef, collab), {
    task: card?.name || state.kanbanCards?.[ks.cardKey]?.name || 'Em andamento',
    project: _kColProject(ks.column),
    obs: `Kanban: ${kColLabel(ks.column)}`,
    tags: [],
    startTime: ks.startTime,
    collab,
    kanban: true
  }).catch(e=>console.error('[kanban activeTimer]', e));
}
// Remove o timer do Kanban do activeTimers — só se o timer PRINCIPAL não estiver rodando
// (ele é dono do mesmo nó por colaborador), evitando apagar a entrada dele.
function _clearKActiveTimer(collab){
  const c = collab || state.currentCollabKey;
  if(!c || state.isRunning) return;
  remove(child(activeTimersRef, c)).catch(()=>{});
}

window.startKanbanTimer = async(key)=>{
  const card=state.kanbanCards[key]; if(!card) return;

  // ✅ FIX: se timer principal estiver rodando, para e salva automaticamente
  if(state.isRunning){
    const prevTask = document.getElementById('taskInput')?.value||'Sem título';
    await stopTimer();
    showToast('Timer anterior salvo',`"${prevTask.slice(0,30)}" foi registrado automaticamente.`);
  }

  // ✅ FIX: se timer do Kanban estiver rodando em outro card, para e salva automaticamente
  if(state.kTimerState && state.kTimerState.cardKey !== key){
    const prevCard = state.kanbanCards[state.kTimerState.cardKey];
    const prevName = prevCard?.name || 'card anterior';
    await stopKanbanTimer();
    showToast('Timer Kanban salvo',`"${prevName.slice(0,30)}" foi registrado automaticamente.`);
  }

  // Se o mesmo card já está rodando, não faz nada
  if(state.kTimerState?.cardKey === key) return;

  state.kTimerState={cardKey:key,startTime:Date.now(),column:card.column,collab:state.currentCollabKey};
  _saveKTimer();
  _publishKActiveTimer(state.kTimerState, card);   // ✅ aparece em "Em andamento agora"
  document.getElementById('kTimerWidget').style.display='block';
  document.getElementById('kTimerTask').textContent=card.name||'Em andamento';
  _kTimerStartInterval();
  renderKanban();
  showToast('Timer iniciado',`"${(card.name||'').slice(0,30)}"`);
};

// ✅ FIX BUG 2: collab declarada ANTES de ser usada em workers[collab]
window.stopKanbanTimer = async()=>{
  if(!state.kTimerState) return;
  // ✅ Captura tudo do estado ANTES de qualquer await — evita perda em race condition
  const collab      = state.kTimerState.collab || state.currentCollabKey;
  const startColumn = state.kTimerState.column || 'em_curadoria';
  const cardKey     = state.kTimerState.cardKey;
  const timerStart  = state.kTimerState.startTime;
  const now         = Date.now();
  const mins        = Math.max(1, Math.round((now - timerStart) / 60000));
  // A4: projeto do timer vem da config da coluna (cada equipe ajusta o seu);
  // fallback para o mapa legado da Diagramação e, por fim, o 1º projeto da equipe.
  const colCfg = state.K_COLS.find(c=>c.id===startColumn);
  const proj = colCfg?.project
    || K_TIMER_COLS[startColumn]?.project
    || Object.keys(state.PROJECTS||{})[0]
    || 'trabalho';

  // ✅ FIX: limpa estado E widget ANTES dos awaits para evitar duplo disparo
  clearInterval(state.kTimerInterval);
  state.kTimerState = null;
  _saveKTimer();
  _clearKActiveTimer(collab);   // remove de "Em andamento agora"
  document.getElementById('kTimerWidget').style.display='none';

  const card = state.kanbanCards[cardKey];

  try {
    // ✅ FIX: entry SEMPRE salva — mesmo se card sumiu do state.kanbanCards
    await push(entriesRef,{
      task: card?.name || 'Sem título',
      project: proj,
      collab,
      obs: `Kanban: ${kColLabel(startColumn)}`,
      tags: [],
      startTime: timerStart,
      endTime: now,
      duration: now - timerStart,
      createdAt: now,
      kanbanCardKey: cardKey,
      createdBy: state.currentUser?.email||'desconhecido'
    });

    // Atualiza horas no card apenas se ele ainda existir
    if(card){
      const workers = {...(card.workers||{})};
      workers[collab] = (workers[collab]||0) + mins;
      await set(child(kanbanRef, cardKey),{...card, hours:(card.hours||0)+mins, workers});
    }

    showToast('Timer finalizado',`${kFmtHours(mins)} registrados${card?' no card e':''} no timer!`);
  } catch(err) {
    showToast('Erro ao salvar','O registro pode não ter sido salvo. Verifique.');
    console.error('[stopKanbanTimer]', err);
  }

  renderKanban();
};

window.cancelKanbanTimer = ()=>{
  const collab = state.kTimerState?.collab || state.currentCollabKey;
  clearInterval(state.kTimerInterval); state.kTimerState=null;
  _saveKTimer();
  _clearKActiveTimer(collab);   // remove de "Em andamento agora"
  document.getElementById('kTimerWidget').style.display='none';
  renderKanban();
};

// ── KANBAN ARCHIVE / CONCLUDE / BACK ────────────────────────────────────────
// G6: archiveKanbanCard removido (código morto) — o botão ⤵ do card agora abre
// openArchiveChoiceModal (escolha coluna do mês ou lixeira); a lixeira em si é
// tratada por kArchiveToLixeira.

window.concludeKanbanCard = async(key)=>{
  const card=state.kanbanCards[key]; if(!card) return;
  const now=Date.now();
  // ✅ FIX BUG 3: state.currentCollabKey em vez de state.currentUser
  const hist=[...(card.history||[]),{action:'Concluído',by:state.currentCollabKey,ts:now}];
  // ✅ AUDIT: modifiedBy registrado ao concluir
  await set(child(kanbanRef, key),{...card,column:'concluido',concludedAt:now,history:hist,modifiedBy:state.currentUser?.email||'desconhecido'});
  showToast('Disciplina concluída!','Card movido para Concluído.');
  registrarLog('concluir', `Concluiu "${(card.name||'').slice(0,40)}"`);
  // Notifica todos os responsáveis (exceto quem concluiu)
  kCardAssignees(card)
    .filter(a=>a && a!==state.currentCollabKey)
    .forEach(a=>push(notifsRef,{to:a,title:'Disciplina concluída',msg:'"'+(card.name||'').slice(0,30)+'" foi liberada!',from:state.currentCollabKey,ts:now,read:false}));
};

// Marca/desmarca um card como URGENTE (gestora ou responsável). Disponível para toda equipe.
window.toggleUrgente = async(key, ev)=>{
  if(ev) ev.stopPropagation();
  const card = state.kanbanCards[key]; if(!card) return;
  if(!state.isManager && !kIsAssignee(card, state.currentCollabKey)){
    showToast('Sem permissão','Apenas a gestora ou um responsável pode marcar como urgente.');
    return;
  }
  const novo = !card.urgente;
  const now = Date.now();
  try{
    await update(child(kanbanRef, key), {
      urgente: novo,
      updatedAt: now,
      modifiedBy: state.currentUser?.email||'desconhecido'
    });
    if(state.kanbanCards[key]){ state.kanbanCards[key].urgente = novo; state.kanbanCards[key].updatedAt = now; }
    showToast(novo?'🔴 Marcado como urgente':'Urgência removida', `"${(card.name||'').slice(0,30)}"`);
    registrarLog('urgente', `${novo?'Marcou':'Removeu'} urgência`, (card.name||'').slice(0,40));
    renderKanban();
  }catch(e){
    showToast('Erro','Não foi possível atualizar a urgência.');
    console.error('[toggleUrgente]', e);
  }
};

;

// ── NOTIFICATIONS ─────────────────────────────────────────────────────────────
let allNotifs = {};
let unreadCount = 0;

// Called from index_v2.js notifs listener to update this module's allNotifs
export function setAllNotifs(data) {
  allNotifs = data;
  updateNotifBell();
}

// notifs listener consolidated in startDataListeners (index_v2.js)

function getMyNotifs(){
  return Object.entries(allNotifs)
    .filter(([,n])=>n.to===state.currentCollabKey&&!n.read)
    .map(([k,n])=>({...n,_key:k}))
    .sort((a,b)=>b.ts-a.ts);
}

function updateNotifBell(){
  const mine=getMyNotifs();
  const pending=getPendingCards();
  // ✅ Badge soma notificações não lidas + demandas pendentes
  unreadCount=mine.length+pending.length;
  const badge=document.getElementById('notifBadge');
  if(badge){ badge.textContent=unreadCount||''; badge.style.display=unreadCount>0?'flex':'none'; }
}

window.toggleNotifPanel = ()=>{
  const panel=document.getElementById('notifPanel');
  if(!panel) return;
  const isOpen=panel.style.display==='block';
  panel.style.display=isOpen?'none':'block';
  if(!isOpen) renderNotifPanel();
};

function renderNotifPanel(){
  const panel=document.getElementById('notifPanel'); if(!panel) return;
  const mine=getMyNotifs();
  const pending=getPendingCards();
  const hasContent=mine.length||pending.length;

  const bellIcon=`<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`;
  const taskIcon=`<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>`;

  panel.innerHTML=`
    <div class="notif-panel-header">
      <span class="notif-panel-title">Notificações</span>
      ${mine.length?`<button onclick="markAllRead()" class="btn-sm" style="padding:3px 8px;font-size:0.6rem;">${ICONS.check} Marcar lido</button>`:''}
    </div>
    <div class="notif-panel-body">
      ${pending.length?`
        <div class="notif-section-label">Suas pendências no Kanban</div>
        ${pending.map(card=>`
          <div class="notif-pending-item"
               onclick="document.getElementById('notifPanel').style.display='none';showPage('kanban');setTimeout(()=>openKanbanDetail('${card._key}'),300)"
               role="button" tabindex="0" aria-label="Abrir card ${escH(card.name||'')}">
            <div class="notif-pending-title">${escH(card.name||'Sem título')}</div>
            <div class="notif-pending-col">${taskIcon} ${escH(kColLabel(card.column))}</div>
          </div>`).join('')}
      `:''}
      ${mine.length?`
        <div class="notif-section-label" style="margin-top:${pending.length?8:0}px">Mensagens</div>
        ${mine.slice(0,8).map(n=>`
          <div class="notif-item ${n.read?'':'unread'}">
            <div class="notif-item-icon">${bellIcon}</div>
            <div class="notif-item-body">
              <div class="notif-item-title">${escH(n.title||'')}</div>
              ${n.msg?`<div class="notif-item-msg">${escH(n.msg||'')}</div>`:''}
            </div>
          </div>`).join('')}
      `:''}
      ${!hasContent?`
        <div class="notif-empty">
          <div style="font-size:1.5rem;margin-bottom:8px;">✓</div>
          Tudo em dia!
        </div>
      `:''}
    </div>
    ${hasContent?`<div class="notif-panel-footer"><span style="font-family:var(--mono);font-size:0.58rem;color:var(--muted);">${mine.length} mensage${mine.length!==1?'ns':'m'}</span></div>`:''}
  `;
}

window.markAllRead = async()=>{
  for(const n of getMyNotifs()) await set(child(notifsRef, n._key),{...n,read:true});
  renderNotifPanel();
};

function getPendingCards(){
  return Object.entries(state.kanbanCards)
    .map(([k,card])=>({...card,_key:k}))
    .filter(card=>{
      if(card.column==='lixeira'||card.column==='concluido') return false;
    // finalizacao: só owner, gestor ou curadora veem
      if(card.column==='em_curadoria') return isCuradora(state.currentCollabKey);
      if(card.column==='aguardando_ajustes') return kIsAssignee(card,state.currentCollabKey);
      if(card.column==='recuradoria') return state.isManager;
      if(card.column==='liberacao') return state.isManager||kIsAssignee(card,state.currentCollabKey);
      return false;
    });
}

// ── KANBAN COMMENTS ───────────────────────────────────────────────────────────
function renderKanbanComments(card){
  const container=document.getElementById('kdComments'); if(!container) return;
  const comments=Object.entries(card.comments||{}).map(([k,v])=>({...v,_key:k})).sort((a,b)=>a.ts-b.ts);
  if(!comments.length){container.innerHTML='<div style="font-size:0.75rem;color:var(--muted);text-align:center;padding:8px">Nenhum comentário ainda</div>';return;}
  container.innerHTML=comments.map(cm=>{
    // ✅ SEC: label de fallback escapado
    const col=state.COLLABS[cm.by]||{label:escH(cm.by||'?'),initials:'?',color:'#94A3B8'};
    const canDel=state.isManager||cm.by===state.currentCollabKey;
    return`<div style="background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:8px 10px;">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
        <div style="width:18px;height:18px;border-radius:50%;background:${col.color};display:flex;align-items:center;justify-content:center;font-size:0.45rem;font-weight:800;color:#fff">${col.initials}</div>
        <span style="font-size:0.72rem;font-weight:700">${col.label}</span>
        <span style="font-family:var(--mono);font-size:0.6rem;color:var(--muted);margin-left:auto">${fmtTime(cm.ts)}</span>
        ${canDel?`<button onclick="deleteKanbanComment('${cm._key}')" aria-label="Excluir comentário" style="background:none;border:none;color:var(--muted);cursor:pointer;padding:0 2px;display:flex;align-items:center;transition:color 0.2s;" onmouseover="this.style.color='var(--danger)'" onmouseout="this.style.color='var(--muted)'">${ICONS.x}</button>`:''}
      </div>
      <div style="font-size:0.78rem;color:var(--text)">${escH(cm.text)}</div>
    </div>`;
  }).join('');
}

window.addKanbanComment = async()=>{
  const key=window._detailCardKey; if(!key) return;
  const input=document.getElementById('kdCommentInput');
  const text=input?.value.trim(); if(!text) return;
  const card=state.kanbanCards[key]; if(!card) return;
  const comments={...(card.comments||{})};
  const newKey='c'+Date.now();
  comments[newKey]={text,by:state.currentCollabKey,ts:Date.now()};
  await set(child(kanbanRef, key),{...card,comments});
  input.value='';
  renderKanbanComments({...card,comments});
};

window.deleteKanbanComment = async(commentKey)=>{
  const key=window._detailCardKey; if(!key) return;
  const card=state.kanbanCards[key]; if(!card) return;
  const comments={...(card.comments||{})};
  delete comments[commentKey];
  await set(child(kanbanRef, key),{...card,comments});
  renderKanbanComments({...card,comments});
};

export async function cleanLixeira(){
  const cutoff = Date.now() - 30*24*60*60*1000;
  const toRemove = Object.entries(state.kanbanCards)
    .filter(([,card]) => card.column==='lixeira' && card.archivedAt && card.archivedAt < cutoff)
    .map(([k]) => remove(child(kanbanRef, k)));
  if(toRemove.length) await Promise.all(toRemove);
}

// A11: popula o select de módulo a partir das colunas do Arquivo Morto da equipe
// (state.MODS, vindo da config) — substitui as opções MOD1-4 fixas da Diagramação.
function _refreshKModuleSelect(){
  const sel = document.getElementById('kcModule');
  if(!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="none">Sem módulo</option>'
    + (state.MODS||[]).filter(m=>m.id!=='TRELLO')
        .map(m=>`<option value="${m.id}">${escH(m.label)}</option>`).join('');
  if(cur && sel.querySelector(`option[value="${cur}"]`)) sel.value = cur;
}

// ── KANBAN CARD MODAL ─────────────────────────────────────────────────────────
window.openKanbanCardModal = (key)=>{
  state.editingKanbanId=key;
  _refreshKModuleSelect();
  document.getElementById('kanbanCardModalTitle').textContent=key?'Editar Disciplina':'Nova Disciplina';
  window.clearTags(document.getElementById('kcTagsWrap'));
  document.getElementById('kcLinksList').innerHTML='';
  if(key){
    const c=state.kanbanCards[key]; if(!c) return;
    document.getElementById('kcName').value=c.name||'';
    _setKcAssignees(kCardAssignees(c));
    document.getElementById('kcColumn').value=c.column||'standby';
    document.getElementById('kcObs').value=c.obs||'';
    const km=document.getElementById('kcModule');if(km)km.value=c.module||'none';
    window.setTags(document.getElementById('kcTagsWrap'),c.tags||[]);
    (c.links||[]).forEach(l=>addKcLink(l));
  } else {
    document.getElementById('kcName').value='';
    // Pré-seleciona o próprio usuário como responsável (mas é opcional: pode desmarcar)
    const defaultAssignee = state.currentCollabKey
      || Object.keys(state.COLLABS||{}).find(k=>isActive(k)) || '';
    _setKcAssignees(defaultAssignee ? [defaultAssignee] : []);
    const defaultCol = (state.K_COLS||[]).find(c=>!['lixeira','concluido'].includes(c.id));
    document.getElementById('kcColumn').value = defaultCol?.id || (state.K_COLS?.[0]?.id || '');
    document.getElementById('kcObs').value='';
  }
  closeKanbanDetail();
  const _kcm = document.getElementById('kanbanCardModal'); _kcm?.classList.add('open'); if(_kcm) trapFocus(_kcm);
};
window.closeKanbanCardModal=()=>{ releaseFocus(); document.getElementById('kanbanCardModal').classList.remove('open'); state.editingKanbanId=null; };
window.addKcLink=(val='')=>{
  const ll=document.getElementById('kcLinksList');
  const row=document.createElement('div');row.style.cssText='display:flex;gap:6px;';
  row.innerHTML=`<input type="url" placeholder="https://..." value="${escH(val)}" style="flex:1;background:var(--surface2);border:1.5px solid var(--border);border-radius:8px;padding:7px 10px;color:var(--text);font-family:var(--mono);font-size:0.75rem;outline:none;">
    <button onclick="this.parentElement.remove()" aria-label="Remover link" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:0.9rem;padding:4px;"><span aria-hidden="true">✕</span></button>`;
  ll.appendChild(row);
};

// ✅ FIX BUG 3 e BUG 5: saveKanbanCard com state.currentCollabKey em todos os históricos
window.saveKanbanCard = async () => {
  const name = document.getElementById('kcName').value.trim();
  if (!name) {
    showToast('⚠️ Atenção', 'Preencha o nome da disciplina');
    document.getElementById('kcName').focus();
    return;
  }
  if (name.length > 100) {
    showToast('⚠️ Nome muito longo', 'Máximo 100 caracteres');
    return;
  }

  const assignees = _getKcAssignees();          // [] = sem responsável (opcional)
  const assignee  = assignees[0] || '';         // principal = 1º selecionado
  const column = document.getElementById('kcColumn').value;
  const module = document.getElementById('kcModule')?.value || 'none';
  const obs = document.getElementById('kcObs').value.trim();
  const tags = window.getSelectedTags(document.getElementById('kcTagsWrap'));
  const links = [...document.querySelectorAll('#kcLinksList input')]
    .map(i => i.value.trim()).filter(Boolean);

  const validLinks = links.filter(link => {
    try {
      new URL(link.startsWith('http') ? link : 'https://' + link);
      return true;
    } catch {
      return false;
    }
  });

  const now = Date.now();

  // ✅ Item 4: incluir fromEntryKey se veio do botão Curadoria
  const fromEntryKey = (!state.editingKanbanId && window._pendingFromEntryKey) ? window._pendingFromEntryKey : (state.kanbanCards[state.editingKanbanId]?.fromEntryKey||null);
  window._pendingFromEntryKey = null;

  const cardData = {
    name,
    assignee,
    assignees,
    column,
    module,
    obs: obs || '',
    tags,
    links: validLinks,
    hours: 0,
    workers: {},
    comments: {},
    adjustCycles: 0,
    ...(fromEntryKey ? {fromEntryKey} : {}),
    history: state.editingKanbanId
      ? [...(state.kanbanCards[state.editingKanbanId]?.history || [])]
      : [],
    createdAt: state.editingKanbanId
      ? state.kanbanCards[state.editingKanbanId]?.createdAt || now
      : now,
    updatedAt: now
  };

  try {
    setSyncStatus('loading', state.editingKanbanId ? 'Atualizando...' : 'Criando...');

    if (state.editingKanbanId && state.kanbanCards[state.editingKanbanId]) {
      const oldHistory = cardData.history;
      if (state.kanbanCards[state.editingKanbanId].column !== column) {
        // ✅ FIX BUG 3: state.currentCollabKey em vez de state.currentUser
        oldHistory.push({
          action: `Movido para "${kColLabel(column)}"`,
          by: state.currentCollabKey,
          ts: now
        });
      }
      oldHistory.push({
        action: 'Editado',
        by: state.currentCollabKey,
        ts: now
      });

      // ✅ AUDIT: modifiedBy no save do card
      await set(child(kanbanRef, state.editingKanbanId), {
        ...state.kanbanCards[state.editingKanbanId],
        ...cardData,
        history: oldHistory,
        modifiedBy: state.currentUser?.email||'desconhecido'
      });
      showToast('✅ Atualizado', `"${name.slice(0, 30)}..."`);
      registrarLog('editar', 'Editou disciplina', name);

    } else {
      // ✅ FIX BUG 3: state.currentCollabKey em vez de state.currentUser
      cardData.history.push({
        action: 'Criado',
        by: state.currentCollabKey,
        ts: now
      });

      await push(kanbanRef, cardData);
      showToast('✅ Criado', `"${name.slice(0, 30)}..." adicionado ao Kanban`);
      registrarLog('criar', 'Criou disciplina', name);
    }

    closeKanbanCardModal();

  } catch (error) {
    console.error('🚨 ERRO ao salvar Kanban:', error);
    const msg = error?.code === 'PERMISSION_DENIED'
      ? 'Sem permissão para salvar. Verifique o acesso.'
      : (error?.message || 'Verifique sua conexão e tente novamente');
    showToast('❌ Erro ao salvar card', msg);
  } finally {
    setSyncStatus('ok', 'Sincronizado ✓');
    try { renderKanban(); } catch(e) { console.error('[renderKanban after save]', e); }
  }
};

// ── KANBAN DETAIL ─────────────────────────────────────────────────────────────
window.openKanbanDetail=(key)=>{
  state.currentKanbanDetailId=key;
  const card=state.kanbanCards[key] || state.arquivoCards?.[key] || window._arquivoCards?.[key];
  if(!card) return;
  const isArchived = !!(card.archived || state.arquivoCards?.[key] || window._arquivoCards?.[key]);
  const _kdAssignees = kCardAssignees(card);
  document.getElementById('kdName').textContent=card.name||'Sem título';
  document.getElementById('kdLabels').innerHTML=(card.tags||[]).map(t=>{const lc=kLabelColor(t);return`<span class="k-card-label" style="background:${lc.bg};border:1px solid ${lc.border};color:${lc.color}">${escH(t)}</span>`;}).join('');
  document.getElementById('kdAssignee').innerHTML = _kdAssignees.length
    ? _kdAssignees.map((a,i)=>{
        const ac=state.COLLABS[a]||{label:a||'?',initials:'?',color:'#94A3B8'};
        return `<div style="display:flex;align-items:center;gap:6px;margin-bottom:${i<_kdAssignees.length-1?'4px':'0'}"><div style="width:22px;height:22px;border-radius:50%;background:${ac.color};display:flex;align-items:center;justify-content:center;font-size:0.48rem;font-weight:800;color:#fff">${escH(ac.initials)}</div><strong>${escH(ac.label)}</strong>${i===0&&_kdAssignees.length>1?'<span style="font-size:0.6rem;color:var(--muted);font-weight:700">principal</span>':''}</div>`;
      }).join('')
    : `<div style="color:var(--muted);font-size:0.8rem">Sem responsável</div>`;
  // Para cards arquivados mostra o módulo do Arquivo Morto, não a coluna do kanban
  const modLabel = isArchived ? (state.MODS.find(m=>m.id===card.module)?.label||'Arquivo Morto') : kColLabel(card.column);
  document.getElementById('kdColumn').textContent = isArchived ? `📦 ${modLabel}` : modLabel;
  document.getElementById('kdHours').textContent=card.hours?kFmtHours(card.hours):'Nenhuma hora ainda';
  document.getElementById('kdCreated').textContent=card.createdAt?kFmtDate(card.createdAt):'—';
  // ✅ FIX: links sempre visíveis e editáveis inline por qualquer colaborador
  kdRenderLinks(card.links||[]);
  if(card.obs){ document.getElementById('kdObsSection').style.display='block'; document.getElementById('kdObs').textContent=card.obs; }
  else { document.getElementById('kdObsSection').style.display='none'; }
  document.getElementById('kdHistory').innerHTML=(card.history||[]).slice().reverse().map(h=>{
    const hc=state.COLLABS[h.by]||{label:h.by||'?',initials:'?',color:'#94A3B8'};
    return`<div class="k-history-item"><div class="k-history-dot"></div><div style="flex:1"><span style="font-weight:700">${escH(h.action)}</span> <span style="font-size:0.65rem;color:var(--muted)">por ${hc.label}</span></div><div style="font-family:var(--mono);font-size:0.62rem;color:var(--muted);white-space:nowrap">${kFmtDate(h.ts)}</div></div>`;
  }).join('');
  const workers=card.workers||{};
  document.getElementById('kdWorkers').innerHTML=Object.entries(workers).length
    ? Object.entries(workers).map(([k,mins])=>{
        const wc=state.COLLABS[k]||{label:k,initials:'?',color:'#94A3B8'};
        return`<div style="display:flex;align-items:center;gap:6px;background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:5px 10px;">
          <div style="width:20px;height:20px;border-radius:50%;background:${wc.color};display:flex;align-items:center;justify-content:center;font-size:0.48rem;font-weight:800;color:#fff">${wc.initials}</div>
          <span style="font-size:0.78rem;font-weight:700">${wc.label}</span>
          <span style="font-family:var(--mono);font-size:0.7rem;color:var(--muted)">${kFmtHours(mins)}</span>
        </div>`;
      }).join('')
    : '<span style="font-size:0.75rem;color:var(--muted)">Nenhum registro ainda</span>';
  window._detailCardKey = key;
  renderKanbanComments(card);
  // ✅ BUG nota da demanda: precisa do _key, senão as estrelas geram saveAjuste('undefined',...)
  // e a nota é gravada numa chave inexistente (aparecia "salvo" mas não persistia no card).
  kdRenderAvaliacao({...card, _key:key});
  const _kdm = document.getElementById('kanbanDetailModal'); _kdm?.classList.add('open'); if(_kdm) trapFocus(_kdm);
  // ✅ FIX: listeners adicionados após abrir — evita problema de onclick em módulos ES

  // Botão Arquivar — oculto para cards já arquivados; abre modal de escolha para os demais
  const archiveBtn = document.getElementById('kdArchiveBtn');
  if(archiveBtn){
    archiveBtn.style.display = isArchived ? 'none' : '';
    const newArchBtn = archiveBtn.cloneNode(true);
    archiveBtn.parentNode.replaceChild(newArchBtn, archiveBtn);
    if(!isArchived){
      newArchBtn.addEventListener('click', ()=>{
        if(!key){ showToast('Erro','Card não identificado. Feche e abra novamente.'); return; }
        openArchiveChoiceModal(key);
      });
    }
  }

  // Botão Editar
  const editBtn = document.getElementById('kdEditBtn');
  if(editBtn){
    const newEditBtn = editBtn.cloneNode(true);
    editBtn.parentNode.replaceChild(newEditBtn, editBtn);
    newEditBtn.addEventListener('click', ()=>{
      if(key) openKanbanCardModal(key);
    });
  }

  // Botão Adicionar link
  const addLinkBtn = document.getElementById('kdAddLinkBtn');
  if(addLinkBtn){
    // Clona para remover listeners anteriores
    const newBtn = addLinkBtn.cloneNode(true);
    addLinkBtn.parentNode.replaceChild(newBtn, addLinkBtn);
    newBtn.addEventListener('click', ()=>{
      const existingInputs = [...document.querySelectorAll('#kdLinksList input')];
      const currentLinks = existingInputs.map(i=>i.value.trim()).filter(Boolean);
      kdRenderLinks([...currentLinks, '']);
      const inputs = document.querySelectorAll('#kdLinksList input');
      if(inputs.length){
        const last = inputs[inputs.length-1];
        last.focus();
        last.addEventListener('blur', async ()=>{
          const val = last.value.trim();
          if(val) await kdSaveLinksNow([...currentLinks, val]);
        }, {once:true});
        last.addEventListener('keydown', async (e)=>{
          if(e.key==='Enter'){
            e.preventDefault();
            const val = last.value.trim();
            if(val){ await kdSaveLinksNow([...currentLinks, val]); last.blur(); }
          }
        }, {once:true});
      }
    });
  }
};

// ── AVALIAÇÃO DE AJUSTE — GESTORA ────────────────────────────────────────────
const AJUSTE_LEVELS = [
  {id:'sem_ajuste',        label:'Sem ajuste',        stars:5, nota:5, color:'#22C55E', bg:'#f0fdf4', border:'#86efac'},
  {id:'extremamente_leve', label:'Extremamente Leve', stars:4, nota:4, color:'#84CC16', bg:'#f7fee7', border:'#bef264'},
  {id:'leve',              label:'Leve',              stars:3, nota:3, color:'#F59E0B', bg:'#fffbeb', border:'#fde68a'},
  {id:'medio',             label:'Médio',             stars:2, nota:2, color:'#F97316', bg:'#fff7ed', border:'#fed7aa'},
  {id:'grave',             label:'Grave',             stars:1, nota:1, color:'#EF4444', bg:'#fef2f2', border:'#fecaca'},
];

function ajusteStars(stars, total=5){
  return Array.from({length:total},(_,i)=>
    `<span style="color:${i<stars?'#F59E0B':'#D1D5DB'};font-size:0.9rem;">★</span>`
  ).join('');
}

function ajusteLabel(id){
  return AJUSTE_LEVELS.find(l=>l.id===id)||null;
}

// Renderiza o bloco de avaliação no detalhe do card
function kdRenderAvaliacao(card){
  const section = document.getElementById('kdAvaliacaoSection');
  const body    = document.getElementById('kdAvaliacaoBody');
  if(!section||!body) return;

  // A7: avaliação por estrelas desativada nesta equipe — esconde a seção inteira
  if(!state.avaliacaoAtiva){ section.style.display='none'; return; }

  // Lê avaliação do estado live (garante dados frescos mesmo que card passado esteja desatualizado)
  const liveCard = (card._key && (state.kanbanCards[card._key] || window._arquivoCards?.[card._key])) || card;

  const isOwner = kIsAssignee(liveCard, state.currentCollabKey);
  const isCuradoraUser = isCuradora(state.currentCollabKey);
  const canSeeAny = state.isManager || isOwner || isCuradoraUser;
  section.style.display = canSeeAny ? '' : 'none';
  if(!canSeeAny) return;

  const campos = [];
  if(state.isManager || isOwner) campos.push({field:'ajuste_diagramacao', label:'Demanda', value:liveCard.ajuste_diagramacao||'', editable:state.isManager});
  if(state.isManager || isCuradoraUser) campos.push({field:'ajuste_curadoria', label:'Curadoria', value:liveCard.ajuste_curadoria||'', editable:state.isManager});

  body.innerHTML = campos.map(c=>{
    const lv = ajusteLabel(c.value);
    if(c.editable){
      // Estrelas clicáveis — padrão rating: clica na estrela N e preenche 1→N
      const currentStars = ajusteLabel(c.value)?.stars || 0;
      const currentLabel = ajusteLabel(c.value)?.label || '';
      const starsHtml = [1,2,3,4,5].map(n=>{
        const lvForN = AJUSTE_LEVELS.find(l=>l.stars===n);
        return `<span
          class="ajuste-star-btn"
          data-stars="${n}"
          data-field="${c.field}"
          data-key="${card._key}"
          onclick="saveAjuste('${card._key}','${c.field}','${lvForN?.id||''}')"
          onmouseover="kdStarHover(this,'${c.field}',${n})"
          onmouseout="kdStarOut('${c.field}')"
          style="font-size:1.6rem;cursor:pointer;color:${n<=currentStars?'#F59E0B':'#D1D5DB'};transition:color 0.1s;line-height:1;">★</span>`;
      }).join('');
      return `
        <div style="background:var(--surface2);border:1.5px solid var(--border);border-radius:10px;padding:10px 12px;">
          <div style="font-size:0.65rem;font-weight:800;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted);margin-bottom:6px;">${c.label}</div>
          <div class="ajuste-star-row-inline" data-field="${c.field}" style="display:flex;align-items:center;gap:2px;margin-bottom:4px;">${starsHtml}</div>
          <div class="ajuste-star-label" data-field="${c.field}" style="font-size:0.72rem;font-weight:700;color:${ajusteLabel(c.value)?.color||'var(--muted)'};min-height:16px;">
            ${currentLabel||'<span style="font-style:italic;color:var(--muted);font-weight:400;">Clique para avaliar</span>'}
          </div>
          ${lv ? `<button onclick="limparAjuste('${card._key}','${c.field}')" title="Excluir esta avaliação" style="margin-top:4px;background:none;border:1px solid var(--danger);color:var(--danger);border-radius:6px;padding:3px 9px;font-size:0.62rem;font-weight:700;cursor:pointer;">✕ Excluir avaliação</button>` : ''}
          <textarea
            class="ajuste-obs-input"
            placeholder="Justificativa curta (opcional)..."
            maxlength="200"
            data-key="${card._key}"
            data-obsfield="${c.field}_obs"
            onblur="saveAjusteObs(this)"
            oninput="this.style.height='auto';this.style.height=this.scrollHeight+'px'"
            style="margin-top:8px;width:100%;resize:none;overflow:hidden;min-height:32px;font-family:var(--font);font-size:0.75rem;padding:5px 8px;border:1.5px solid var(--border);border-radius:7px;background:var(--surface);color:var(--text);outline:none;transition:border-color 0.2s;"
            onfocus="this.style.borderColor='var(--orange)'"
            onblur="this.style.borderColor='var(--border)';saveAjusteObs(this)"
          >${escH(liveCard[c.field+'_obs']||'')}</textarea>
          <div style="text-align:right;font-size:0.6rem;font-family:var(--mono);color:var(--muted);margin-top:2px;">${(liveCard[c.field+'_obs']||'').length}/200</div>
        </div>`;
    } else {
      return `
        <div style="background:var(--surface2);border:1.5px solid var(--border);border-radius:10px;padding:10px 12px;">
          <div style="font-size:0.65rem;font-weight:800;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted);margin-bottom:6px;">${c.label}</div>
          ${lv
            ? `<div style="display:flex;align-items:center;gap:6px;">
                <span style="font-size:0.95rem;">${ajusteStars(lv.stars)}</span>
                <span style="font-size:0.75rem;font-weight:700;color:${lv.color};">${lv.label}</span>
               </div>`
            : `<div style="font-size:0.75rem;color:var(--muted);font-style:italic;">Não avaliado</div>`
          }
          ${liveCard[c.field+'_obs']
            ? `<div style="margin-top:6px;font-size:0.72rem;color:var(--muted);font-style:italic;line-height:1.4;padding:5px 8px;background:var(--bg);border-radius:6px;border:1px solid var(--border);">"${escH(liveCard[c.field+'_obs'])}"</div>`
            : ''
          }
        </div>`;
    }
  }).join('');
}

// Hover visual das estrelas (sem salvar)
window.kdStarHover = (el, field, n)=>{
  const row = el.closest('.ajuste-star-row-inline') || el.parentElement;
  row.querySelectorAll('.ajuste-star-btn').forEach(s=>{
    s.style.color = parseInt(s.dataset.stars) <= n ? '#F59E0B' : '#D1D5DB';
    s.style.transform = parseInt(s.dataset.stars) <= n ? 'scale(1.15)' : 'scale(1)';
  });
  const lv = AJUSTE_LEVELS.find(l=>l.stars===n);
  const labelEl = row.parentElement?.querySelector(`.ajuste-star-label[data-field="${field}"]`);
  if(labelEl && lv) labelEl.innerHTML = `<span style="color:${lv.color}">${lv.label} · ${lv.nota}</span>`;
};
window.kdStarOut = (field)=>{
  // Restaura o estado salvo ao tirar o mouse
  // field é exatamente 'ajuste_diagramacao' ou 'ajuste_curadoria'
  document.querySelectorAll(`.ajuste-star-btn[data-field="${field}"]`).forEach(s=>{
    const key  = s.dataset.key;
    const card = state.kanbanCards[key] || window._arquivoCards?.[key] || {};
    const saved = ajusteLabel(card[field]);  // field já é o nome exato do campo
    const savedStars = saved?.stars||0;
    s.style.color     = parseInt(s.dataset.stars) <= savedStars ? '#F59E0B' : '#D1D5DB';
    s.style.transform = 'scale(1)';
  });
  // Restaura label
  document.querySelectorAll(`.ajuste-star-label[data-field="${field}"]`).forEach(labelEl=>{
    const key  = document.querySelector(`.ajuste-star-btn[data-field="${field}"]`)?.dataset.key;
    const card = state.kanbanCards[key] || window._arquivoCards?.[key] || {};
    const lv   = ajusteLabel(card[field]);
    labelEl.innerHTML = lv
      ? `<span style="color:${lv.color}">${lv.label} · ${lv.nota}</span>`
      : '<span style="font-style:italic;color:var(--muted);font-weight:400;">Clique para avaliar</span>';
  });
};

// Salva o ajuste no Firebase — único update() para evitar race condition com onValue
window.saveAjuste = async(key, field, value)=>{
  if(!state.isManager){ showToast('Sem permissão','Apenas a gestora pode avaliar.'); return; }
  const now = Date.now();
  const lv  = ajusteLabel(value);

  if(state.kanbanCards[key]){
    state.kanbanCards[key][field]             = value;
    state.kanbanCards[key].ajuste_avaliado_em = now;
    state.kanbanCards[key].updatedAt          = now;
  }
  if(window._arquivoCards?.[key]){
    window._arquivoCards[key][field]             = value;
    window._arquivoCards[key].ajuste_avaliado_em = now;
  }

  // Re-renderiza imediatamente com o valor local
  const cardForRender = state.kanbanCards[key] || window._arquivoCards?.[key] || {};
  kdRenderAvaliacao({...cardForRender, _key:key});

  // Determina qual ref usar: cards arquivados separados ficam em arquivoRef
  const targetRef = state.kanbanCards[key] ? kanbanRef : arquivoRef;

  try{
    await update(child(targetRef, key), {
      [field]: value,
      ajuste_avaliado_em: now,
      updatedAt: now,
    });

    const estrelas = '★'.repeat(lv?.stars||0) + '☆'.repeat(5-(lv?.stars||0));
    showToast('✅ Avaliação salva', `${estrelas} ${lv?.label||'—'} · nota ${lv?.nota||'?'}`);
    registrarLog('avaliar', `Avaliou ${field==='ajuste_curadoria'?'curadoria':'demanda'}`, `${(state.kanbanCards[key]?.name||window._arquivoCards?.[key]?.name||'').slice(0,40)} · ${lv?.label||'—'}`);

  } catch(e){
    showToast('❌ Erro','Falha ao salvar avaliação. Verifique a conexão.');
    console.error('[saveAjuste] erro:', e);
  }
};

// Exclui a avaliação (nota + justificativa) de um campo — só gestão.
window.limparAjuste = async(key, field)=>{
  if(!state.isManager){ showToast('Sem permissão','Apenas a gestão pode excluir avaliação.'); return; }
  if(!confirm('Excluir esta avaliação? A nota e a justificativa serão removidas.')) return;
  const now = Date.now();
  // Limpa o cache local (e o merge do onValue não vai mais preservar o valor antigo)
  if(state.kanbanCards[key]){ delete state.kanbanCards[key][field]; delete state.kanbanCards[key][field+'_obs']; state.kanbanCards[key].updatedAt = now; }
  if(window._arquivoCards?.[key]){ delete window._arquivoCards[key][field]; delete window._arquivoCards[key][field+'_obs']; }
  const cardForRender = state.kanbanCards[key] || window._arquivoCards?.[key] || {};
  kdRenderAvaliacao({...cardForRender, _key:key});
  const targetRef = state.kanbanCards[key] ? kanbanRef : arquivoRef;
  try{
    await update(child(targetRef, key), { [field]: null, [field+'_obs']: null, updatedAt: now });
    registrarLog('avaliar', `Excluiu avaliação de ${field==='ajuste_curadoria'?'curadoria':'demanda'}`, (cardForRender.name||'').slice(0,40));
    showToast('Avaliação excluída', 'A nota foi removida.');
  }catch(e){
    showToast('Erro','Não foi possível excluir a avaliação.');
    console.error('[limparAjuste]', e);
  }
};

// Salva justificativa do ajuste (onblur no textarea)
window.saveAjusteObs = async(el)=>{
  if(!state.isManager) return;
  const key      = el.dataset.key;
  const obsField = el.dataset.obsfield; // ex: 'ajuste_diagramacao_obs'
  const value    = el.value.trim();
  if(!key||!obsField) return;
  // Atualiza cache local
  if(state.kanbanCards[key])   state.kanbanCards[key][obsField]   = value;
  if(window._arquivoCards?.[key]) window._arquivoCards[key][obsField] = value;
  try{
    const targetRef = state.kanbanCards[key] ? kanbanRef : arquivoRef;
    await update(child(targetRef, key), {[obsField]: value, updatedAt: Date.now()});
  } catch(e){
    showToast('❌ Erro','Falha ao salvar justificativa.');
    console.error('[saveAjusteObs]', e);
  }
};

// ── PÁGINA INDICADORES ────────────────────────────────────────────────────────
function _indGetAllCards(){
  // Cards do kanban + arquivo morto — garante que assignee e name estão presentes
  const kCards = Object.entries(state.kanbanCards||{}).map(([k,c])=>({...c,_key:k}));
  const aCards = Object.entries(window._arquivoCards||{}).map(([k,c])=>({...c,_key:k}));
  // Merge: se o card existe no kanban E no arquivo, usa o do kanban (mais fresco)
  const kanbanKeys = new Set(kCards.map(c=>c._key));
  const aFiltered  = aCards.filter(c=>!kanbanKeys.has(c._key));
  // Demandas manuais: existem SÓ nos Indicadores (não no Kanban/Arquivo). _key prefixado + flag.
  const mCards = Object.entries(state.indicadoresManuais||{}).map(([k,c])=>({...c, _key:'manual_'+k, _manualKey:k, manual:true}));
  return [...kCards,...aFiltered,...mCards];
}

// D5: indicadores de avaliação individuais — o colaborador vê só as PRÓPRIAS
// demandas (campo ajuste_diagramacao + observação do gestor). Nunca mostra curadoria.
window.renderMeusIndicadores = ()=>{
  const section = document.getElementById('mdAvaliacoesSection');
  if(!section) return;
  if(!state.avaliacaoAtiva){ section.style.display='none'; return; }
  const key = state.currentCollabKey;
  const all = _indGetAllCards().filter(c=>c.assignee===key && c.ajuste_diagramacao);
  section.style.display = '';
  const resumoEl = document.getElementById('mdAvaliacoesResumo');
  const bodyEl   = document.getElementById('mdAvaliacoesBody');
  if(!all.length){
    if(resumoEl) resumoEl.innerHTML = '<div style="color:var(--muted);font-size:0.82rem;">Você ainda não tem demandas avaliadas.</div>';
    if(bodyEl)   bodyEl.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:20px;color:var(--muted);">Nenhuma avaliação ainda.</td></tr>';
    return;
  }
  let soma = 0; const niveis = {};
  all.forEach(c=>{ const lv = ajusteLabel(c.ajuste_diagramacao); soma += lv?.nota||0; niveis[c.ajuste_diagramacao] = (niveis[c.ajuste_diagramacao]||0)+1; });
  const media = (soma/all.length).toFixed(1);
  const mediaStars = Math.round(soma/all.length);
  const barras = AJUSTE_LEVELS.map(lv=>{
    const cnt = niveis[lv.id]||0; if(!cnt) return '';
    const pct = Math.round(cnt/all.length*100);
    return `<div style="margin-bottom:4px;">
      <div style="display:flex;justify-content:space-between;font-size:0.65rem;font-weight:700;margin-bottom:2px;"><span style="color:${lv.color}">${escH(lv.label)}</span><span style="font-family:var(--mono);color:var(--muted)">${cnt} (${pct}%)</span></div>
      <div style="height:5px;background:var(--border);border-radius:99px;overflow:hidden;"><div style="height:100%;width:${pct}%;background:${lv.color};border-radius:99px;"></div></div>
    </div>`;
  }).join('');
  if(resumoEl) resumoEl.innerHTML = `<div style="display:flex;align-items:center;gap:18px;flex-wrap:wrap;">
    <div style="text-align:center;min-width:90px;">
      <div style="font-size:2rem;font-weight:900;font-family:var(--mono);color:var(--orange);line-height:1;">${media}</div>
      <div style="font-size:0.95rem;letter-spacing:-1px;">${ajusteStars(mediaStars)}</div>
      <div style="font-size:0.68rem;color:var(--muted);margin-top:2px;">${all.length} avaliada${all.length!==1?'s':''}</div>
    </div>
    <div style="flex:1;min-width:200px;">${barras||'<div style="font-size:0.72rem;color:var(--muted)">Sem dados</div>'}</div>
  </div>`;
  all.sort((a,b)=>(b.ajuste_avaliado_em||b.updatedAt||0)-(a.ajuste_avaliado_em||a.updatedAt||0));
  if(bodyEl) bodyEl.innerHTML = all.map(c=>{
    const lv = ajusteLabel(c.ajuste_diagramacao);
    const ts = c.ajuste_avaliado_em||c.updatedAt||0;
    return `<tr style="border-bottom:1px solid var(--border);">
      <td style="padding:9px 14px;font-size:0.8rem;font-weight:600;">${escH(c.name||c.title||'Sem nome')}</td>
      <td style="padding:9px 14px;">${lv?`<span style="font-size:0.72rem;font-weight:700;color:${lv.color};background:${lv.bg};border:1px solid ${lv.border};border-radius:5px;padding:2px 8px;">${escH(lv.label)}</span>`:'<span style="color:var(--muted)">—</span>'}</td>
      <td style="padding:9px 14px;font-size:0.78rem;color:var(--muted);font-style:italic;max-width:280px;">${c.ajuste_diagramacao_obs?escH(c.ajuste_diagramacao_obs):'—'}</td>
      <td style="padding:9px 14px;font-family:var(--mono);font-size:0.72rem;color:var(--muted);">${ts?new Date(ts).toLocaleDateString('pt-BR'):'—'}</td>
    </tr>`;
  }).join('');
};

function _indPopMeses(){
  const sel = document.getElementById('indMesFilter'); if(!sel) return;
  const cards = _indGetAllCards();
  const meses = new Set();
  cards.forEach(c=>{
    const ts = c.ajuste_avaliado_em||c.updatedAt||c.createdAt;
    if(ts) meses.add(new Date(ts).toISOString().slice(0,7));
  });
  const atual = new Date().toISOString().slice(0,7);
  const sorted = [...meses].sort().reverse();
  if(!sorted.includes(atual)) sorted.unshift(atual);
  sel.innerHTML = `<option value="">Todos os meses</option>`
    + sorted.map(m=>{
        const [y,mo]=m.split('-');
        const label=new Date(y,mo-1,1).toLocaleDateString('pt-BR',{month:'long',year:'numeric'});
        return `<option value="${m}">${label}</option>`;
      }).join('');
}

window.renderIndicadores = ()=>{
  if(!state.isManager && !state.isAuditor) return;
  // A7: equipe sem avaliação por estrelas — Indicadores não se aplica
  if(!state.avaliacaoAtiva){
    const grid = document.getElementById('indResumoGrid');
    if(grid) grid.innerHTML = '<div style="font-size:0.85rem;color:var(--muted);grid-column:1/-1;padding:20px;text-align:center;">A avaliação por estrelas está desativada nesta equipe. Ative em <strong>Configurações → Geral</strong> para usar os Indicadores.</div>';
    const tb = document.getElementById('indTableBody'); if(tb) tb.innerHTML='';
    const pend = document.getElementById('indPendenteList'); if(pend) pend.innerHTML='';
    const badge = document.getElementById('indPendenteBadge'); if(badge) badge.textContent='0';
    const tot = document.getElementById('indTotalLabel'); if(tot) tot.textContent='';
    return;
  }
  _indPopMeses();
  const mesF   = document.getElementById('indMesFilter')?.value||'';
  const colabF = document.getElementById('indColabFilter')?.value||'';
  const tipoF  = document.getElementById('indTipoFilter')?.value||'diagramacao';
  const field  = tipoF==='curadoria'?'ajuste_curadoria':'ajuste_diagramacao';

  const all = _indGetAllCards();

  // Filtro de mês por updatedAt
  let cards = all;
  if(mesF){
    cards = cards.filter(c=>{
      const ts = c.ajuste_avaliado_em||c.updatedAt||c.createdAt||0;
      return new Date(ts).toISOString().slice(0,7)===mesF;
    });
  }
  if(colabF) cards = cards.filter(c=>kIsAssignee(c,colabF));

  // Avaliados vs pendentes
  const avaliados = cards.filter(c=>c[field]);
  const pendentes = cards.filter(c=>{
    if(c.manual) return false;   // demanda manual já entra avaliada — nunca é "pendente"
    if(!c[field] || !c.assignee) return false;
    const email = Object.keys(state.COLLAB_EMAILS).find(e=>state.COLLAB_EMAILS[e]===c.assignee)||'';
    return !state.MANAGER_EMAILS.includes(email);
  });

  // Atualiza totais
  const totalEl = document.getElementById('indTotalLabel');
  if(totalEl) totalEl.textContent = `${avaliados.length} avaliado${avaliados.length!==1?'s':''}`;
  const pendBadge = document.getElementById('indPendenteBadge');
  if(pendBadge) pendBadge.textContent = pendentes.length;

  // ── Resumo por colaborador ──────────────────────────────────────────────────
  const resumo = {};
  avaliados.forEach(c=>{
    // A3: responsável vem do card — assignee, senão o criador no histórico.
    // Não exclui gestores: se a demanda foi cadastrada por alguém registrado,
    // mostra esse colaborador em vez de "desconhecido".
    const creatorKey = (c.history||[]).find(h=>/criad/i.test(h.action||''))?.by;
    const demandaKey = c.assignee || creatorKey || 'desconhecido';
    // Curadoria: identifica o curador pelo próprio card (workers/histórico)
    const k = (tipoF==='curadoria' ? _getCuradoraForCard(c) : demandaKey) || 'desconhecido';
    if(!resumo[k]) resumo[k]={total:0,niveis:{},somaNotas:0};
    resumo[k].total++;
    const nv  = c[field]||'sem_ajuste';
    const lv  = ajusteLabel(nv);
    resumo[k].niveis[nv] = (resumo[k].niveis[nv]||0)+1;
    resumo[k].somaNotas += lv?.nota||0;
  });

  const grid = document.getElementById('indResumoGrid');
  if(grid){
    grid.innerHTML = Object.entries(resumo).map(([k,r])=>{
      const col = state.COLLABS[k]||{label:k,initials:'?',color:'#94A3B8'};
      const barras = AJUSTE_LEVELS.map(lv=>{
        const cnt = r.niveis[lv.id]||0;
        const pct = r.total>0?Math.round((cnt/r.total)*100):0;
        if(!cnt) return '';
        return `<div style="margin-bottom:4px;">
          <div style="display:flex;justify-content:space-between;font-size:0.65rem;font-weight:700;margin-bottom:2px;">
            <span style="color:${lv.color}">${lv.label}</span>
            <span style="font-family:var(--mono);color:var(--muted)">${cnt} (${pct}%)</span>
          </div>
          <div style="height:5px;background:var(--border);border-radius:99px;overflow:hidden;">
            <div style="height:100%;width:${pct}%;background:${lv.color};border-radius:99px;transition:width 0.3s;"></div>
          </div>
        </div>`;
      }).join('');
      const media = r.total>0 ? (r.somaNotas/r.total).toFixed(1) : '—';
      const mediaStars = r.total>0 ? Math.round(r.somaNotas/r.total) : 0;
      return `
        <div style="background:var(--surface);border:1.5px solid var(--border);border-radius:12px;padding:14px 16px;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
            <div style="width:28px;height:28px;border-radius:50%;background:${col.color};display:flex;align-items:center;justify-content:center;font-size:0.6rem;font-weight:800;color:#fff;">${col.initials}</div>
            <div style="flex:1">
              <div style="font-size:0.82rem;font-weight:800;">${col.label}</div>
              <div style="font-size:0.65rem;color:var(--muted);font-family:var(--mono);">${r.total} card${r.total!==1?'s':''} avaliados</div>
            </div>
            <div style="text-align:right;">
              <div style="font-size:1.3rem;font-weight:900;font-family:var(--mono);color:var(--orange);">${media}</div>
              <div style="font-size:0.75rem;letter-spacing:-1px;">${ajusteStars(mediaStars)}</div>
            </div>
          </div>
          ${barras||'<div style="font-size:0.72rem;color:var(--muted)">Sem dados</div>'}
        </div>`;
    }).join('') || '<div style="font-size:0.82rem;color:var(--muted);grid-column:1/-1;">Nenhum card avaliado neste período.</div>';
  }

  // ── Tabela detalhada ────────────────────────────────────────────────────────
  const tbody = document.getElementById('indTableBody');
  if(tbody){
    avaliados.sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
    tbody.innerHTML = avaliados.map(c=>{
      const lv  = ajusteLabel(c[field]);
      // Resolve colaborador conforme a visão: Demanda→responsável; Curadoria→curador.
      const baseKey = (tipoF==='curadoria') ? (c.curador || _getCuradoraForCard(c)) : c.assignee;
      const assigneeId = baseKey || c.assignee || (c.history||[]).find(h=>h.action==='Criado')?.by || '';
      const col = state.COLLABS[assigneeId]||state.COLLABS[c.assignee]||{label:c.assignee||'Não atribuído',initials:'—',color:'#94A3B8'};
      const badgeDiag = ajusteLabel(c.ajuste_diagramacao);
      const badgeCur  = ajusteLabel(c.ajuste_curadoria);
      const ts = c.ajuste_avaliado_em||c.updatedAt||0;
      return `<tr style="border-bottom:1px solid var(--border);">
        <td style="padding:9px 14px;font-size:0.78rem;font-weight:600;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;${c.manual?'':'cursor:pointer;'}" ${c.manual?'':`onclick="openKanbanDetail('${c._key}')"`} title="${c.manual?escH('Adicionada manualmente'+(c.motivo?': '+c.motivo:'')):'Abrir card'}">${escH(c.name||c.title||'Sem nome')}${c.manual?' <span class="ind-manual-tag">✋ manual</span>':''}</td>
        <td style="padding:9px 14px;">
          <div style="display:flex;align-items:center;gap:5px;">
            <div style="width:18px;height:18px;border-radius:50%;background:${col.color};display:flex;align-items:center;justify-content:center;font-size:0.42rem;font-weight:800;color:#fff;">${col.initials}</div>
            <span style="font-size:0.75rem;font-weight:700;">${col.label}</span>
          </div>
        </td>
        <td style="padding:9px 14px;">
          ${badgeDiag?`<span style="font-size:0.68rem;font-weight:700;color:${badgeDiag.color};background:${badgeDiag.bg};border:1px solid ${badgeDiag.border};border-radius:5px;padding:2px 7px;">${badgeDiag.label}</span>`:'<span style="font-size:0.68rem;color:var(--muted);font-style:italic;">—</span>'}
        </td>
        <td style="padding:9px 14px;">
          ${badgeCur?`<span style="font-size:0.68rem;font-weight:700;color:${badgeCur.color};background:${badgeCur.bg};border:1px solid ${badgeCur.border};border-radius:5px;padding:2px 7px;">${badgeCur.label}</span>`:'<span style="font-size:0.68rem;color:var(--muted);font-style:italic;">—</span>'}
        </td>
        <td style="padding:9px 14px;font-size:0.75rem;color:var(--muted);font-style:italic;max-width:220px;">
          ${(()=>{
            const tipoF2 = document.getElementById('indTipoFilter')?.value||'diagramacao';
            const obsVal = tipoF2==='curadoria' ? (c.ajuste_curadoria_obs||'') : (c.ajuste_diagramacao_obs||'');
            return obsVal ? `<span title="${escH(obsVal)}">"${escH(obsVal.length>60?obsVal.slice(0,60)+'…':obsVal)}"</span>` : '<span style="color:var(--border)">—</span>';
          })()}
        </td>
        <td style="padding:9px 14px;font-size:0.7rem;font-family:var(--mono);color:var(--muted);white-space:nowrap;">${ts?new Date(ts).toLocaleDateString('pt-BR'):'—'}${c.manual && (state.isManager||state.isAuditor) ? ` <button onclick="excluirDemandaManual('${c._manualKey}',event)" title="Excluir demanda manual" style="margin-left:6px;background:none;border:1px solid var(--danger);color:var(--danger);border-radius:5px;padding:1px 7px;font-size:0.62rem;font-weight:800;cursor:pointer;">✕</button>` : ''}</td>
      </tr>`;
    }).join('') || `<tr><td colspan="6" style="padding:20px;text-align:center;font-size:0.78rem;color:var(--muted);">Nenhum card avaliado com esses filtros.</td></tr>`;
  }

  // ── Lista de pendentes ──────────────────────────────────────────────────────
  const pendList = document.getElementById('indPendenteList');
  if(pendList){
    pendList.innerHTML = pendentes.slice(0,30).map(c=>{
      const col = state.COLLABS[c.assignee]||{label:c.assignee||'?',initials:'?',color:'#94A3B8'};
      return `<div style="display:flex;align-items:center;gap:10px;background:var(--surface2);border:1.5px solid var(--border);border-radius:9px;padding:9px 14px;cursor:pointer;"
        onclick="openKanbanDetail('${c._key}');setTimeout(()=>showPage('kanban',null),0)">
        <div style="width:20px;height:20px;border-radius:50%;background:${col.color};display:flex;align-items:center;justify-content:center;font-size:0.42rem;font-weight:800;color:#fff;">${col.initials}</div>
        <div style="flex:1;font-size:0.78rem;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escH(c.name||'—')}</div>
        <div style="font-size:0.65rem;font-family:var(--mono);color:var(--muted);">${kColLabel(c.column)||'Arquivo'}</div>
      </div>`;
    }).join('') || '<div style="font-size:0.78rem;color:var(--muted);">✅ Todos os cards avaliados!</div>';
  }
};

// ── DEMANDA MANUAL (existe só nos Indicadores; não vai p/ Kanban nem demandas gerais) ──
function _dmCollabOptions(placeholder){
  return `<option value="">${escH(placeholder)}</option>` +
    Object.entries(state.COLLABS||{}).filter(([,c])=>c.active!==false)
      .sort((a,b)=>(a[1].label||'').localeCompare(b[1].label||'','pt-BR'))
      .map(([k,c])=>`<option value="${escH(k)}">${escH(c.label||k)}</option>`).join('');
}
function _dmNivelOptions(){
  return `<option value="">— não avaliar —</option>` +
    AJUSTE_LEVELS.map(lv=>`<option value="${lv.id}">${escH(lv.label)} (nota ${lv.nota})</option>`).join('');
}
window.openDemandaManualModal = ()=>{
  if(!state.isManager && !state.isAuditor){ showToast('Sem permissão','Apenas gestão/coordenação pode adicionar.'); return; }
  const a = document.getElementById('dmAssignee'); if(a) a.innerHTML = _dmCollabOptions('Selecione o responsável…');
  const cu = document.getElementById('dmCurador');  if(cu) cu.innerHTML = _dmCollabOptions('Selecione o curador…');
  const nv = document.getElementById('dmNivel');     if(nv) nv.innerHTML = _dmNivelOptions();
  const nc = document.getElementById('dmNivelCur');  if(nc) nc.innerHTML = _dmNivelOptions();
  const nome=document.getElementById('dmNome'); if(nome) nome.value='';
  const mot=document.getElementById('dmMotivo'); if(mot) mot.value='';
  const m = document.getElementById('demandaManualModal'); m?.classList.add('open'); if(m) trapFocus(m);
};
window.closeDemandaManualModal = ()=>{ releaseFocus(); document.getElementById('demandaManualModal')?.classList.remove('open'); };
window.saveDemandaManual = async()=>{
  if(!state.isManager && !state.isAuditor){ showToast('Sem permissão',''); return; }
  const nome     = document.getElementById('dmNome')?.value.trim()||'';
  const assignee = document.getElementById('dmAssignee')?.value||'';
  const nivel    = document.getElementById('dmNivel')?.value||'';
  const curador  = document.getElementById('dmCurador')?.value||'';
  const nivelCur = document.getElementById('dmNivelCur')?.value||'';
  const motivo   = document.getElementById('dmMotivo')?.value.trim()||'';
  if(!nome){ showToast('⚠️ Atenção','Informe o nome da demanda.'); return; }
  if(!motivo){ showToast('⚠️ Atenção','Informe o motivo da adição manual.'); return; }
  // Pelo menos uma das duas avaliações; cada avaliação preenchida exige seu colaborador.
  if(!nivel && !nivelCur){ showToast('⚠️ Atenção','Preencha ao menos uma avaliação (Demanda ou Curadoria).'); return; }
  if(nivel && !assignee){ showToast('⚠️ Atenção','Selecione o responsável pela Demanda.'); return; }
  if(nivelCur && !curador){ showToast('⚠️ Atenção','Selecione o curador da Curadoria.'); return; }
  const now = Date.now();
  const reg = {
    name: nome.slice(0,120),
    motivo: motivo.slice(0,300),
    manual: true,
    ajuste_avaliado_em: now,
    createdAt: now,
    createdBy: state.currentUser?.email || 'desconhecido'
  };
  if(nivel){ reg.assignee = assignee; reg.ajuste_diagramacao = nivel; reg.ajuste_diagramacao_obs = motivo.slice(0,300); }
  if(nivelCur){ reg.curador = curador; reg.ajuste_curadoria = nivelCur; reg.ajuste_curadoria_obs = motivo.slice(0,300); }
  try{
    await push(indicadoresManuaisRef, reg);
    registrarLog('avaliar','Adicionou demanda manual', `${nome}${nivel?` · Demanda ${ajusteLabel(nivel)?.label||nivel}`:''}${nivelCur?` · Curadoria ${ajusteLabel(nivelCur)?.label||nivelCur}`:''}`);
    showToast('✅ Demanda manual adicionada','Aparece somente nos Indicadores.');
    closeDemandaManualModal();
    renderIndicadores();
  }catch(e){
    showToast('Erro','Não foi possível salvar a demanda manual.');
    console.error('[saveDemandaManual]', e);
  }
};
// Exclui uma demanda adicionada manualmente (só gestão/coordenação)
window.excluirDemandaManual = async(manualKey, ev)=>{
  if(ev) ev.stopPropagation();
  if(!state.isManager && !state.isAuditor){ showToast('Sem permissão','Apenas gestão/coordenação pode excluir.'); return; }
  if(!manualKey){ return; }
  if(!confirm('Excluir esta demanda manual? Ela some dos Indicadores.')) return;
  try{
    await remove(child(indicadoresManuaisRef, manualKey));
    registrarLog('avaliar','Excluiu demanda manual', manualKey);
    showToast('Demanda manual excluída','');
    renderIndicadores();
  }catch(e){
    showToast('Erro','Não foi possível excluir a demanda manual.');
    console.error('[excluirDemandaManual]', e);
  }
};

// Export CSV dos indicadores
window.exportIndicadoresCSV = ()=>{
  if(!state.isManager && !state.isAuditor) return;
  const tipoF = document.getElementById('indTipoFilter')?.value||'diagramacao';
  const field = tipoF==='curadoria'?'ajuste_curadoria':'ajuste_diagramacao';
  const all = _indGetAllCards().filter(c=>c[field]);
  const rows = [['Disciplina','Colaborador','Ajuste Diagramação','Nota Diag.','Justificativa Diag.','Ajuste Curadoria','Nota Cur.','Justificativa Cur.','Data']];
  all.forEach(c=>{
    const col = state.COLLABS[c.assignee]||{label:c.assignee||'?'};
    const ts  = c.ajuste_avaliado_em||c.updatedAt||0;
    const lvD = ajusteLabel(c.ajuste_diagramacao);
    const lvC = ajusteLabel(c.ajuste_curadoria);
    rows.push([
      c.name||'',
      col.label,
      lvD?.label||'—',
      lvD?.nota||'—',
      c.ajuste_diagramacao_obs||'—',
      lvC?.label||'—',
      lvC?.nota||'—',
      c.ajuste_curadoria_obs||'—',
      ts?new Date(ts).toLocaleDateString('pt-BR'):'—',
    ]);
  });
  const csv = rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const a=document.createElement('a');
  a.href='data:text/csv;charset=utf-8,\uFEFF'+encodeURIComponent(csv);
  a.download=`indicadores_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
};

window.closeKanbanDetail=()=>{ releaseFocus(); document.getElementById('kanbanDetailModal').classList.remove('open'); state.currentKanbanDetailId=null; };

// ── LINKS INLINE NO DETALHE DO CARD ──────────────────────────────────────────
// Renderiza lista de links com campos editáveis + botão remover
function kdRenderLinks(links){
  const list = document.getElementById('kdLinksList');
  if(!list) return;
  // ✅ FIX: não filtra vazios aqui — permite campo novo vazio ser editável
  const arr = links||[];
  const hasReal = arr.some(l=>l&&l.trim());

  if(!arr.length){
    list.innerHTML = '<span style="font-size:0.75rem;color:var(--muted);font-style:italic;padding:4px 0;">Nenhum link adicionado ainda.</span>';
    return;
  }

  // Renderiza cada link como linha
  list.innerHTML = '';
  arr.forEach((l, i)=>{
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:6px;';
    row.id = 'kdlrow-'+i;

    // Input editável
    const inp = document.createElement('input');
    inp.type = 'text'; // texto em vez de url — evita validação que bloqueia edição
    inp.value = l||'';
    inp.placeholder = 'https://...';
    inp.style.cssText = 'flex:1;background:var(--surface2);border:1.5px solid var(--border);border-radius:8px;padding:6px 10px;color:var(--text);font-family:var(--mono);font-size:0.72rem;outline:none;';
    inp.addEventListener('focus', ()=>{ inp.style.borderColor='var(--orange)'; });
    inp.addEventListener('blur', ()=>{
      inp.style.borderColor='var(--border)';
      kdSaveLinks();
    });
    inp.addEventListener('keydown', (e)=>{
      if(e.key==='Enter'){ e.preventDefault(); kdSaveLinks(); inp.blur(); }
    });

    // Link clicável (só se tiver valor)
    const a = document.createElement('a');
    a.href = sanitizeUrl(l) || '#';   // SEC: bloqueia javascript:/data:
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.title = 'Abrir link';
    a.textContent = '↗';
    a.style.cssText = 'color:var(--orange);font-size:0.9rem;text-decoration:none;flex-shrink:0;padding:4px;';
    a.style.opacity = l ? '1' : '0.3';
    a.style.pointerEvents = l ? 'auto' : 'none';
    // Atualiza href ao digitar
    inp.addEventListener('input', ()=>{
      a.href = sanitizeUrl(inp.value) || '#';   // SEC: bloqueia javascript:/data:
      a.style.opacity = inp.value ? '1' : '0.3';
      a.style.pointerEvents = inp.value ? 'auto' : 'none';
    });

    // Botão remover
    const btn = document.createElement('button');
    btn.textContent = '✕';
    btn.title = 'Remover link';
    btn.style.cssText = 'background:none;border:none;color:var(--muted);cursor:pointer;font-size:0.85rem;padding:4px;flex-shrink:0;line-height:1;';
    btn.addEventListener('mouseenter', ()=>btn.style.color='var(--danger)');
    btn.addEventListener('mouseleave', ()=>btn.style.color='var(--muted)');
    btn.addEventListener('click', ()=>kdRemoveLink(i));

    row.appendChild(inp);
    row.appendChild(a);
    row.appendChild(btn);
    list.appendChild(row);
  });

  // Foca no último input se for vazio (novo campo)
  const allInputs = list.querySelectorAll('input');
  const last = allInputs[allInputs.length-1];
  if(last && !last.value) last.focus();
}

window.kdAddLinkRow = ()=>{
  const key = state.currentKanbanDetailId;
  if(!key){ showToast('Erro','Abra o card novamente e tente.'); return; }
  // Lê links atuais do DOM + adiciona vazio
  const existingInputs = [...document.querySelectorAll('#kdLinksList input')];
  const currentLinks = existingInputs.map(i=>i.value.trim()).filter(Boolean);
  kdRenderLinks([...currentLinks, '']);
  // Foca e salva ao sair
  const inputs = document.querySelectorAll('#kdLinksList input');
  if(inputs.length){
    const last = inputs[inputs.length-1];
    last.focus();
    last.addEventListener('blur', async ()=>{
      const val = last.value.trim();
      if(!val) return; // não salva se vazio
      await kdSaveLinksNow([...currentLinks, val]);
    }, {once:true});
    last.addEventListener('keydown', async (e)=>{
      if(e.key==='Enter'){
        e.preventDefault();
        const val = last.value.trim();
        if(val) await kdSaveLinksNow([...currentLinks, val]);
        last.blur();
      }
    }, {once:true});
  }
};

// Salva links imediatamente com os valores fornecidos
window.kdSaveLinksNow = async(links)=>{
  const key = state.currentKanbanDetailId; if(!key) return;
  const card = state.kanbanCards[key]; if(!card) return;
  const clean = links.filter(l=>l && l.trim());
  try{
    await set(child(kanbanRef, key),{
      ...card,
      links: clean,
      modifiedBy: state.currentUser?.email||'desconhecido',
      updatedAt: Date.now()
    });
    kdRenderLinks(clean);
    showToast('Link salvo','Link adicionado com sucesso.');
  }catch(err){
    showToast('Erro','Falha ao salvar link.');
    console.error('[kdSaveLinksNow]',err);
  }
};

// Salva links ao sair do campo (blur) — usa kdSaveLinksNow
window.kdSaveLinks = async()=>{
  const inputs = [...document.querySelectorAll('#kdLinksList input')];
  const links = inputs.map(i=>i.value.trim()).filter(Boolean);
  await kdSaveLinksNow(links);
};

// Remove link por índice e salva imediatamente
window.kdRemoveLink = async(idx)=>{
  const inputs = [...document.querySelectorAll('#kdLinksList input')];
  const links = inputs.map(i=>i.value.trim()).filter(Boolean).filter((_,i)=>i!==idx);
  try{
    await kdSaveLinksNow(links);
    kdRenderLinks(links);
  }catch(err){
    showToast('Erro','Falha ao remover link.');
    console.error('[kdRemoveLink]',err);
  }
};
window.deleteKanbanCard=async(key)=>{
  // ✅ FIX: "Excluir" agora arquiva na lixeira — mesmo padrão do botão ⤵ do card
  const card=state.kanbanCards[key]; if(!card) return;
  if(!confirm(`Arquivar "${card.name||'este card'}" na Lixeira?`)) return;
  const now=Date.now();
  const hist=[...(card.history||[]),{action:'Arquivado na Lixeira',by:state.currentCollabKey,ts:now}];
  try{
    await set(child(kanbanRef, key),{...card,column:'lixeira',archivedAt:now,archived:true,history:hist,modifiedBy:state.currentUser?.email||'desconhecido'});
    closeKanbanDetail();
    showToast('Card arquivado','Movido para a Lixeira.');
  }catch(err){
    showToast('Erro','Falha ao arquivar. Tente novamente.');
    console.error('[deleteKanbanCard]',err);
  }
};

document.getElementById('kanbanCardModal')?.addEventListener('click',e=>{if(e.target===e.currentTarget)closeKanbanCardModal();});
document.getElementById('kanbanDetailModal')?.addEventListener('click',e=>{if(e.target===e.currentTarget)closeKanbanDetail();});

// ── ADD TO KANBAN FROM TIMER / MEUS REGISTROS ─────────────────────────────────
// ✅ FIX BUG 4: state.currentCollabKey em vez de state.currentUser no histórico
window.addEntryToKanban = (entryKey)=>{
  const entry = state.allEntries[entryKey];
  if(!entry){ showToast('Erro','Registro não encontrado.'); return; }
  const existing = Object.values(state.kanbanCards||{}).find(card=>card.fromEntryKey===entryKey);
  if(existing){ showToast('Já adicionado','Este registro já está no Fluxo de Demandas.'); return; }

  // ✅ Item 4: abre modal de Nova Disciplina pré-preenchido com dados da entrada
  // O usuário pode adicionar links, ajustar tipo e confirmar antes de salvar
  state.editingKanbanId = null;
  _refreshKModuleSelect();
  document.getElementById('kanbanCardModalTitle').textContent = 'Nova Disciplina';
  window.clearTags(document.getElementById('kcTagsWrap'));
  document.getElementById('kcLinksList').innerHTML = '';
  document.getElementById('kcName').value = entry.task || '';
  _setKcAssignees(entry.collab ? [entry.collab] : (state.currentCollabKey ? [state.currentCollabKey] : []));
  // Usa a primeira coluna de trabalho da equipe ativa (não lixeira, não concluido)
  const firstCol = (state.K_COLS||[]).find(c=>!['lixeira','concluido'].includes(c.id));
  document.getElementById('kcColumn').value = firstCol?.id || (state.K_COLS?.[0]?.id || '');
  document.getElementById('kcObs').value = entry.obs || '';
  const km = document.getElementById('kcModule'); if(km) km.value = 'none';
  window.setTags(document.getElementById('kcTagsWrap'), entry.tags||[]);
  // Guarda referência para vincular fromEntryKey ao salvar
  window._pendingFromEntryKey = entryKey;
  document.getElementById('kanbanCardModal').classList.add('open');
};

window.clearKanbanFilters=()=>{
  document.getElementById('kanbanSearch').value='';
  document.getElementById('kanbanFilterCollab').value='';
  document.getElementById('kanbanFilterType').value='';
  renderKanban();
};

// ── SIDEBAR GROUPS ────────────────────────────────────────────────────────────
window.toggleNavGroup = (titleEl)=>{
  const body = titleEl.nextElementSibling;
  const isOpen = titleEl.classList.contains('open');
  if(isOpen){
    titleEl.classList.remove('open');
    body.style.display='none';
  } else {
    titleEl.classList.add('open');
    body.style.display='block';
  }
};

// ── AVATAR SYSTEM ─────────────────────────────────────────────────────────────
let avatarState = { emoji: '😊', color: '#F15A24' };

export function initAvatarsListener() {
  return onValue(avatarsRef,(snap)=>{
    state.allAvatars = snap.val()||{};
    // D8: nome de exibição escolhido pelo colaborador sobrepõe o nome da config
    // (armazenado em avatars/{key}, que o próprio colaborador pode escrever).
    // SEC: sanitiza ao consumir — a regra permite o usuário escrever a própria
    // avatars/{key} direto na API, então não confiamos no valor cru (XSS via label).
    Object.entries(state.allAvatars).forEach(([k,av])=>{
      if(av?.nome && state.COLLABS[k]) state.COLLABS[k].label = String(av.nome).replace(/[<>]/g,'').slice(0,40);
    });
    if(state.currentCollabKey && state.allAvatars[state.currentCollabKey]){
      const av = state.allAvatars[state.currentCollabKey];
      avatarState = av;
      updateSidebarAvatar(av);
    }
    if(document.getElementById('page-dashboard')?.classList.contains('active')) renderDashCards();
  });
}

function updateSidebarAvatar(av){
  const el = document.getElementById('sidebarAv');
  if(el){
    const photo = (typeof av.foto==='string' && /^data:image\//.test(av.foto)) ? av.foto : null;
    if(photo){
      el.innerHTML = `<img src="${av.foto}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;display:block;">`;
      el.style.overflow = 'hidden';
    } else {
      el.innerHTML = '';
      el.textContent = av.emoji||state.COLLABS[state.currentCollabKey]?.initials||'?';
      el.style.background = av.color||state.COLLABS[state.currentCollabKey]?.color||'#F15A24';
      el.style.fontSize = av.emoji ? '1.1rem' : '0.7rem';
    }
  }
  // D8: nome de exibição na sidebar
  const nameEl = document.getElementById('sidebarName');
  if(nameEl && av.nome) nameEl.textContent = av.nome;
}

// getCollabAvatar → js/dashboard.js
window.openAvatarPicker = ()=>{
  const av = state.allAvatars[state.currentCollabKey]||{emoji:'😊',color:'#F15A24'};
  avatarState = {...av};
  updateAvatarPreview();
  // D8: popula o campo de nome e o disco cromático com os valores atuais
  const nameInput = document.getElementById('avatarNameInput');
  if(nameInput) nameInput.value = av.nome || state.COLLABS[state.currentCollabKey]?.label || '';
  const wheel = document.getElementById('avatarColorWheel');
  if(wheel && av.color) wheel.value = av.color;
  document.querySelectorAll('.avatar-opt').forEach(o=>o.classList.remove('selected'));
  document.querySelectorAll('.color-opt').forEach(o=>o.classList.remove('selected'));
  const matchEmoji = [...document.querySelectorAll('.avatar-opt')].find(o=>o.textContent===av.emoji);
  if(matchEmoji) matchEmoji.classList.add('selected');
  const matchColor = [...document.querySelectorAll('.color-opt')].find(o=>o.style.background===av.color||o.getAttribute('onclick')?.includes(av.color));
  if(matchColor) matchColor.classList.add('selected');
  const m = document.getElementById('avatarModal');
  m.classList.add('open');
  trapFocus(m);   // a11y: prende o foco no modal
};
window.closeAvatarPicker = ()=>{ releaseFocus(); document.getElementById('avatarModal').classList.remove('open'); };

window.selectEmoji = (el,emoji)=>{
  document.querySelectorAll('.avatar-opt').forEach(o=>o.classList.remove('selected'));
  el.classList.add('selected');
  avatarState.emoji = emoji;
  updateAvatarPreview();
};
window.selectColor = (el,color)=>{
  document.querySelectorAll('.color-opt').forEach(o=>o.classList.remove('selected'));
  el.classList.add('selected');
  avatarState.color = color;
  const wheel = document.getElementById('avatarColorWheel'); if(wheel) wheel.value = color;
  updateAvatarPreview();
};
// D8: disco cromático — cor livre que desmarca as predefinidas
window.selectColorWheel = (color)=>{
  document.querySelectorAll('.color-opt').forEach(o=>o.classList.remove('selected'));
  avatarState.color = color;
  updateAvatarPreview();
};
function updateAvatarPreview(){
  const p = document.getElementById('avatarPreview');
  if(!p) return;
  const rm = document.getElementById('avatarRemovePhotoBtn');
  if(avatarState.foto && /^data:image\//.test(avatarState.foto)){
    p.innerHTML = `<img src="${avatarState.foto}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;display:block;">`;
    if(rm) rm.style.display = '';
  } else {
    p.innerHTML = '';
    p.textContent = avatarState.emoji||'😊';
    p.style.background = avatarState.color||'#F15A24';
    if(rm) rm.style.display = 'none';
  }
}
window.handleAvatarPhoto = async (input)=>{
  const file = input.files && input.files[0];
  if(!file) return;
  try{
    const dataUrl = await resizeImageToDataURL(file, 128, 0.72);
    // Guarda de tamanho: evita estourar o banco (foto deve ser pequena)
    if(dataUrl.length > 60000){
      showToast('Imagem muito pesada','Tente uma foto menor/mais simples.'); return;
    }
    avatarState.foto = dataUrl;
    updateAvatarPreview();
  }catch(e){
    showToast('Erro','Não foi possível processar a imagem.');
    console.error('[handleAvatarPhoto]', e);
  } finally { input.value=''; }
};
window.removeAvatarPhoto = ()=>{ avatarState.foto = null; updateAvatarPreview(); };
window.saveAvatar = async()=>{
  // D8: salva emoji, cor e nome de exibição (campos explícitos — evita lixo do estado)
  // SEC: remove <> — o nome vai para state.COLLABS[].label, usado em templates sem escH
  const nome = (document.getElementById('avatarNameInput')?.value||'').trim().replace(/[<>]/g,'').slice(0,40);
  const toSave = { emoji: avatarState.emoji||'😊', color: avatarState.color||'#F15A24' };
  if(nome) toSave.nome = nome;
  // set() sobrescreve o nó: incluir foto quando houver; omitir = remover a foto
  if(avatarState.foto && /^data:image\//.test(avatarState.foto)) toSave.foto = avatarState.foto;
  if(!state.currentCollabKey){ showToast('Erro','Não foi possível identificar seu usuário. Recarregue a página.'); return; }
  try{
    await set(child(avatarsRef, state.currentCollabKey), toSave);
  }catch(err){
    showToast('Erro ao salvar','Não foi possível salvar o perfil. Verifique sua conexão/permissão.');
    console.error('[saveAvatar]', err);
    return;
  }
  if(nome && state.COLLABS[state.currentCollabKey]) state.COLLABS[state.currentCollabKey].label = nome;
  avatarState = toSave;
  updateSidebarAvatar(toSave);
  closeAvatarPicker();
  showToast('Perfil atualizado!','Seu avatar e nome já estão ativos.');
};
document.getElementById('avatarModal')?.addEventListener('click',e=>{if(e.target===e.currentTarget)closeAvatarPicker();});
document.getElementById('avatarModal')?.addEventListener('keydown',e=>{if(e.key==='Escape')closeAvatarPicker();});

// ── CONQUISTAS ────────────────────────────────────────────────────────────────
// getConquistas → js/dashboard.js
// ── ARQUIVO MORTO ────────────────────────────────────────────────────────────
// state.MODS do Arquivo Morto — stored in state so index_v2.js can also access them
state.MODS = state.MODS?.length ? state.MODS : [
  {id:'TRELLO',label:'Importados do Trello',months:null,color:'#0052CC'},
  {id:'MOD1',label:'MOD 1 — Jan / Fev / Mar',months:[0,1,2],color:'#7C6AFF'},
  {id:'MOD2',label:'MOD 2 — Abr / Mai / Jun',months:[3,4,5],color:'#10B981'},
  {id:'MOD3',label:'MOD 3 — Jul / Ago / Set',months:[6,7,8],color:'#F59E0B'},
  {id:'MOD4',label:'MOD 4 — Out / Nov / Dez',months:[9,10,11],color:'#EF4444'},
];

function getModForDate(ts){
  const m = new Date(ts).getMonth();
  return state.MODS.find(mod=>mod.months?.includes(m)) || state.MODS.find(mod=>mod.id!=='TRELLO') || state.MODS[0];
}

async function checkArquivoMigration(){
  // Usa cache em state para evitar leitura Firebase a cada chamada
  let dias = 15, colunaDestino = 'auto', colunaKanban = 'concluido';
  if(state._arquivoConfig) {
    dias          = state._arquivoConfig.diasParaArquivar || 15;
    colunaDestino = state._arquivoConfig.colunaDestino    || 'auto';
    colunaKanban  = state._arquivoConfig.colunaKanban     || 'concluido';
  } else {
    try {
      const cfgSnap = await get(ref(db,`equipes/${EQUIPE_ID}/config/arquivo_config`));
      const cfg = cfgSnap.val();
      if(cfg) {
        state._arquivoConfig = cfg; // cacheia para chamadas futuras
        dias = cfg.diasParaArquivar || 15;
        colunaDestino = cfg.colunaDestino || 'auto';
        colunaKanban  = cfg.colunaKanban  || 'concluido';
      }
    } catch(e) {}
  }

  const cutoff = Date.now() - dias * 24 * 60 * 60 * 1000;
  for(const [key,card] of Object.entries(state.kanbanCards)){
    if(card.column === colunaKanban && card.updatedAt && card.updatedAt < cutoff && !card.archived){
      let modId;
      if(colunaDestino === 'auto') {
        modId = getModForDate(card.createdAt||Date.now()).id;
      } else {
        modId = colunaDestino;
      }
      await set(child(kanbanRef, key),{...card,archived:true,archivedAt:Date.now(),module:modId});
    }
  }
}


// ── AUTOCOMPLETE DO ARQUIVO MORTO NO CAMPO DE BUSCA DO KANBAN ────────────────
window._updateArquivoDropdown = (query)=>{
  const drop = document.getElementById('kanbanSearchDropdown');
  if(!drop) return;
  const q = (query||'').toLowerCase().trim();
  if(!q){ drop.classList.remove('visible'); return; }

  const matches = getArchivedCards()
    .filter(c=>(c.name||'').toLowerCase().includes(q))
    .slice(0, 8);

  if(!matches.length){ drop.classList.remove('visible'); return; }

  drop.innerHTML = matches.map(card=>{
    const mod = state.MODS.find(m=>m.id===card.module)||{};
    const col = state.COLLABS[card.assignee]||{};
    return `<div class="k-search-drop-item" onmousedown="event.preventDefault()" onclick="window._goToArquivoCard('${escH(card._key)}','${escH((card.name||'').replace(/'/g,"\\'"))}')">
      <div class="k-search-drop-name">${escH(card.name||'Sem título')}</div>
      <div class="k-search-drop-meta">
        <span style="color:${mod.color||'#94A3B8'}">${escH(mod.label||'Arquivo Morto')}</span>
        ${col.label?` · ${escH(col.label)}`:''}
      </div>
    </div>`;
  }).join('') +
  `<div class="k-search-drop-footer">${matches.length} resultado${matches.length!==1?'s':''} no Arquivo Morto — clique para abrir</div>`;

  drop.classList.add('visible');
};

window._hideArquivoDropdown = ()=>{
  document.getElementById('kanbanSearchDropdown')?.classList.remove('visible');
};

window._goToArquivoCard = (key, name)=>{
  window._hideArquivoDropdown();
  const kanbanInput = document.getElementById('kanbanSearch');
  if(kanbanInput){ kanbanInput.value = ''; window.renderKanban?.(); }
  window.showPage?.('arquivo');
  setTimeout(()=>{
    const arquivoInput = document.getElementById('arquivoSearch');
    if(arquivoInput){ arquivoInput.value = name; window.renderArquivo?.(); }
  }, 120);
};

export function initArquivoListener() {
  return onValue(arquivoRef,(snap)=>{ state.arquivoCards=snap.val()||{}; window._arquivoCards=state.arquivoCards; if(document.getElementById('page-arquivo')?.classList.contains('active')) renderArquivo(); });
}

function getArchivedCards(){
  const archived = Object.entries(state.kanbanCards).filter(([,c])=>c.archived).map(([k,c])=>({...c,_key:k}));
  return [...archived,...Object.entries(state.arquivoCards).map(([k,c])=>({...c,_key:k}))];
}

window.renderArquivo = ()=>{
  const board = document.getElementById('arquivoBoard'); if(!board) return;
  _refreshArquivoTypeFilter();
  const modFilter    = document.getElementById('arquivoModFilter')?.value||'';
  const collabFilter = document.getElementById('arquivoCollabFilter')?.value||'';
  const typeFilter   = document.getElementById('arquivoTypeFilter')?.value||'';
  const search       = (document.getElementById('arquivoSearch')?.value||'').toLowerCase().trim();
  // Deep archive: cards com > 60 dias no arquivo não são renderizados por padrão
  const DEEP_ARCHIVE_MS = 60 * 24 * 60 * 60 * 1000;
  const showOld = document.getElementById('arquivoShowOld')?.dataset.show === '1';
  const cutoffDeep = Date.now() - DEEP_ARCHIVE_MS;
  const allRaw = getArchivedCards();
  const all = showOld ? allRaw : allRaw.filter(c=>(c.archivedAt||c.updatedAt||0) >= cutoffDeep);
  const hiddenCount = allRaw.length - all.length;
  // Atualiza label do botão com contagem oculta
  const btnOld = document.getElementById('arquivoShowOld');
  if(btnOld && hiddenCount > 0 && !showOld){
    btnOld.textContent = `🗃 Mostrar cards antigos (+60 dias) — ${hiddenCount} oculto${hiddenCount>1?'s':''}`;
  }
  const mods = modFilter ? state.MODS.filter(m=>m.id===modFilter) : state.MODS;
  cleanLixeira();

  const lixeiraCards = Object.entries(state.kanbanCards)
    .filter(([,card])=>card.column==='lixeira')
    .map(([k,card])=>({...card,_key:k}))
    .sort((a,b)=>(b.archivedAt||0)-(a.archivedAt||0));

  // Botão arquivar Trello: só gestora e só quando há concluídos do Trello
  const btnAT = document.getElementById('btnArquivarTrello');
  if(btnAT){
    const hasTrelloConcluidos = state.isManager && Object.values(state.kanbanCards||{})
      .some(c=>c.column==='concluido' && c.importedFrom==='trello' && !c.archived);
    btnAT.style.display = hasTrelloConcluidos ? '' : 'none';
  }

  board.innerHTML = mods.map(mod=>{
    let cards;
    if(mod.id==='TRELLO'){
      // Coluna especial: todos os cards arquivados com origem Trello
      cards = all.filter(c=>c.importedFrom==='trello');
    } else {
      cards = all.filter(c=>c.module===mod.id && c.importedFrom!=='trello');
    }
    if(collabFilter) cards = cards.filter(c=>kIsAssignee(c,collabFilter));
    if(typeFilter) cards = cards.filter(c=>(c.tags||[]).some(t=>t.includes(typeFilter)));
    if(search) cards = cards.filter(c=>(c.name||'').toLowerCase().includes(search));
    cards.sort((a,b)=>(b.archivedAt||0)-(a.archivedAt||0));
    return `<div class="k-col" style="width:260px;">
      <div class="k-col-header" style="border-bottom:3px solid ${mod.color}">
        <div class="k-col-title">${mod.label}</div>
        <div class="k-col-count">${cards.length}</div>
      </div>
      <div class="k-col-body">
        ${cards.length?cards.map(card=>{
          const col=state.COLLABS[card.assignee]||{label:card.assignee||'?',initials:'?',color:'#94A3B8'};
          const labelsHtml=(card.tags||[]).slice(0,2).map(t=>{const lc=kLabelColor(t);return`<span class="k-card-label" style="background:${lc.bg};border:1px solid ${lc.border};color:${lc.color}">${escH(t)}</span>`;}).join('');
          // ✅ NOVO: links clicáveis no arquivo morto
          const linksHtml=(card.links||[]).filter(Boolean).map(l=>`<a class="k-card-link" href="${escH(sanitizeUrl(l))}" target="_blank" rel="noopener noreferrer">${ICONS.link} ${escH(l.replace(/https?:\/\/(www\.)?/,'').slice(0,30))}</a>`).join('');
          return`<div class="k-card" style="opacity:0.85;cursor:pointer;" onclick="openKanbanDetail('${card._key}')">
            <div class="k-card-name">${escH(card.name||'Sem título')}</div>
            ${labelsHtml?`<div class="k-card-labels">${labelsHtml}</div>`:''}
            ${linksHtml?`<div class="k-card-links">${linksHtml}</div>`:''}
            <div class="k-card-meta">
              <div class="k-card-assignee"><div class="k-card-av" style="background:${col.color}">${col.initials}</div>${col.label}</div>
              ${card.hours?`<span class="k-card-hours">${ICONS.clock} ${kFmtHours(card.hours)}</span>`:''}
            </div>
            <div style="font-family:var(--mono);font-size:0.58rem;color:var(--muted);margin-top:5px;">Arquivado em ${card.archivedAt?new Date(card.archivedAt).toLocaleDateString('pt-BR'):'-'}</div>
          </div>`;
        }).join(''):`<div style="font-size:0.75rem;color:var(--muted);text-align:center;padding:20px;">Nenhuma disciplina neste módulo</div>`}
      </div>
    </div>`;
  }).join('') +
  // ✅ NOVO: Lixeira com botão desarquivar por card e botão limpar lixeira
  `<div class="k-col" style="width:260px;">
    <div class="k-col-header" style="border-bottom:3px solid #EF4444">
      <div class="k-col-title">🗑 Lixeira</div>
      <div class="k-col-count">${lixeiraCards.length}</div>
    </div>
    <div class="k-col-body">
      <div style="font-size:0.62rem;color:var(--muted);text-align:center;margin-bottom:6px;">Cards removidos automaticamente após 30 dias</div>
      ${state.isManager&&lixeiraCards.length?`<button onclick="clearLixeira()" style="width:100%;margin-bottom:8px;padding:5px 0;background:none;border:1px solid var(--danger);color:var(--danger);border-radius:6px;font-size:0.72rem;font-weight:700;cursor:pointer;">${ICONS.trash} Limpar lixeira (${lixeiraCards.length})</button>`:''}
      ${lixeiraCards.length?lixeiraCards.map(card=>{
        const col=state.COLLABS[card.assignee]||{label:card.assignee||'?',initials:'?',color:'#94A3B8'};
        return`<div class="k-card" style="opacity:0.75;">
          <div class="k-card-name" style="cursor:default;">${escH(card.name||'')}</div>
          <div class="k-card-meta">
            <div class="k-card-assignee"><div class="k-card-av" style="background:${col.color}">${col.initials}</div>${col.label}</div>
            <span style="font-family:var(--mono);font-size:0.58rem;color:var(--muted)">${card.archivedAt?new Date(card.archivedAt).toLocaleDateString('pt-BR'):''}</span>
          </div>
          ${state.isManager?`<button onclick="unarchiveKanbanCard('${card._key}')" style="width:100%;margin-top:6px;padding:4px 0;background:none;border:1px solid var(--orange);color:var(--orange);border-radius:6px;font-size:0.7rem;font-weight:700;cursor:pointer;">${ICONS.archive} Desarquivar</button>`:''}
        </div>`;
      }).join(''):`<div style="font-size:0.75rem;color:var(--muted);text-align:center;padding:20px;">Lixeira vazia</div>`}
    </div>
  </div>`;
  _setupArquivoPan();
};

// ── Modal de escolha de arquivamento (Arquivo Morto vs Lixeira) ──────────────
let _archiveChoiceKey = null;

window.openArchiveChoiceModal = (key)=>{
  const card = state.kanbanCards[key]; if(!card) return;
  _archiveChoiceKey = key;

  const nameEl = document.getElementById('archChoiceCardName');
  if(nameEl) nameEl.textContent = `"${card.name||'Sem título'}"`;

  const sel = document.getElementById('archChoiceModSelect');
  if(sel){
    const suggested = getModForDate(card.createdAt||Date.now());
    sel.innerHTML = state.MODS.filter(m=>m.id!=='TRELLO').map(m=>
      `<option value="${escH(m.id)}" ${m.id===suggested.id?'selected':''}>${escH(m.label)}</option>`
    ).join('');
  }

  const confirmArqBtn = document.getElementById('archChoiceConfirmArq');
  if(confirmArqBtn){
    const fresh = confirmArqBtn.cloneNode(true);
    confirmArqBtn.parentNode.replaceChild(fresh, confirmArqBtn);
    fresh.addEventListener('click', e=>{ e.stopPropagation(); window.kArchiveToMorto(_archiveChoiceKey, document.getElementById('archChoiceModSelect')?.value); });
  }

  const lixOpt = document.getElementById('archChoiceOptionLix');
  if(lixOpt){
    const fresh = lixOpt.cloneNode(true);
    lixOpt.parentNode.replaceChild(fresh, lixOpt);
    fresh.id = 'archChoiceOptionLix';
    fresh.addEventListener('click', ()=>window.kArchiveToLixeira(_archiveChoiceKey));
  }

  // Libera o trapFocus do kanbanDetailModal antes de abrir o novo modal
  releaseFocus();
  const modal = document.getElementById('archiveChoiceModal');
  if(modal){ modal.classList.add('open'); trapFocus(modal); }
};

window.closeArchiveChoiceModal = ()=>{
  releaseFocus();
  const modal = document.getElementById('archiveChoiceModal');
  if(modal) modal.classList.remove('open');
  _archiveChoiceKey = null;
};

window.kArchiveToMorto = async(key, modId)=>{
  const card = state.kanbanCards[key]; if(!card) return;
  closeArchiveChoiceModal();
  closeKanbanDetail();
  const targetMod = modId || getModForDate(card.createdAt||Date.now()).id;
  const now = Date.now();
  const hist = [...(card.history||[]),{action:'Arquivado no Arquivo Morto',modulo:targetMod,by:state.currentCollabKey,ts:now}];
  try{
    await set(child(kanbanRef,key),{...card,archived:true,archivedAt:now,module:targetMod,history:hist,modifiedBy:state.currentUser?.email||'desconhecido'});
    showToast('Arquivado','Card movido para o Arquivo Morto.');
  }catch(e){
    showToast('Erro','Falha ao arquivar. Tente novamente.');
    console.error('[kArchiveToMorto]',e);
  }
};

window.kArchiveToLixeira = async(key)=>{
  const card = state.kanbanCards[key]; if(!card) return;
  closeArchiveChoiceModal();
  closeKanbanDetail();
  const now = Date.now();
  const hist = [...(card.history||[]),{action:'Arquivado na Lixeira',by:state.currentCollabKey,ts:now}];
  try{
    await set(child(kanbanRef,key),{...card,column:'lixeira',archivedAt:now,archived:true,history:hist,modifiedBy:state.currentUser?.email||'desconhecido'});
    showToast('Card excluído','Movido para a Lixeira.');
  }catch(e){
    showToast('Erro','Falha ao mover para lixeira. Tente novamente.');
    console.error('[kArchiveToLixeira]',e);
  }
};

// ── Arquivar em lote: concluídos do Trello → coluna Trello do Arquivo Morto ──
window.arquivarConcluidosTrello = async()=>{
  if(!state.isManager){ showToast('Sem permissão','Apenas a gestora pode arquivar em lote.'); return; }
  const candidates = Object.entries(state.kanbanCards||{})
    .filter(([,c])=>c.column==='concluido' && c.importedFrom==='trello' && !c.archived);
  if(!candidates.length){
    showToast('ℹ️ Nada a arquivar','Não há concluídos do Trello no Kanban.');
    return;
  }
  if(!confirm(`Arquivar ${candidates.length} disciplina(s) concluída(s) do Trello para o Arquivo Morto?\nEsta ação pode ser desfeita desarquivando os cards individualmente.`)) return;
  const now = Date.now();
  let done = 0;
  try{
    for(const [key, card] of candidates){
      const hist = [...(card.history||[]), {
        action: 'Arquivado em lote (Trello)',
        by: state.currentCollabKey||state.currentUser?.email||'gestora',
        ts: now
      }];
      await set(child(kanbanRef, key),{
        ...card,
        archived: true,
        archivedAt: now,
        module: 'TRELLO',
        history: hist,
        modifiedBy: state.currentUser?.email||'desconhecido'
      });
      done++;
    }
    showToast('✅ Arquivados!', `${done} disciplina(s) movida(s) para o Arquivo Morto — coluna Trello.`);
    window.renderArquivo?.();
  } catch(err){
    showToast('❌ Erro', 'Falha ao arquivar. Tente novamente.');
    console.error('[arquivarConcluidosTrello]', err);
  }
};

// ✅ NOVO: Limpar lixeira completa
window.clearLixeira = async()=>{
  if(!state.isManager){ showToast('Sem permissão','Apenas a gestora pode limpar a lixeira.'); return; }
  const lixCards = Object.entries(state.kanbanCards).filter(([,c])=>c.column==='lixeira');
  if(!lixCards.length){ showToast('Lixeira vazia','Não há cards para remover.'); return; }
  if(!confirm(`Remover permanentemente ${lixCards.length} card(s) da lixeira? Esta ação não pode ser desfeita.`)) return;
  try{
    for(const [k] of lixCards) await remove(child(kanbanRef, k));
    showToast('Lixeira limpa',`${lixCards.length} card(s) removido(s) permanentemente.`);
  }catch(err){
    showToast('Erro','Falha ao limpar lixeira. Tente novamente.');
    console.error('[clearLixeira]',err);
  }
};

// ✅ NOVO: Desarquivar card — escolher coluna destino
window.unarchiveKanbanCard = async(key)=>{
  if(!state.isManager){ showToast('Sem permissão','Apenas a gestora pode desarquivar.'); return; }
  const card = state.kanbanCards[key]; if(!card) return;
  const cols = state.K_COLS.filter(c=>c.id!=='lixeira'&&c.id!=='concluido');
  const opts = cols.map((c,i)=>`${i+1}. ${c.label}`).join('\n');
  const resp = prompt(`Para qual coluna deseja mover "${card.name||'card'}"?\n\n${opts}\n\nDigite o número:`);
  if(!resp) return;
  const idx = parseInt(resp)-1;
  if(isNaN(idx)||idx<0||idx>=cols.length){ showToast('Inválido','Número de coluna inválido.'); return; }
  const destCol = cols[idx].id;
  const now = Date.now();
  const hist = [...(card.history||[]),{action:'unarchived',from:'lixeira',to:destCol,by:state.currentUser?.email||'?',at:now}];
  try{
    await set(child(kanbanRef, key),{...card,column:destCol,archived:false,archivedAt:null,history:hist,modifiedBy:state.currentUser?.email||'desconhecido'});
    showToast('Card restaurado',`"${escH(card.name||'card')}" movido para ${cols[idx].label}.`);
  }catch(err){
    showToast('Erro','Falha ao desarquivar. Tente novamente.');
    console.error('[unarchiveKanbanCard]',err);
  }
};

// ── AUTO-STOP TIMER AT 18:30 ────────────────────────────────────────────────
// KRN-042: ao restaurar timer, verifica se horário de reabertura > 18h30 do dia de início
// e registra o encerramento retroativamente como 18h30 do dia de início
// → js/timer.js

// → js/timer.js

// ── INIT block → index_v2.js ──────────────────────────────────────────────────

// KRN-049 — Pan horizontal no Kanban via mousedown + drag
(function initKanbanPan(){
  let panEl=null, isDown=false, startX=0, startScrollLeft=0, moved=false;

  function attachPan(target){
    if(!target||target._panAttached) return;
    target._panAttached=true;
    panEl=target;

    target.addEventListener('mousedown',e=>{
      if(e.target.closest('.k-card,.k-btn-timer,.k-btn-move,.modal-overlay')) return;
      isDown=true; moved=false;
      startX=e.clientX;
      startScrollLeft=target.scrollLeft;
      target.style.cursor='grabbing';
      e.preventDefault();
    });
  }

  document.addEventListener('mousemove',e=>{
    if(!isDown||!panEl) return;
    const dx=e.clientX-startX;
    if(Math.abs(dx)>3) moved=true;
    panEl.scrollLeft=startScrollLeft-dx;
  });

  document.addEventListener('mouseup',()=>{
    if(!panEl) return;
    isDown=false;
    panEl.style.cursor='grab';
    setTimeout(()=>{ moved=false; },0);
  });

  function tryAttach(){
    const s=document.querySelector('.kanban-board-scroll');
    if(s&&!s._panAttached) attachPan(s);
  }

  tryAttach();
  const wrap=document.querySelector('.kanban-board-wrap');
  if(wrap) new MutationObserver(()=>tryAttach()).observe(wrap,{childList:true,subtree:false});
  document.addEventListener('kronos:page:kanban',()=>setTimeout(tryAttach,150));
})();

// ── CFG functions → index_v2.js (Phase 10: config.js) ─────────────────────────
window.openKanbanColsModal = async function(){
  // Usa o painel completo de configuração de colunas (com botões + criar/remover)
  let panel = document.getElementById('kanbanColsPanel');
  if(!panel){
    panel = document.createElement('div');
    panel.id = 'kanbanColsPanel';
    panel.style.cssText = 'position:fixed;top:0;right:0;width:min(680px,95vw);height:100vh;background:var(--surface);border-left:1.5px solid var(--border);box-shadow:-4px 0 24px rgba(0,0,0,0.12);z-index:700;display:flex;flex-direction:column;transition:transform 0.25s ease;transform:translateX(100%)';
    panel.setAttribute('role','dialog');
    panel.setAttribute('aria-modal','true');
    panel.setAttribute('aria-label','Configurar Colunas do Kanban');
    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:18px 22px;border-bottom:1px solid var(--border);flex-shrink:0;">
        <div style="font-size:0.95rem;font-weight:800;">⚙ Configurar Colunas do Kanban</div>
        <button onclick="window.closeKanbanColsPanel()" style="background:none;border:none;cursor:pointer;color:var(--muted);display:flex;align-items:center;padding:4px;" aria-label="Fechar">${ICONS.x}</button>
      </div>
      <div style="flex:1;overflow-y:auto;padding:16px 22px;" id="kanbanColsPanelContent"></div>`;
    const overlay = document.createElement('div');
    overlay.id = 'kanbanColsPanelOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.18);z-index:699;display:none;';
    overlay.onclick = ()=>window.closeKanbanColsPanel();
    document.body.appendChild(overlay);
    document.body.appendChild(panel);
  }
  document.getElementById('kanbanColsPanelOverlay').style.display = 'block';
  setTimeout(()=>{ panel.style.transform='translateX(0)'; window.trapFocus?.(panel); },10);
  // renderCfgColunas detecta automaticamente o painel pelo ID kanbanColsPanelContent
  try { await window.renderCfgColunas?.(); } catch(e) { console.error('[kanbanColsPanel]',e); }
};

window.closeKanbanColsPanel = ()=>{ window.releaseFocus?.();
  const panel = document.getElementById('kanbanColsPanel');
  const overlay = document.getElementById('kanbanColsPanelOverlay');
  if(panel) panel.style.transform='translateX(100%)';
  if(overlay) overlay.style.display='none';
  // Re-renderiza kanban para refletir mudanças de colunas
  setTimeout(()=>renderKanban(), 300);
};

// ── Window registrations ──────────────────────────────────────────────────────
window.renderKanban           = renderKanban;
window.kdRenderAvaliacao      = kdRenderAvaliacao;

// ── KRONOS · DASHBOARD & CÁLCULOS ────────────────────────────────────────────
// Helpers de cálculo compartilhados + renders do Dashboard, Online, Meu Dashboard e RH

import { app as state } from './state.js';
import { ICONS, medalIcon } from './icons.js';
import { resolveSeriesColors } from './colors.js';   // Bloco B: regra de cor gestor-first
import {
  dKey, dateKey, todayKey, getWeekDays, getMonthWeeks,
  fmtDur, fmtTime, fmtDate, fmtShortDate, escH, countUp
} from './utils.js';
import { db } from './firebase-refs.js';
import { downloadXlsx } from './xlsx-lite.js';
import { ref, get, query, orderByChild, startAt, endAt }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

const MS_PER_HOUR = 3600000;
const MS_PER_DAY  = 86400000;
const _DOW_KEY    = ['dom','seg','ter','qua','qui','sex','sab'];

function _dkToISO(dk) {
  const [y,m,d] = dk.split('-').map(Number);
  return `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}

// ── isActive ───────────────────────────────────────────────────────────────────
// Fonte da verdade é config/usuarios/<uid>.ativo (o que a tela de Usuários grava),
// espelhado em state.COLLABS[k].active no boot. O nó legado users/<key>.active nunca é
// atualizado ao desativar — ler só ele deixava todo inativo passar como ativo.
export function isActive(collabKey) {
  return state.COLLABS[collabKey]?.active !== false
      && state.usersConfig[collabKey]?.active !== false;
}

// ── isRankable ───────────────────────────────────────────────────────────────
// Colaboradores que entram em ranking/destaques/conquistas: ativos e SEM papel de
// gestão. Gestores (papel 'gestora', cujo e-mail vai p/ MANAGER_EMAILS) aparecem só
// no card informativo próprio — ficam fora das métricas coletivas e dos destaques.
export function isRankable(collabKey) {
  if(!isActive(collabKey)) return false;
  const email = Object.keys(state.COLLAB_EMAILS).find(e => state.COLLAB_EMAILS[e] === collabKey) || '';
  return !state.MANAGER_EMAILS.includes(email);
}

// Rótulos/cores dos tipos de folga (espelha FOLGA_TIPOS de index_v2.js) — usados nas tabelas
const FOLGA_TIPO_LABELS = { feriado:'Feriado', atestado:'Atestado', dayoff:'Day off' };
const FOLGA_TIPO_CORES  = { feriado:'#f15a24', atestado:'#ef4444', dayoff:'#3b82f6' };
// Bloco C: valor zero/vazio nunca em cor de destaque — cinza calmo evita "alarme" visual
const pctColor = (v, base = 'var(--orange)') => (Number(v) > 0 ? base : 'var(--muted)');

// Craft: números do Meu Dashboard "sobem" ao ABRIR a tela (não a cada refresh de fundo)
document.addEventListener('kronos:page:show', (e) => {
  if(e.detail?.id !== 'meu-dashboard') return;
  requestAnimationFrame(() => {
    const perc = document.getElementById('mdHojePerc');
    const cnt  = document.getElementById('mdHojeCount');
    if(perc){ const t = parseFloat(perc.textContent) || 0; perc.textContent = '0.0%'; countUp(perc, t, {decimals:1, suffix:'%', duration:800}); }
    if(cnt){  const t = parseInt(cnt.textContent)  || 0; cnt.textContent  = '0';     countUp(cnt,  t, {duration:800}); }
  });
});

// ── calcAmount ─────────────────────────────────────────────────────────────────
// pesoOverride: peso "congelado" gravado no registro (e.peso). Quando presente, tem
// prioridade sobre o peso atual do projeto — permite "aplicar só aos futuros" sem
// alterar retroativamente os registros antigos.
export function calcAmount(proj, ms, pesoOverride) {
  const p = state.PROJECTS[proj];
  const rate = (pesoOverride !== undefined && pesoOverride !== null && !isNaN(pesoOverride))
    ? Number(pesoOverride)
    : (p ? p.amountPerHour : 0);
  return (ms / 3600000) * (rate || 0);
}

// ── getDailyGoalMs ─────────────────────────────────────────────────────────────
// Duração (ms) de uma janela de ausência "HH:MM"→"HH:MM" (0 se inválida/negativa)
function _ausDurMs(ini, fim){
  const p = s => { const m=/^(\d{1,2}):(\d{2})$/.exec(String(s||'').trim()); return m ? (+m[1])*60 + (+m[2]) : null; };
  const a = p(ini), b = p(fim);
  if(a===null || b===null) return 0;
  return Math.max(0, (b - a)) * 60000;
}

// Colaborador está de férias em dk? (dk = "Y-M-D" com mês 0-indexado; férias em ISO)
export function isOnVacation(collabKey, dk){
  const fer = collabKey ? state.COLLAB_HOURS?.[collabKey]?.ferias : null;
  if(!Array.isArray(fer) || !fer.length) return false;
  const iso = _dkToISO(dk);
  return fer.some(f => f && f.ini && f.fim && iso >= f.ini && iso <= f.fim);
}

export function getDailyGoalMs(dateOrDk, collabKey=null, opts={}) {
  let dow;
  let dk;
  if(typeof dateOrDk === 'string') {
    dk = dateOrDk;
    const [y,m,d] = dk.split('-').map(Number);
    dow = new Date(y,m,d).getDay();
  } else {
    dk = dKey(dateOrDk);
    dow = dateOrDk.getDay();
  }
  if(dow===6||dow===0) return 0;
  if(state.allHolidays?.[_dkToISO(dk)]) return 0;                       // feriado da equipe (todos)
  if(collabKey && state.allFolgas?.[_dkToISO(dk)]?.[collabKey]) return 0; // folga/atestado individual
  if(isOnVacation(collabKey, dk)) return 0;   // férias: meta zerada (sem penalidade)

  let base;
  if(collabKey && state.COLLAB_HOURS[collabKey]?.horasDia !== undefined) {
    base = state.COLLAB_HOURS[collabKey].horasDia * MS_PER_HOUR;
  } else {
    const dowKey = _DOW_KEY[dow];
    if(state._cfgMetasDias && state._cfgMetasDias[dowKey] !== undefined) base = state._cfgMetasDias[dowKey] * MS_PER_HOUR;
    else if(dow===5) base = 8 * MS_PER_HOUR;
    else base = state.DAILY_GOAL_MS;
  }

  // Ausências recorrentes (ex.: estágio) reduzem a meta do dia automaticamente,
  // para o colaborador não precisar registrar nem ser penalizado no % do dia.
  // EXCEÇÃO (opts.ignoreAusencia): dias 100% importados do Clockify usam a meta CHEIA —
  // naquele período o estágio era lançado como registro normal, então reduzir a meta também
  // contaria o estágio duas vezes (no total trabalhado E na meta), inflando o %.
  if(collabKey && !opts.ignoreAusencia){
    const aus = state.COLLAB_HOURS[collabKey]?.ausencias;
    if(Array.isArray(aus)){
      let absMs = 0;
      aus.forEach(a=>{ if(a && Number(a.dow)===dow) absMs += _ausDurMs(a.ini, a.fim); });
      base = Math.max(0, base - absMs);
    }
  }
  return base;
}

// ── getEntriesArray (cached) ───────────────────────────────────────────────────
export function getEntriesArray() {
  if(state._entriesArrayVersion !== state._entriesVersion) {
    state._entriesArrayCache = Object.entries(state.allEntries);
    state._entriesArrayVersion = state._entriesVersion;
  }
  return state._entriesArrayCache;
}

// ── getEntriesForDay ───────────────────────────────────────────────────────────
export function getEntriesForDay(dk, collabFilter=null) {
  // ✅ FIX: considera também entradas cujos PERÍODOS caem neste dia,
  // mesmo que o startTime original seja de outro dia (entradas com reinício)
  const result = [], seen = new Set();
  getEntriesArray().forEach(([k,e]) => {
    if(collabFilter && e.collab !== collabFilter) return;
    if(!e.periods || e.periods.length <= 1) {
      if(dateKey(e.startTime) === dk && !seen.has(k)) {
        seen.add(k);
        result.push({...e, _key:k, _dayDuration: e.duration, _dayAmount: calcAmount(e.project, e.duration, e.peso)});
      }
    } else {
      const dayPeriods = e.periods.filter(p => dateKey(p.startTime) === dk);
      if(dayPeriods.length > 0 && !seen.has(k)) {
        seen.add(k);
        const dayDuration = dayPeriods.reduce((s,p) => s + (p.duration || (p.endTime - p.startTime)), 0);
        result.push({
          ...e, _key: k, _dayDuration: dayDuration,
          _dayAmount: calcAmount(e.project, dayDuration, e.peso),
          _dayPeriods: dayPeriods
        });
      }
    }
  });
  return result.sort((a,b) => b.startTime - a.startTime);
}

// ── calcDay (memoizado) ────────────────────────────────────────────────────────
// Cache por (colaborador, dia): num único render do dashboard, calcDay é chamado
// repetidamente para os mesmos pares (cards + tabela + Meu Dashboard). O cache é
// invalidado por versão: entries (state._entriesVersion) + deps (feriados/folgas/
// config) via invalidateCalcDay(). IMPORTANTE: o resultado é compartilhado — não
// mutar o objeto retornado (callers que precisam adicionar campos fazem cópia).
const _calcDayCache = new Map();
let _calcDayToken = null;
export function invalidateCalcDay(){ state._calcDepsVer = (state._calcDepsVer || 0) + 1; }
export function calcDay(collabKey, dk) {
  const token = state._entriesVersion + '|' + (state._calcDepsVer || 0);
  if(token !== _calcDayToken){ _calcDayCache.clear(); _calcDayToken = token; }
  const _ck = collabKey + '|' + dk;
  const _hit = _calcDayCache.get(_ck);
  if(_hit) return _hit;
  const day = getEntriesForDay(dk, collabKey);
  const totalMs = day.reduce((s,e) => s + (e._dayDuration ?? e.duration), 0);
  // Dia cujos registros são TODOS importados do Clockify → meta cheia (ignora ausência):
  // o histórico antigo (anterior ao estágio no Kronos) não deve sofrer a redução de meta.
  const _allClockify = day.length > 0 && day.every(e => String(e.importedFrom||'').startsWith('clockify'));
  const goalMs = getDailyGoalMs(dk, collabKey, { ignoreAusencia: _allClockify });
  const percTime = goalMs > 0 ? totalMs / goalMs * 100 : (totalMs > 0 ? totalMs / state.DAILY_GOAL_MS * 100 : 0);
  const percAmount = day.reduce((s,e) => s + (e._dayAmount ?? calcAmount(e.project, e.duration, e.peso)), 0);
  const result = { totalMs, percTime, percAmount, percTotal: percTime+percAmount, count: day.length, entries: day, goalMs, isSaturday: goalMs===0, onVacation: isOnVacation(collabKey, dk) };
  _calcDayCache.set(_ck, result);
  return result;
}

// ── getCollabAvatar ────────────────────────────────────────────────────────────
const _AV_HEX = /^#[0-9a-fA-F]{3,8}$/;
const _AV_PHOTO = /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/i;
export function getCollabAvatar(key) {
  const av = state.allAvatars[key];
  const col = state.COLLABS[key] || {initials:'?', color:'#94A3B8'};
  // Bug XSS: av.emoji/av.color são graváveis pelo colaborador (avatars/$key sem .validate).
  // Escapar emoji e validar cor na origem neutraliza todos os pontos de consumo (innerHTML/style).
  if(av) {
    const photo = (typeof av.foto === 'string' && _AV_PHOTO.test(av.foto)) ? av.foto : null;
    return {
      display: escH(av.emoji || col.initials),
      color: _AV_HEX.test(String(av.color||'')) ? av.color : (col.color || '#94A3B8'),
      isEmoji: !!av.emoji && !photo,
      photo
    };
  }
  return { display: escH(col.initials), color: col.color, isEmoji: false, photo: null };
}

// HTML interno de um avatar circular: foto (img) tem prioridade; senão emoji/iniciais.
// Use dentro de um container redondo (border-radius:50%) já com cor de fundo.
export function avatarInner(av){
  if(av && av.photo) return `<img src="${av.photo}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;display:block;">`;
  return av && av.isEmoji
    ? `<span style="font-size:1.1rem">${av.display}</span>`
    : `<span style="font-weight:800;color:#fff">${av && av.display || '?'}</span>`;
}

// ── chartPalette ───────────────────────────────────────────────────────────────
export function chartPalette() {
  const dark = document.body.classList.contains('dark');
  return {
    tick:    dark ? '#9090AA' : '#8B7E78',
    grid:    dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)',
    legend:  dark ? '#9090AA' : '#8B7E78',
    surface: dark ? '#1A1A24' : '#FFFFFF',   // Bloco C: canvas nao entende var(--surface)
  };
}

// ── getConquistas ──────────────────────────────────────────────────────────────
export function getConquistas(collabKey, refDate) {
  const conquistas = [];
  const today = new Date(); today.setHours(0,0,0,0);
  const viewDay = refDate ? new Date(refDate) : new Date(today);
  viewDay.setHours(0,0,0,0);
  let streak = 0;
  for(let i=1;i<=7;i++){const d=new Date(today);d.setDate(today.getDate()-i);if(calcDay(collabKey,dKey(d)).percTotal>=100)streak++;else break;}
  if(streak>=3) conquistas.push({cls:'fire',icon:ICONS.fire,label:`Em chamas! ${streak}d`});
  const todayData = calcDay(collabKey, dKey(today));
  if(todayData.percTotal>=120) conquistas.push({cls:'lightning',icon:ICONS.zap,label:'Relâmpago!'});
  const days = getWeekDays(0);
  const weekTotals = Object.keys(state.COLLABS).filter(k=>isRankable(k)).map(k=>({key:k,total:days.reduce((s,d)=>s+calcDay(k,dKey(d)).percTotal,0)}));
  weekTotals.sort((a,b)=>b.total-a.total);
  if(weekTotals.length&&weekTotals[0].key===collabKey&&weekTotals[0].total>0) conquistas.push({cls:'crown',icon:ICONS.crown,label:'Rei da semana!'});
  let consistent = 0;
  for(let i=1;i<=7;i++){const d=new Date(today);d.setDate(today.getDate()-i);if(d.getDay()===0)continue;if(calcDay(collabKey,dKey(d)).percTotal>=80)consistent++;else break;}
  if(consistent>=5) conquistas.push({cls:'target',icon:ICONS.target,label:'Consistente!'});
  // KRN-031: Estrela do dia — usa o dia visualizado no dashboard
  const todayTotals = Object.keys(state.COLLABS).filter(k=>isRankable(k)).map(k=>({key:k,perc:calcDay(k,dKey(viewDay)).percTotal}));
  todayTotals.sort((a,b)=>b.perc-a.perc);
  if(todayTotals.length&&todayTotals[0].key===collabKey&&todayTotals[0].perc>0) conquistas.push({cls:'star',icon:ICONS.star,label:'Estrela do dia!'});
  return conquistas;
}

// ── renderConquistasBadges ─────────────────────────────────────────────────────
export function renderConquistasBadges(collabKey, refDate) {
  const conquistas = getConquistas(collabKey, refDate);
  if(!conquistas.length) return '';
  return `<div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:3px;">
    ${conquistas.map(c=>`<span class="conquista-badge ${c.cls}">${c.icon}<span>${c.label}</span></span>`).join('')}
  </div>`;
}

// ── updateDateNav ──────────────────────────────────────────────────────────────
export function updateDateNav() {
  const today = new Date(); today.setHours(0,0,0,0);
  const label = state.viewDate.getTime()===today.getTime() ? 'Hoje — '+fmtDate(state.viewDate) : fmtDate(state.viewDate);
  ['dateNavLabel','dateNavLabel2'].forEach(id=>{const el=document.getElementById(id);if(el)el.textContent=label;});
  const t = state.viewDate.getTime()===today.getTime() ? 'Registros de hoje' : 'Registros do dia';
  const el = document.getElementById('entriesTitle'); if(el) el.textContent=t;
}

// ── updateDashDayLabel ─────────────────────────────────────────────────────────
export function updateDashDayLabel() {
  const today = new Date(); today.setHours(0,0,0,0);
  const diff = Math.round((state.dashDay - today) / MS_PER_DAY);
  const lbl = state.dashDay.toLocaleDateString('pt-BR',{weekday:'short',day:'2-digit',month:'short',year:'numeric'});
  const prefix = diff===0 ? 'Hoje — ' : diff===-1 ? 'Ontem — ' : '';
  const el = document.getElementById('dashDayLabel'); if(el) el.textContent = prefix+lbl;
  const pk = document.getElementById('dashDayPicker');
  if(pk) pk.value = state.dashDay.toISOString().slice(0,10);
}

// ── updateWeekLabel ────────────────────────────────────────────────────────────
export function updateWeekLabel() {
  const days = getWeekDays(state.weekOffset);
  const s = days[0].toLocaleDateString('pt-BR',{day:'2-digit',month:'short'});
  const e = days[5].toLocaleDateString('pt-BR',{day:'2-digit',month:'short',year:'numeric'});
  const el = document.getElementById('weekNavLabel'); if(el) el.textContent=`Semana de ${s} a ${e}`;
}

// ── renderDashboardOnline ──────────────────────────────────────────────────────
export function renderDashboardOnline() {
  const container = document.getElementById('onlineBodyDash');
  if(!container) return;
  const keys = Object.keys(state.activeTimers);
  if(!keys.length) {
    container.innerHTML = `<div class="empty-state">
      <div class="empty-icon">${ICONS.clock}</div>
      <div class="empty-title">Ninguém trabalhando agora</div>
      <div class="empty-text">Quando alguém iniciar o timer, aparece aqui em tempo real.</div>
    </div>`;
    return;
  }
  container.innerHTML = keys.map(k=>{
    const t = state.activeTimers[k];
    const av = getCollabAvatar(k);
    const col = state.COLLABS[k] || {label:k, initials:'?', color:'#94A3B8'};
    const proj = state.PROJECTS[t.project] || {label:t.project, color:'#94A3B8'};
    const dk = dKey(new Date(t.startTime));
    const dayData = calcDay(k, dk);
    const barW = Math.min(dayData.percTime, 100);
    const barColor = barW>=100 ? 'var(--success)' : 'var(--orange)';
    const avContent = avatarInner(av);
    return `<div class="online-card">
      <div class="online-card-header">
        <div class="online-card-av" style="background:${av.color}">${avContent}</div>
        <div style="flex:1;min-width:0;">
          <div class="online-card-name">${escH(col.label)}</div>
          <div class="online-card-elapsed">${fmtDur(Math.max(0, Date.now() - t.startTime))}</div>
        </div>
        <div style="font-family:var(--mono);font-size:0.65rem;color:var(--muted);text-align:right;">
          <div style="font-weight:700;color:var(--text)">${fmtDur(dayData.totalMs)}</div>
          <div>hoje</div>
        </div>
      </div>
      <div>
        <div class="online-card-task">${escH(t.task||'Em andamento')}${t.kanban?' <span style="font-size:0.52rem;font-weight:800;color:var(--orange);border:1px solid var(--orange-border);border-radius:4px;padding:1px 4px;vertical-align:middle;">KANBAN</span>':''}</div>
        <div class="online-card-proj" style="color:${proj.color}">${escH(proj.label)}</div>
      </div>
      <div class="online-card-bar-wrap">
        <div class="online-card-bar-label"><span>% do dia</span><span style="color:${barColor};font-weight:700;">${dayData.percTime.toFixed(0)}%</span></div>
        <div class="online-card-bar-track"><div class="online-card-bar-fill" style="width:${barW}%;background:${barColor};"></div></div>
      </div>
    </div>`;
  }).join('');
  if(!state._onlineAutoRefresh) {
    state._onlineAutoRefresh = setInterval(()=>{
      if(document.getElementById('page-dashboard')?.classList.contains('active')){
        renderDashboardOnline();
      } else {
        clearInterval(state._onlineAutoRefresh);
        state._onlineAutoRefresh = null;
      }
    }, 5000);
  }
}

// ── renderDashboard ────────────────────────────────────────────────────────────
export function renderDashboard() {
  renderDashboardOnline();
  renderDashCards();
  renderWeekTable();
  setupDashTabsVisibility();           // D4: abas Semanal/Destaques/Remoto (coordenador/admin)
  // Destaques/Remoto NÃO são re-buscados aqui (evita N×get por tick); só na troca
  // de aba e na navegação de semana.
  if(document.getElementById('page-dashboard')?.classList.contains('active')) {
    try { renderDashDemandasWeek(); } catch(e) { console.error('[renderDashDemandasWeek]',e); }
  }
}

// Formata a meta (ms) como rótulo "Xh", "XhYYmin" ou "opcional" (evita hora decimal tipo 6.5)
function _fmtMetaLabel(ms){
  if(!ms || ms <= 0) return 'opcional';
  const h = Math.floor(ms/3600000);
  const m = Math.round((ms % 3600000)/60000);
  return (m > 0 ? `${h}h${String(m).padStart(2,'0')}min` : `${h}h`) + ' = 100%';
}

// ── capDia (piso de 100%) ─────────────────────────────────────────────────────
// state.capDia = { dk: { collabKey: true } } — quando marcado, a %Total EXIBIDA do dia
// tem PISO de 100% (se o real for >=100 mantém; se for menor, exibe 100). Card + tabela.
// Tempo/Amt continuam reais; o ranking (card e tabela) usa SEMPRE a % real.
export const CAP_FLOOR = 100;
export function capValue(perc){ return Math.max(CAP_FLOOR, perc); }
export function isCapped(collabKey, dk){
  return !!(state.capDia && state.capDia[dk] && state.capDia[dk][collabKey]);
}
// Só gestão (gestora/admin/coordenador) pode marcar/desmarcar.
function _canCapDia(){
  return state.isManager || ['gestora','admin','coordenador'].includes(state.userPapel);
}

// ── renderDashCards ────────────────────────────────────────────────────────────
export function renderDashCards() {
  const tk = dKey(state.dashDay);
  const goalMs = getDailyGoalMs(tk);
  const goalLabel = goalMs > 0 ? `${goalMs/MS_PER_HOUR}h=100%` : 'opcional';
  const canCap = _canCapDia();
  const results = Object.keys(state.COLLABS)
    .filter(k => isRankable(k))
    .map(k => ({key:k, ...state.COLLABS[k], ...calcDay(k,tk)}));
  results.sort((a,b) => b.percTotal - a.percTotal); // ranking do card SEMPRE pela % real
  const rankedHtml = results.map((c,i)=>{
    const rank = i+1;
    const rankIcon = medalIcon(rank);
    const rankCls = rank===1?'gold':rank===2?'silver':rank===3?'bronze':'';
    const capped = isCapped(c.key, tk);
    const dispTotal = (capped && c.count > 0) ? capValue(c.percTotal) : c.percTotal;  // piso de 100% só na EXIBIÇÃO e só em dia COM registros
    const onVac = c.onVacation;
    const capBtn = (canCap && !onVac) ? `<button class="cap-toggle ${capped?'on':''}" title="${capped?'Piso de 100% ativo — clique para reverter':'Garantir piso de 100% neste dia'}" onclick="window.toggleCapDia('${c.key}','${tk}',event)">100%${capped?' ✓':''}</button>` : '';
    const vacBadge = onVac ? `<span style="font-size:0.6rem;font-weight:800;color:#fff;background:var(--orange);border-radius:100px;padding:2px 8px;white-space:nowrap;">Férias</span>` : '';
    return `<div class="collab-card${capped?' capped':''}">
      <div class="collab-card-header">
        <div class="collab-card-av" style="background:${getCollabAvatar(c.key).color};overflow:hidden;">${avatarInner(getCollabAvatar(c.key))}</div>
        <div style="flex:1"><div class="collab-card-name">${c.label}</div><div class="collab-card-rank ${rankCls}">${rankIcon} ${rank}º lugar</div></div>
        ${vacBadge}${capBtn}
      </div>
      <div class="collab-card-stats">
        <div><div class="ccs-label">% Tempo</div><div class="ccs-value" style="color:var(--text)">${c.percTime.toFixed(1)}%</div></div>
        <div><div class="ccs-label">% Amt</div><div class="ccs-value" style="color:var(--success)">+${c.percAmount.toFixed(1)}%</div></div>
        <div><div class="ccs-label">% Total</div><div class="ccs-value" style="color:${pctColor(dispTotal)}">${dispTotal.toFixed(1)}%${(capped && c.percTotal < CAP_FLOOR)?`<span style="font-size:0.55rem;color:var(--muted);font-weight:700"> (real ${c.percTotal.toFixed(0)}%)</span>`:''}</div></div>
      </div>
      <div class="bar-label"><span>Meta (${_fmtMetaLabel(c.goalMs)})</span><span>${dispTotal.toFixed(1)}%</span></div>
      <div class="bar-track"><div class="bar-fill ${dispTotal>=100?'over':''}" style="width:${Math.min(dispTotal,100)}%"></div></div>
      ${renderConquistasBadges(c.key, state.dashDay)}
    </div>`;
  }).join('');
  // Cards de GESTORES (todos os gestores ativos da equipe) — fora do ranking/destaque, mas
  // visíveis para que os gestores vejam a % uns dos outros. O botão de piso de 100% só
  // aparece no próprio card (cada gestor registra o próprio dia).
  const _gestorCard = (gk) => {
    const me = { ...state.COLLABS[gk], ...calcDay(gk, tk) };
    const avo = getCollabAvatar(gk);
    const isSelf = gk === state.currentCollabKey;
    const gIsCapped = isCapped(gk, tk);
    const gCapped = gIsCapped && me.count > 0;
    const gDisp = gCapped ? capValue(me.percTotal) : me.percTotal;
    const gCapBtn = canCap
      ? `<button class="cap-toggle ${gIsCapped?'on':''}" title="${gIsCapped?'Piso de 100% ativo — clique para reverter':'Garantir piso de 100% neste dia'}" onclick="window.toggleCapDia('${gk}','${tk}',event)">100%${gIsCapped?' ✓':''}</button>`
      : (gCapped ? `<span style="font-size:0.58rem;font-weight:800;color:var(--orange);" title="Piso de 100% ativo">✓ 100%</span>` : '');
    const tag = isSelf
      ? `<span style="font-size:0.6rem;color:var(--orange);font-weight:800;">(você)</span>`
      : `<span style="font-size:0.55rem;color:var(--muted);font-weight:800;text-transform:uppercase;letter-spacing:0.3px;">Gestão</span>`;
    return `<div class="collab-card${gCapped?' capped':''}" style="border-color:var(--orange);box-shadow:0 0 0 1px var(--orange) inset;">
      <div class="collab-card-header">
        <div class="collab-card-av" style="background:${avo.color};overflow:hidden;">${avatarInner(avo)}</div>
        <div style="flex:1"><div class="collab-card-name">${escH(me.label)} ${tag}</div><div class="collab-card-rank" style="color:var(--muted)">${isSelf?'Seu desempenho':'Gestor(a)'}</div></div>
        ${gCapBtn}
      </div>
      <div class="collab-card-stats">
        <div><div class="ccs-label">% Tempo</div><div class="ccs-value">${me.percTime.toFixed(1)}%</div></div>
        <div><div class="ccs-label">% Amt</div><div class="ccs-value" style="color:var(--success)">+${me.percAmount.toFixed(1)}%</div></div>
        <div><div class="ccs-label">% Total</div><div class="ccs-value" style="color:${pctColor(gDisp)}">${gDisp.toFixed(1)}%${(gCapped && me.percTotal < CAP_FLOOR)?`<span style="font-size:0.55rem;color:var(--muted);font-weight:700"> (real ${me.percTotal.toFixed(0)}%)</span>`:''}</div></div>
      </div>
      <div class="bar-label"><span>Meta (${_fmtMetaLabel(me.goalMs)})</span><span>${gDisp.toFixed(1)}%</span></div>
      <div class="bar-track"><div class="bar-fill ${gDisp>=100?'over':''}" style="width:${Math.min(gDisp,100)}%"></div></div>
    </div>`;
  };
  const gestorCardsHtml = Object.keys(state.COLLABS)
    .filter(k => isActive(k) && !isRankable(k))
    .map(_gestorCard).join('');
  document.getElementById('cardsGrid').innerHTML = gestorCardsHtml + rankedHtml;

  // Botão "piso de 100% para todos" (gestão) — liga/desliga todos os colaboradores do dia
  const capAllBtn = document.getElementById('capAllBtn');
  if(capAllBtn){
    if(canCap && results.length){
      const allCapped = results.every(c => isCapped(c.key, tk));
      capAllBtn.style.display = '';
      capAllBtn.textContent = allCapped ? 'Reverter 100% de todos' : 'Ativar 100% p/ todos';
      capAllBtn.dataset.allcapped = allCapped ? '1' : '0';
    } else {
      capAllBtn.style.display = 'none';
    }
  }
}

// ── renderWeekTable ────────────────────────────────────────────────────────────
export function renderWeekTable() {
  const days = getWeekDays(state.weekOffset);
  const tk = todayKey();
  const thead = document.getElementById('weekTableHead');
  const tbody = document.getElementById('weekTableBody');
  thead.innerHTML = `<tr><th class="name-col">Colaborador</th>${days.map(d=>{const iso=_dkToISO(dKey(d));const hol=state.allHolidays?.[iso];return`<th>${fmtShortDate(d)}${hol?`<br><span style="font-size:0.58rem;color:var(--orange);font-weight:600;">${escH(hol.label||'Feriado')}</span>`:''}</th>`;}).join('')}<th>Média</th><th>Rank</th></tr>`;
  // ✅ Gestora excluída das métricas coletivas
  // eff = % EXIBIDA/MÉDIA: piso de 100% quando a gestão ativou o dia (real<100 → 100).
  // O RANKING (semanal e diário) usa SEMPRE a % original (item 190 do doc):
  // ex. dias com piso exibem >=100%, mas o destaque continua sendo a maior % real.
  const tableData = Object.keys(state.COLLABS)
    .filter(k => isRankable(k))
    .map(k => {
      const dayData = days.map(d => {
        const dk = dKey(d);
        const cd = calcDay(k, dk);
        // piso de 100% só vale para dia COM registros: capar um dia vazio (real 0%) geraria
        // um "100% fantasma" que entra na soma mas não no divisor `active`, inflando a média.
        // Cópia (não mutar o objeto do calcDay, que agora é cacheado/compartilhado).
        const capped = isCapped(k, dk) && cd.count > 0;
        return { ...cd, capped, eff: capped ? capValue(cd.percTotal) : cd.percTotal };
      });
      const active = dayData.filter(d=>d.count>0).length;
      const avg = active>0 ? dayData.reduce((s,d)=>s+d.eff,0)/active : 0;
      return {key:k, ...state.COLLABS[k], dayData, avg,
        weekTotal:     dayData.reduce((s,d)=>s+d.eff,0),       // exibição/média
        weekTotalReal: dayData.reduce((s,d)=>s+d.percTotal,0)};// ranking (% original)
    });
  const sorted = [...tableData].sort((a,b)=>b.weekTotalReal-a.weekTotalReal);
  const rankMap = {}; sorted.forEach((c,i)=>rankMap[c.key]=i+1);
  const daySums = days.map((_,i)=>{
    // Média do dia: só colaboradores COM meta (>0) naquele dia — exclui férias, folga/atestado,
    // feriado e fim de semana, que entrariam como 0% e derrubariam a média indevidamente.
    const tots = tableData.filter(c=>c.dayData[i].goalMs > 0).map(c=>c.dayData[i].eff);
    return tots.length ? tots.reduce((s,v)=>s+v,0)/tots.length : null;
  });
  // ✅ NOVO: ranking diário — usa a % ORIGINAL (destaque é a maior % real, mesmo com 100% exibido)
  const dayRankMaps = days.map((_,i)=>{
    const active = tableData.filter(c=>c.dayData[i].count>0).sort((a,b)=>b.dayData[i].percTotal-a.dayData[i].percTotal);
    const m = {}; active.forEach((c,r)=>m[c.key]=r+1);
    return m;
  });
  // rank do dia via medalIcon(dr)

  // Linhas de GESTORES: aparecem na tabela (para os gestores verem a % uns dos outros e dos
  // colaboradores), mas NUNCA entram no ranking, no destaque diário nem na média do time.
  const gestorData = Object.keys(state.COLLABS)
    .filter(k => isActive(k) && !isRankable(k))
    .map(k => {
      const dayData = days.map(d => {
        const dk = dKey(d);
        const cd = calcDay(k, dk);
        const capped = isCapped(k, dk) && cd.count > 0;
        return { ...cd, capped, eff: capped ? capValue(cd.percTotal) : cd.percTotal };
      });
      const active = dayData.filter(d=>d.count>0).length;
      const avg = active>0 ? dayData.reduce((s,d)=>s+d.eff,0)/active : 0;
      return {key:k, ...state.COLLABS[k], dayData, avg};
    });

  // Renderiza as células de % de uma linha. withDayRank=false p/ gestores (sem 🥇/#).
  const _cellsFor = (c, withDayRank) => c.dayData.map((d,i)=>{
    const isToday = dKey(days[i])===tk;
    const todayStyle = isToday ? 'outline:2px solid var(--orange);outline-offset:-2px;' : '';
    if(d.onVacation) return `<td style="${todayStyle}background:var(--surface2);"><div class="cell-multi"><span class="cell-sub" style="color:var(--orange);font-weight:700">Férias</span></div></td>`;
    if(!d.count){
      const _iso = _dkToISO(dKey(days[i]));
      const _hol = state.allHolidays?.[_iso];
      const _fol = state.allFolgas?.[_iso]?.[c.key];
      if(_hol) return `<td style="${todayStyle}background:var(--surface2);"><div class="cell-multi"><span class="cell-sub" style="color:var(--orange);font-weight:700">${escH(_hol.label||'Feriado')}</span></div></td>`;
      if(_fol) return `<td style="${todayStyle}background:var(--surface2);"><div class="cell-multi"><span class="cell-sub" style="color:${FOLGA_TIPO_CORES[_fol.type]||'var(--orange)'};font-weight:700">${escH(_fol.label||FOLGA_TIPO_LABELS[_fol.type]||'Folga')}</span></div></td>`;
      return `<td style="${todayStyle}">&mdash;</td>`;
    }
    if(d.isSaturday) {
      return `<td style="${todayStyle}background:var(--surface2);"><div class="cell-multi"><span class="cell-total" style="color:var(--muted)">${d.percTotal.toFixed(1)}%</span><span class="cell-sub" style="color:var(--muted)">opcional</span></div></td>`;
    }
    const cls = d.eff>=100?'cell-over100':d.eff>=90?'cell-over90':'cell-low';
    const color = d.eff>=90 ? 'var(--success)' : 'var(--danger)';
    let drBadge = '';
    if(withDayRank){
      const dr = dayRankMaps[i][c.key];
      drBadge = dr<=3 ? `<span style="font-size:0.65rem;line-height:1;">${medalIcon(dr)}</span>` : `<span style="font-size:0.6rem;color:var(--muted);font-weight:700">#${dr}</span>`;
    }
    const sub = d.capped ? `<span class="cell-sub" style="color:var(--orange);font-weight:700" title="Piso de 100% ativo (real ${d.percTotal.toFixed(0)}%)">✓ piso 100%</span>` : `<span class="cell-sub">${d.percTime.toFixed(0)}%t +${d.percAmount.toFixed(0)}%a</span>`;
    return `<td class="${cls}" style="${todayStyle}"><div class="cell-multi"><div style="display:flex;align-items:center;justify-content:center;gap:4px;"><span class="cell-total" style="color:${color}">${d.eff.toFixed(1)}%</span>${drBadge}</div>${sub}</div></td>`;
  }).join('');

  const _avatarCell = c => `<td class="name-col"><div class="cell-collab"><div class="cell-av" style="background:${getCollabAvatar(c.key).color};font-size:${getCollabAvatar(c.key).isEmoji?'0.8rem':'0.52rem'}">${getCollabAvatar(c.key).display}</div><div class="cell-name">${c.label}</div></div></td>`;
  const _avgCell = c => `<td><div class="cell-multi"><span class="cell-total" style="color:${pctColor(c.avg)}">${c.avg.toFixed(1)}%</span><span class="cell-sub">${c.dayData.filter(d=>d.count>0).length}d</span></div></td>`;

  // Linhas na ORDEM do ranking (1º, 2º, 3º…) — `sorted` já está por weekTotalReal.
  const rankedRows = sorted.map(c=>{
    const rank = rankMap[c.key];
    return `<tr>${_avatarCell(c)}${_cellsFor(c,true)}${_avgCell(c)}<td>${medalIcon(rank)}</td></tr>`;
  }).join('');
  const gestorRows = [...gestorData].sort((a,b)=>b.avg-a.avg).map(c=>
    `<tr style="opacity:0.92;">${_avatarCell(c)}${_cellsFor(c,false)}${_avgCell(c)}<td><span style="font-size:0.56rem;font-weight:800;color:var(--orange);text-transform:uppercase;letter-spacing:0.3px;">Gestão</span></td></tr>`
  ).join('');
  const _teamAvg = (()=>{ const ac = tableData.filter(c=>c.dayData.some(d=>d.count>0)); return ac.length ? ac.reduce((s,c)=>s+c.avg,0)/ac.length : 0; })();
  const summaryRow = `<tr class="summary-row"><td class="name-col">Média do time</td>${daySums.map(v=>`<td style="color:${(v===null||v===0)?'var(--muted)':'var(--orange)'}">${v===null?'&mdash;':v.toFixed(1)+'%'}</td>`).join('')}<td style="color:${pctColor(_teamAvg)}">${_teamAvg.toFixed(1)}%</td><td>—</td></tr>`;
  tbody.innerHTML = rankedRows + gestorRows + summaryRow;
}

// ── MEU DASHBOARD (colaborador individual) ─────────────────────────────────────

export function renderMeuDashboard() {
  const k = state.currentCollabKey;
  const col = state.COLLABS[k];
  if(!col) return;

  const heading = document.getElementById('meuDashHeading');
  if(heading) heading.textContent = `Dashboard — ${col.label}`;

  const todayDk = todayKey();
  const todayData = calcDay(k, todayDk);
  const th = Math.floor(todayData.totalMs/3600000);
  const tm = Math.floor((todayData.totalMs%3600000)/60000);
  const hojeEl = document.getElementById('mdHojeTotal');
  const countEl = document.getElementById('mdHojeCount');
  const percEl = document.getElementById('mdHojePerc');
  if(hojeEl) hojeEl.textContent = `${th}h ${String(tm).padStart(2,'0')}m`;
  if(countEl) countEl.textContent = todayData.count;
  if(percEl){ percEl.textContent = `${todayData.percTotal.toFixed(1)}%`; percEl.style.color = todayData.percTotal>=90?'var(--success)':'var(--danger)'; }

  const days = getWeekDays(state.mdWeekOffset);
  const tk = todayKey();
  const dayLabels = days.map(d => fmtShortDate(d));
  const dayData = days.map(d => calcDay(k, dKey(d)));

  const wl = document.getElementById('mdWeekLabel');
  if(wl) {
    const fmt = d => d.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'});
    wl.textContent = `${fmt(days[0])} – ${fmt(days[days.length-1])}`;
  }

  const barCtx = document.getElementById('mdChartBar');
  if(barCtx){
    if(state.mdCharts.bar) state.mdCharts.bar.destroy();
    state.mdCharts.bar = new Chart(barCtx, {
      type: 'bar',
      data: {
        labels: dayLabels,
        datasets: [{
          label: '% Total',
          data: dayData.map(d => parseFloat(d.percTotal.toFixed(1))),
          backgroundColor: dayData.map(d => d.percTotal>=90?'rgba(16,185,129,0.7)':'rgba(239,68,68,0.6)'),
          borderColor: dayData.map(d => d.percTotal>=90?'rgba(16,185,129,1)':'rgba(239,68,68,1)'),
          borderWidth: 1.5, borderRadius: 6,
        },{
          label: 'Meta (100%)',
          data: days.map(()=>100),
          type: 'line',
          borderColor: 'rgba(241,90,36,0.5)',
          borderDash: [5,4], borderWidth: 1.5, pointRadius: 0, fill: false,
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, max: Math.max(160, ...dayData.map(d=>d.percTotal))+10,
               grid: { color: chartPalette().grid },
               ticks: { callback: v => v+'%', color: chartPalette().tick, font: { size: 11 } } },
          x: { grid: { display: false }, ticks: { color: chartPalette().tick, font: { size: 11 } } }
        }
      }
    });
  }

  const pieCtx = document.getElementById('mdChartPie');
  if(pieCtx){
    const projMs = {};
    days.forEach(d => {
      const entries = getEntriesForDay(dKey(d), k);
      entries.forEach(e => {
        const dur = e._dayDuration ?? e.duration;
        projMs[e.project] = (projMs[e.project]||0) + dur;
      });
    });
    const projKeys = Object.keys(projMs).filter(p => projMs[p]>0);
    const pieLabels = projKeys.map(p => state.PROJECTS[p]?.label || p);
    const pieData = projKeys.map(p => parseFloat((projMs[p]/3600000).toFixed(2)));
    const pieColors = resolveSeriesColors(projKeys.map(p => state.PROJECTS[p]?.color || '#94A3B8'), pieData);

    if(state.mdCharts.pie) state.mdCharts.pie.destroy();
    if(projKeys.length){
      state.mdCharts.pie = new Chart(pieCtx, {
        type: 'doughnut',
        data: { labels: pieLabels, datasets: [{ data: pieData, backgroundColor: pieColors, borderWidth: 2, borderColor: chartPalette().surface }] },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { position: 'bottom', labels: { font: { size: 10 }, boxWidth: 12, padding: 8, color: chartPalette().legend } },
            tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.parsed.toFixed(1)}h` } }
          }
        }
      });
    } else {
      pieCtx.parentElement.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--muted);font-size:0.8rem;">Sem dados esta semana</div>';
    }
  }

  const thead = document.getElementById('mdWeekHead');
  const tbody = document.getElementById('mdWeekBody');
  if(!thead || !tbody) return;

  thead.innerHTML = `<tr><th style="text-align:left;padding:8px 10px;font-size:0.68rem;font-weight:800;color:var(--muted);text-transform:uppercase;">Dia</th>${days.map(d=>`<th style="padding:8px 6px;font-size:0.68rem;font-weight:800;color:var(--muted);text-transform:uppercase;text-align:center;">${fmtShortDate(d)}</th>`).join('')}<th style="padding:8px 6px;font-size:0.68rem;font-weight:800;color:var(--muted);text-transform:uppercase;text-align:center;">Média</th></tr>`;

  const active = dayData.filter(d=>d.count>0).length;
  const avg = active>0 ? dayData.reduce((s,d)=>s+d.percTotal,0)/active : 0;

  const cells = dayData.map((d,i)=>{
    const isToday = dKey(days[i])===tk;
    const todayStyle = isToday ? 'outline:2px solid var(--orange);outline-offset:-2px;' : '';
    if(!d.count){
      const _iso = _dkToISO(dKey(days[i]));
      const _hol = state.allHolidays?.[_iso];
      const _fol = state.allFolgas?.[_iso]?.[k];
      if(_hol) return `<td style="text-align:center;padding:6px 4px;${todayStyle}"><span style="font-size:0.62rem;font-weight:700;color:var(--orange)">${escH(_hol.label||'Feriado')}</span></td>`;
      if(_fol) return `<td style="text-align:center;padding:6px 4px;${todayStyle}"><span style="font-size:0.62rem;font-weight:700;color:${FOLGA_TIPO_CORES[_fol.type]||'var(--orange)'}">${escH(_fol.label||FOLGA_TIPO_LABELS[_fol.type]||'Folga')}</span></td>`;
      return `<td style="text-align:center;padding:8px 4px;font-size:0.78rem;color:var(--muted);${todayStyle}">—</td>`;
    }
    const color = d.percTotal>=90 ? 'var(--success)' : 'var(--danger)';
    const cls = d.percTotal>=100?'cell-over100':d.percTotal>=90?'cell-over90':'cell-low';
    return `<td class="${cls}" style="text-align:center;padding:6px 4px;${todayStyle}">
      <div style="font-size:0.82rem;font-weight:700;color:${color}">${d.percTotal.toFixed(1)}%</div>
      <div style="font-size:0.62rem;color:var(--muted)">${fmtDur(d.totalMs)}</div>
    </td>`;
  }).join('');

  const av = state.COLLABS[k] ? getCollabAvatar(k) : {display:'?',color:'#94A3B8'};
  tbody.innerHTML = `<tr>
    <td style="padding:8px 10px;">
      <div style="display:flex;align-items:center;gap:8px;">
        <div style="width:28px;height:28px;border-radius:50%;background:${av.color};display:flex;align-items:center;justify-content:center;font-size:${av.isEmoji?'0.85rem':'0.55rem'};font-weight:800;color:#fff;flex-shrink:0;overflow:hidden;">${avatarInner(av)}</div>
        <span style="font-size:0.82rem;font-weight:700;">${col.label}</span>
      </div>
    </td>
    ${cells}
    <td style="text-align:center;padding:6px 4px;">
      <div style="font-size:0.82rem;font-weight:700;color:var(--orange)">${avg.toFixed(1)}%</div>
      <div style="font-size:0.62rem;color:var(--muted)">${active}d</div>
    </td>
  </tr>
  <tr style="border-top:1.5px solid var(--border);">
    <td colspan="${days.length+2}" style="padding:8px 10px;font-size:0.72rem;color:var(--muted);">
      Meta diária conforme a jornada de cada colaborador (descontando ausências) = 100% &nbsp;·&nbsp; Verde ≥ 90% &nbsp;·&nbsp; Vermelho < 90%
    </td>
  </tr>`;
  // D5: indicadores de avaliação (Demanda) individuais do colaborador
  window.renderMeusIndicadores?.();
}

// Dashboard RH legado removido (página #page-dashboard-rh inalcançável — sem nav nem
// case no switch). A visão de coordenador já cobre o caso em renderCoordenadorDashboard.

// ── D4: ABAS DA DASHBOARD DO COORDENADOR (Semanal / Destaques / Trabalho Remoto) ──
// Destaques e Remoto agregam TODAS as equipes do coordenador — os listeners só
// cobrem a equipe ativa, então buscamos cada equipe sob demanda com fetchTeamWeek.

const _DOW_K = ['dom','seg','ter','qua','qui','sex','sab'];

// Computa a semana (por colaborador) de uma equipe a partir de get() — não usa o
// estado global, então funciona para qualquer equipe. Espelha a lógica de calcDay.
export async function fetchTeamWeek(equipeId, weekOffset = 0){
  const days = getWeekDays(weekOffset);
  const startTs = days[0].getTime();
  const endTs = new Date(days[5].getFullYear(), days[5].getMonth(), days[5].getDate(), 23,59,59,999).getTime();
  const [cfgSnap, entSnap, holSnap, folSnap] = await Promise.all([
    get(ref(db, `equipes/${equipeId}/config`)),
    get(query(ref(db, `equipes/${equipeId}/entries`), orderByChild('startTime'), startAt(startTs), endAt(endTs))),
    get(ref(db, `equipes/${equipeId}/holidays`)),
    get(ref(db, `equipes/${equipeId}/folgas`)),
  ]);
  const cfg = cfgSnap.val() || {};
  const entries = Object.values(entSnap.val() || {});
  const holidays = holSnap.val() || {};
  const folgas = folSnap.val() || {};

  const projects = {};
  Object.entries(cfg.projetos || {}).forEach(([k,p]) => { projects[k] = { amountPerHour: p.amountPerHour || 0 }; });
  const collabs = {};
  Object.values(cfg.usuarios || {}).forEach(u => {
    // Só colaboradores entram nos destaques/remoto — gestores ficam de fora.
    if(u.key && u.papel === 'colaborador'){
      collabs[u.key] = { label: u.nome || u.key, color: u.cor || '#94A3B8', active: u.ativo !== false, estilo: u.estiloTrabalho || 'presencial', horasDia: u.horasDia };
    }
  });
  const defaultGoalMs = (cfg.metas?.horasDia || 9) * MS_PER_HOUR;
  const metasDias = cfg.metas?.metasDias || null;

  const goalFor = (d, c, key) => {
    const dow = d.getDay();
    if(dow === 0 || dow === 6) return 0;
    const iso = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    if(holidays[iso]) return 0;
    if(key && folgas[iso]?.[key]) return 0;   // folga/atestado individual
    if(c.horasDia !== undefined && c.horasDia !== null) return c.horasDia * MS_PER_HOUR;
    if(metasDias && metasDias[_DOW_K[dow]] !== undefined) return metasDias[_DOW_K[dow]] * MS_PER_HOUR;
    if(dow === 5) return 8 * MS_PER_HOUR;
    return defaultGoalMs;
  };
  const dayMs = (e, dk) => {
    if(!e.periods || e.periods.length <= 1) return dateKey(e.startTime) === dk ? (e.duration || 0) : 0;
    return e.periods.filter(p => dateKey(p.startTime) === dk).reduce((s,p) => s + (p.duration || (p.endTime - p.startTime) || 0), 0);
  };

  const rows = Object.entries(collabs).filter(([,c]) => c.active).map(([key,c]) => {
    const dayData = days.map(d => {
      const dk = dKey(d);
      let totalMs = 0, amount = 0, count = 0;
      entries.forEach(e => {
        if(e.collab !== key) return;
        const ms = dayMs(e, dk);
        if(!ms) return;
        totalMs += ms; count++;
        const p = projects[e.project];
        // peso congelado no registro (e.peso) tem prioridade sobre o peso atual do projeto
        const rate = (e.peso !== undefined && e.peso !== null && !isNaN(e.peso)) ? Number(e.peso) : (p ? p.amountPerHour : 0);
        amount += (ms / MS_PER_HOUR) * (rate || 0);
      });
      const goalMs = goalFor(d, c, key);
      const percTime = goalMs > 0 ? totalMs / goalMs * 100 : (totalMs > 0 ? totalMs / defaultGoalMs * 100 : 0);
      return { percTotal: percTime + amount, count };
    });
    const activeDays = dayData.filter(d => d.count > 0).length;
    const avg = activeDays > 0 ? dayData.reduce((s,d) => s + d.percTotal, 0) / activeDays : 0;
    return { key, label: c.label, color: c.color, estilo: c.estilo, dayData, avg, activeDays, weekTotal: dayData.reduce((s,d) => s + d.percTotal, 0) };
  });
  rows.sort((a,b) => b.weekTotal - a.weekTotal);
  return { days, rows };
}

function _dashCell(d){
  if(!d.count) return `<td>&mdash;</td>`;
  const color = d.percTotal >= 90 ? 'var(--success)' : 'var(--danger)';
  return `<td><span class="cell-total" style="color:${color}">${d.percTotal.toFixed(1)}%</span></td>`;
}
function _dashHead(days, col1, col2){
  return `<tr><th class="name-col">${col1}</th><th>${col2}</th>${days.map(d => `<th>${fmtShortDate(d)}</th>`).join('')}<th>Média</th></tr>`;
}
function _initials(label){ return String(label||'?').trim().slice(0,2).toUpperCase(); }
function _teamsToShow(){ return state.userEquipes?.length ? state.userEquipes : [state.equipeAtiva].filter(Boolean); }

export async function renderDashDestaques(){
  const cont = document.getElementById('dashTableDestaques');
  if(!cont) return;
  cont.innerHTML = `<div style="padding:16px;color:var(--muted);font-size:0.82rem;">Carregando destaques…</div>`;
  let days = null; const lines = [];
  for(const eq of _teamsToShow()){
    try {
      const { days: d, rows } = await fetchTeamWeek(eq, state.weekOffset);
      days = d;
      const top = rows.find(r => r.activeDays > 0) || rows[0];
      if(top) lines.push({ eq, top });
    } catch(e){ console.warn('[destaques]', eq, e); }
  }
  if(!days || !lines.length){ cont.innerHTML = `<div style="padding:16px;color:var(--muted);font-size:0.82rem;">Sem dados para esta semana.</div>`; return; }
  cont.innerHTML = `<div class="table-wrap"><table class="week-table"><thead>${_dashHead(days,'Equipe','Destaque')}</thead><tbody>${
    lines.map(({eq,top}) => `<tr>
      <td class="name-col"><div class="cell-name">${escH(state.EQUIPE_LABELS[eq]||eq)}</div></td>
      <td><div class="cell-collab"><div class="cell-av" style="background:${top.color}">${escH(_initials(top.label))}</div><div class="cell-name">${medalIcon(1)} ${escH(top.label)}</div></div></td>
      ${top.dayData.map(_dashCell).join('')}
      <td><span class="cell-total" style="color:var(--orange)">${top.avg.toFixed(1)}%</span></td>
    </tr>`).join('')
  }</tbody></table></div>`;
}

export async function renderDashRemoto(){
  const cont = document.getElementById('dashTableRemoto');
  if(!cont) return;
  cont.innerHTML = `<div style="padding:16px;color:var(--muted);font-size:0.82rem;">Carregando…</div>`;
  let days = null; const lines = [];
  for(const eq of _teamsToShow()){
    try {
      const { days: d, rows } = await fetchTeamWeek(eq, state.weekOffset);
      days = d;
      rows.filter(r => r.estilo === 'remoto').forEach(r => lines.push({ eq, r }));
    } catch(e){ console.warn('[remoto]', eq, e); }
  }
  if(!days){ cont.innerHTML = `<div style="padding:16px;color:var(--muted);font-size:0.82rem;">Sem dados.</div>`; return; }
  if(!lines.length){ cont.innerHTML = `<div style="padding:16px;color:var(--muted);font-size:0.82rem;">Nenhum colaborador marcado como remoto. Defina em Gestão → Usuários (coluna Estilo).</div>`; return; }
  cont.innerHTML = `<div class="table-wrap"><table class="week-table"><thead>${_dashHead(days,'Equipe','Colaborador')}</thead><tbody>${
    lines.map(({eq,r}) => `<tr>
      <td class="name-col"><div class="cell-name">${escH(state.EQUIPE_LABELS[eq]||eq)}</div></td>
      <td><div class="cell-collab"><div class="cell-av" style="background:${r.color}">${escH(_initials(r.label))}</div><div class="cell-name">${escH(r.label)}</div></div></td>
      ${r.dayData.map(_dashCell).join('')}
      <td><span class="cell-total" style="color:var(--orange)">${r.avg.toFixed(1)}%</span></td>
    </tr>`).join('')
  }</tbody></table></div>`;
}

let _activeDashTable = 'semanal';
window.switchDashTable = (tab) => {
  _activeDashTable = tab;
  document.querySelectorAll('#dashTableTabs .dash-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.dtab === tab));
  const map = { semanal:'dashTableSemanal', destaques:'dashTableDestaques', remoto:'dashTableRemoto' };
  Object.entries(map).forEach(([t,id]) => { const el = document.getElementById(id); if(el) el.style.display = t === tab ? '' : 'none'; });
  if(tab === 'destaques') renderDashDestaques();
  else if(tab === 'remoto') renderDashRemoto();
};
// Re-renderiza a aba ativa (chamado pela navegação de semana via window)
window._refreshActiveDashTable = () => {
  if(_activeDashTable === 'destaques') renderDashDestaques();
  else if(_activeDashTable === 'remoto') renderDashRemoto();
};

// Mostra as abas Destaques/Remoto só para coordenador (auditor) e admin
export function setupDashTabsVisibility(){
  const show = state.isAuditor || state.userPapel === 'admin';
  ['destaques','remoto'].forEach(t => {
    const btn = document.querySelector(`#dashTableTabs .dash-tab-btn[data-dtab="${t}"]`);
    if(btn) btn.style.display = show ? '' : 'none';
  });
  if(!show && _activeDashTable !== 'semanal') window.switchDashTable('semanal');
}

// ── DEMANDAS DA SEMANA DA DASHBOARD ───────────────────────────────────────────
// Gera a lista de dias entre duas datas ISO (inclusivo), com trava de segurança.
function _dateRangeDays(startStr, endStr){
  const [sy,sm,sd]=startStr.split('-').map(Number);
  const [ey,em,ed]=endStr.split('-').map(Number);
  let s=new Date(sy,sm-1,sd), e=new Date(ey,em-1,ed);
  if(e<s){ const t=s; s=e; e=t; }
  const out=[]; const d=new Date(s); let guard=0;
  while(d<=e && guard<366){ out.push(new Date(d)); d.setDate(d.getDate()+1); guard++; }
  return out;
}
export function renderDashDemandasWeek() {
  if(!Object.keys(state.allEntries).length) return;
  // Filtro de data opcional: início E fim preenchidos → usa o intervalo; senão, a semana.
  const _s = document.getElementById('dashDemandasStart')?.value;
  const _e = document.getElementById('dashDemandasEnd')?.value;
  const days = (_s && _e) ? _dateRangeDays(_s, _e) : getWeekDays(state.weekOffset);
  const collabFilter = document.getElementById('dashDemandasCollab')?.value || '';
  const searchFilter = (document.getElementById('dashDemandasSearch')?.value||'').toLowerCase().trim();
  renderDemandasSemana('dashDemandasBody', days, collabFilter, searchFilter);
}
window.renderDashDemandasWeek = renderDashDemandasWeek;

// Exporta a tabela "Demandas da Semana" para Excel (.xlsx). Usa exatamente os
// mesmos filtros da tela (intervalo de datas ou semana atual, colaborador e busca)
// e inclui todas as linhas correspondentes.
window.exportDashDemandasExcel = ()=>{
  const _s = document.getElementById('dashDemandasStart')?.value;
  const _e = document.getElementById('dashDemandasEnd')?.value;
  const days = (_s && _e) ? _dateRangeDays(_s, _e) : getWeekDays(state.weekOffset);
  const collabFilter = document.getElementById('dashDemandasCollab')?.value || '';
  const searchFilter = (document.getElementById('dashDemandasSearch')?.value||'').toLowerCase().trim();

  const startTs = days[0].getTime();
  const _last = days[days.length-1];
  const endTs = new Date(_last.getFullYear(), _last.getMonth(), _last.getDate(), 23,59,59).getTime();

  let data = getEntriesArray().map(([k,e])=>({...e,_key:k})).filter(e=>{
    if(!isActive(e.collab)) return false;   // mesmo recorte da tabela na tela
    if(collabFilter && e.collab !== collabFilter) return false;
    if(e.startTime >= startTs && e.startTime <= endTs) return true;
    if(e.periods && e.periods.some(p=>p.startTime>=startTs && p.startTime<=endTs)) return true;
    return false;
  }).sort((a,b)=>b.startTime-a.startTime);

  if(searchFilter){
    data = data.filter(e=>{
      const task=(e.task||'').toLowerCase();
      const collab=(state.COLLABS[e.collab]?.label||e.collab||'').toLowerCase();
      const proj=(state.PROJECTS[e.project]?.label||e.project||'').toLowerCase();
      return task.includes(searchFilter)||collab.includes(searchFilter)||proj.includes(searchFilter);
    });
  }

  if(!data.length){ window.showToast?.('Nada para exportar','Nenhuma demanda encontrada no período/filtros atuais.'); return; }

  const header=['Data','Colaborador','Tarefa','Projeto','Início','Fim','Duração','% Amount','Tags','Observação'];
  const rows=data.map(e=>{
    const col =state.COLLABS[e.collab] ||{label:e.collab};
    const proj=state.PROJECTS[e.project]||{label:e.project};
    const amt =parseFloat(calcAmount(e.project,e.duration,e.peso).toFixed(2));
    return [
      new Date(e.startTime).toLocaleDateString('pt-BR'),
      col.label||e.collab||'',
      e.task||'',
      proj.label||e.project||'',
      fmtTime(e.startTime),
      fmtTime(e.endTime),
      fmtDur(e.duration),
      isFinite(amt)?amt:0,
      (e.tags||[]).join('; '),
      e.obs||''
    ];
  });

  downloadXlsx(`demandas_semana_kronos_${new Date().toISOString().slice(0,10)}.xlsx`, 'Demandas da Semana', [header,...rows]);
  window.showToast?.('Excel gerado', `${data.length} demanda${data.length!==1?'s':''} exportada${data.length!==1?'s':''}.`);
};

// ── renderDemandasSemana (reutilizável para gestora e RH) ─────────────────────
export function renderDemandasSemana(tbodyId, days, collabFilter='', searchFilter='') {
  const tbody = document.getElementById(tbodyId);
  if(!tbody) return;
  const startTs = days[0].getTime();
  const endTs = new Date(days[days.length-1].getFullYear(), days[days.length-1].getMonth(), days[days.length-1].getDate(), 23,59,59).getTime();

  let data = getEntriesArray().map(([k,e])=>({...e,_key:k})).filter(e=>{
    if(!isActive(e.collab)) return false;   // inativo sai das tabelas do dashboard
    if(collabFilter && e.collab !== collabFilter) return false;
    if(e.startTime >= startTs && e.startTime <= endTs) return true;
    if(e.periods && e.periods.some(p=>p.startTime>=startTs && p.startTime<=endTs)) return true;
    return false;
  }).sort((a,b)=>b.startTime-a.startTime);

  if(searchFilter){
    data = data.filter(e=>{
      const task=(e.task||'').toLowerCase();
      const collab=(state.COLLABS[e.collab]?.label||e.collab||'').toLowerCase();
      const proj=(state.PROJECTS[e.project]?.label||e.project||'').toLowerCase();
      return task.includes(searchFilter)||collab.includes(searchFilter)||proj.includes(searchFilter);
    });
  }

  if(!data.length){
    tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:32px;color:var(--muted);font-size:0.82rem;">Nenhum registro nesta semana.</td></tr>`;
    return;
  }
  tbody.innerHTML = data.map(e=>{
    const proj = state.PROJECTS[e.project] || {label:escH(e.project||'?'), color:'#94A3B8'};
    const col  = state.COLLABS[e.collab]  || {label:escH(e.collab||'?'),  initials:'?', color:'#94A3B8'};
    const amt  = calcAmount(e.project, e.duration, e.peso);
    const modBadge = e.modifiedAt ? `<span class="modified-badge" title="Editado por ${escH(e.modifiedBy||'?')}">${ICONS.edit}</span>` : '';
    const hasPeriods = e.periods && e.periods.length>1;
    const periodsBadge = hasPeriods ? `<span style="font-size:0.65rem;background:var(--orange-light,#fff3e0);color:var(--orange);border-radius:4px;padding:1px 5px;font-weight:700;margin-left:4px">${e.periods.length}×</span>` : '';
    return `<tr>
      <td><div style="display:flex;align-items:center;gap:6px"><div class="mini-av" style="background:${col.color}">${col.initials}</div><strong>${col.label}</strong></div></td>
      <td style="cursor:pointer" onclick="openEntryDetail('${e._key}')" title="Ver detalhes">
        <strong>${escH(e.task)}${periodsBadge}</strong>
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
        <span onclick="openEntryDetail('${e._key}')" style="cursor:pointer" title="Ver detalhes">
          ${modBadge||'<span style="color:var(--muted);font-size:0.75rem;opacity:0.5">🔍</span>'}
        </span>
      </td>
    </tr>`;
  }).join('');
}

// ── renderOnline ───────────────────────────────────────────────────────────────
export function renderOnline() {
  const container = document.getElementById('onlineBody');
  if(!container) return;
  const keys = Object.keys(state.activeTimers);
  if(!keys.length){
    container.innerHTML = `<div class="empty-state">
      <div class="empty-icon">${ICONS.clock}</div>
      <div class="empty-title">Ninguém trabalhando agora</div>
      <div class="empty-text">Quando alguém iniciar o timer, aparece aqui em tempo real.</div>
    </div>`;
    return;
  }
  container.innerHTML = keys.map(k=>{
    const t = state.activeTimers[k];
    const av = getCollabAvatar(k);
    const col  = state.COLLABS[k]  || {label:k, initials:'?', color:'#94A3B8'};
    const proj = state.PROJECTS[t.project] || {label:t.project, color:'#94A3B8'};
    const dk = dKey(new Date(t.startTime));
    const dayData = calcDay(k, dk);
    const barW = Math.min(dayData.percTime, 100);
    const barColor = barW>=100 ? 'var(--success)' : 'var(--orange)';
    const avContent = avatarInner(av);
    return `<div class="online-card">
      <div class="online-card-header">
        <div class="online-card-av" style="background:${av.color}">${avContent}</div>
        <div style="flex:1;min-width:0;">
          <div class="online-card-name">${escH(col.label)}</div>
          <div class="online-card-elapsed">${fmtDur(Math.max(0, Date.now() - t.startTime))}</div>
        </div>
        <div style="font-family:var(--mono);font-size:0.65rem;color:var(--muted);text-align:right;">
          <div style="font-weight:700;color:var(--text)">${fmtDur(dayData.totalMs)}</div>
          <div>hoje</div>
        </div>
      </div>
      <div>
        <div class="online-card-task">${escH(t.task||'Em andamento')}${t.kanban?' <span style="font-size:0.52rem;font-weight:800;color:var(--orange);border:1px solid var(--orange-border);border-radius:4px;padding:1px 4px;vertical-align:middle;">KANBAN</span>':''}</div>
        <div class="online-card-proj" style="color:${proj.color}">${escH(proj.label)}</div>
      </div>
      <div class="online-card-bar-wrap">
        <div class="online-card-bar-label"><span>% do dia</span><span style="color:${barColor};font-weight:700;">${dayData.percTime.toFixed(0)}%</span></div>
        <div class="online-card-bar-track"><div class="online-card-bar-fill" style="width:${barW}%;background:${barColor};"></div></div>
      </div>
    </div>`;
  }).join('');
  // Bug: agendamento único e auto-limpo (antes acumulava cadeias de setTimeout recursivo)
  if(!state._onlineRefresh){
    state._onlineRefresh = setInterval(()=>{
      if(document.getElementById('page-online')?.classList.contains('active')) renderOnline();
      else { clearInterval(state._onlineRefresh); state._onlineRefresh = null; }
    }, 5000);
  }
}

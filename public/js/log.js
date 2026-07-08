// ── KRONOS · BANCO DE LOG ─────────────────────────────────────────────────────
// Registra ações de ESCRITA importantes (quem / o quê / quando) em
// equipes/{equipe}/logs. O registro é "fire-and-forget" e à prova de falha:
// um erro ao logar NUNCA deve interromper a ação principal do usuário.

import { app as state }      from './state.js';
import { db, logsRef, errorLogsRef } from './firebase-refs.js';
import { ref, push, query, orderByChild, limitToLast, get, update, child }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';
import { escH }              from './utils.js';

// Ícone curto por categoria de ação (apenas estético no visualizador)
const _LOG_ICON = {
  criar:'➕', editar:'✏️', mover:'➡️', concluir:'✅', arquivar:'🗂️',
  excluir:'🗑️', urgente:'🔴', avaliar:'⭐', config:'⚙️', usuario:'👤',
  login:'🔑', registro:'⏱️'
};

// Registra uma ação no log da equipe ativa.
// categoria: chave curta (criar/editar/mover/...); action: texto livre; detail: contexto.
export function registrarLog(categoria, action, detail = ''){
  try {
    push(logsRef, {
      ts:        Date.now(),
      cat:       String(categoria || 'registro').slice(0, 24),
      who:       state.currentCollabKey || '',
      email:     state.currentUser?.email || '',
      papel:     state.userPapel || '',
      action:    String(action || '').slice(0, 120),
      detail:    String(detail || '').slice(0, 300)
    }).catch(() => {});   // rejeição assíncrona não propaga
  } catch (e) { /* log nunca quebra o fluxo principal */ }
}

// ── Visualizador ──────────────────────────────────────────────────────────────
// Renderiza os últimos N registros (mais recentes primeiro) num container.
export async function renderLogs(containerId = 'logViewerContent'){
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = `<div style="color:var(--muted);font-size:0.8rem;padding:16px;">Carregando log…</div>`;
  try {
    const snap = await get(query(logsRef, orderByChild('ts'), limitToLast(300)));
    const data = snap.val() || {};
    el.dataset.loaded = '1';   // marca que já leu nesta sessão (evita rebaixar ao reabrir)
    const rows = Object.values(data).sort((a, b) => (b.ts || 0) - (a.ts || 0));
    if (!rows.length){
      el.innerHTML = `<div style="color:var(--muted);font-size:0.82rem;padding:20px;text-align:center;">Nenhuma ação registrada ainda.</div>`;
      return;
    }
    el.innerHTML = rows.map(r => {
      const who   = state.COLLABS[r.who]?.label || r.email || r.who || '—';
      const icon  = _LOG_ICON[r.cat] || '•';
      const dt    = r.ts ? new Date(r.ts).toLocaleString('pt-BR') : '—';
      return `<div class="log-row">
        <span class="log-row-icon">${icon}</span>
        <div class="log-row-body">
          <div class="log-row-action">${escH(r.action || '')}${r.detail ? `<span class="log-row-detail"> — ${escH(r.detail)}</span>` : ''}</div>
          <div class="log-row-meta">${escH(who)} · ${escH(dt)}</div>
        </div>
      </div>`;
    }).join('');
  } catch (e) {
    console.error('[renderLogs]', e);
    el.innerHTML = `<div style="color:var(--danger);font-size:0.82rem;padding:20px;">Não foi possível carregar o log.</div>`;
  }
}

// Painel lateral com o log (reutilizável a partir de Ferramentas / Configurações).
window.openLogPanel = function(){
  let panel = document.getElementById('logPanel');
  if(!panel){
    panel = document.createElement('div');
    panel.id = 'logPanel';
    panel.style.cssText = 'position:fixed;top:0;right:0;width:min(620px,96vw);height:100vh;background:var(--surface);border-left:1.5px solid var(--border);box-shadow:-4px 0 24px rgba(0,0,0,0.12);z-index:700;display:flex;flex-direction:column;transition:transform 0.25s ease;transform:translateX(100%);';
    panel.setAttribute('role','dialog');
    panel.setAttribute('aria-modal','true');
    panel.setAttribute('aria-label','Banco de Log');
    panel.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 22px 10px;border-bottom:1.5px solid var(--border);">
        <div style="font-size:0.95rem;font-weight:800;">🗒️ Banco de Log</div>
        <div style="display:flex;gap:6px;">
          <button class="btn-sm" onclick="renderLogPanelActive()" title="Atualizar" aria-label="Atualizar">↻</button>
          <button class="btn-sm" onclick="closeLogPanel()" aria-label="Fechar">✕</button>
        </div>
      </div>
      <div style="display:flex;gap:6px;padding:10px 18px 0;">
        <button id="logTabAud" class="btn-sm" onclick="switchLogTab('auditoria')" style="font-weight:800;">Auditoria</button>
        <button id="logTabErr" class="btn-sm" onclick="switchLogTab('erros')" style="font-weight:600;opacity:0.65;">Erros</button>
      </div>
      <div style="flex:1;overflow-y:auto;padding:12px 18px;" id="logViewerContent"></div>`;
    let overlay = document.createElement('div');
    overlay.id = 'logPanelOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.35);z-index:699;display:none;';
    overlay.onclick = window.closeLogPanel;
    document.body.appendChild(overlay);
    document.body.appendChild(panel);
  }
  document.getElementById('logPanelOverlay').style.display = 'block';
  panel.style.transform = 'translateX(0)';
  // NÃO baixa automaticamente — só ao clicar (economiza leituras do banco).
  // Se já foi carregado nesta sessão, mantém o conteúdo sem refazer a leitura.
  const c = document.getElementById('logViewerContent');
  if(c && !c.dataset.loaded){
    c.innerHTML = `<div style="text-align:center;padding:42px 16px;color:var(--muted);">
      <div style="font-size:0.82rem;margin-bottom:16px;line-height:1.5;">Clique para carregar os registros.</div>
      <button class="btn-sm" onclick="renderLogsPanel()" style="font-weight:700;">↻ Carregar registros</button>
    </div>`;
  }
};
window.renderLogsPanel = () => renderLogs('logViewerContent');
window.closeLogPanel = function(){
  const panel = document.getElementById('logPanel');
  const overlay = document.getElementById('logPanelOverlay');
  if(panel) panel.style.transform = 'translateX(100%)';
  if(overlay) overlay.style.display = 'none';
};

// ── ABAS DO PAINEL (Auditoria | Erros) ────────────────────────────────────────
let _activeLogTab = 'auditoria';
let _errLevelFilter = '';

window.switchLogTab = (tab) => {
  _activeLogTab = tab;
  const a = document.getElementById('logTabAud'), e = document.getElementById('logTabErr');
  if(a){ a.style.fontWeight = tab==='auditoria'?'800':'600'; a.style.opacity = tab==='auditoria'?'1':'0.65'; }
  if(e){ e.style.fontWeight = tab==='erros'?'800':'600'; e.style.opacity = tab==='erros'?'1':'0.65'; }
  renderLogPanelActive();
};
window.renderLogPanelActive = () => {
  if(_activeLogTab === 'erros') renderErrorLogs('logViewerContent');
  else renderLogs('logViewerContent');
};

// ── Visualizador de ERROS (nó global /error_logs) ─────────────────────────────
const _ERR_LEVEL = {
  info:  { c:'#3b82f6', l:'INFO'  },
  warn:  { c:'#f59e0b', l:'WARN'  },
  error: { c:'#ef4444', l:'ERRO'  },
  fatal: { c:'#7c2d12', l:'FATAL' }
};

export async function renderErrorLogs(containerId = 'logViewerContent'){
  const el = document.getElementById(containerId);
  if(!el) return;
  el.dataset.loaded = '1';
  el.innerHTML = `<div style="color:var(--muted);font-size:0.8rem;padding:16px;">Carregando erros…</div>`;
  try {
    const snap = await get(query(errorLogsRef, orderByChild('ts'), limitToLast(300)));
    const data = snap.val() || {};
    let rows = Object.entries(data).map(([id,r]) => ({ ...r, _id:id }));
    if(_errLevelFilter) rows = rows.filter(r => r.level === _errLevelFilter);
    // Não resolvidos primeiro; dentro de cada grupo, mais recentes no topo.
    rows.sort((a,b) => (a.resolved?1:0) - (b.resolved?1:0) || (b.ts||0) - (a.ts||0));

    const filterBar = `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;">
      ${['', 'fatal','error','warn','info'].map(lv => {
        const on = _errLevelFilter === lv;
        const lbl = lv ? _ERR_LEVEL[lv].l : 'Todos';
        const col = lv ? _ERR_LEVEL[lv].c : 'var(--muted)';
        return `<button class="btn-sm" onclick="setErrLevelFilter('${lv}')" style="font-size:0.68rem;font-weight:700;${on?`background:${col};color:#fff;border-color:${col};`:''}">${lbl}</button>`;
      }).join('')}
    </div>`;

    if(!rows.length){
      el.innerHTML = filterBar + `<div style="color:var(--muted);font-size:0.82rem;padding:20px;text-align:center;">Nenhum erro registrado${_errLevelFilter?' neste nível':''}. 🎉</div>`;
      return;
    }
    el.innerHTML = filterBar + rows.map(r => {
      const lv  = _ERR_LEVEL[r.level] || _ERR_LEVEL.error;
      const who = r.userName || r.userEmail || '—';
      const dt  = r.ts ? new Date(r.ts).toLocaleString('pt-BR') : '—';
      const ctx = [r.equipeId, r.modulo, r.action].filter(Boolean).map(escH).join(' / ');
      return `<div class="log-row" style="flex-direction:column;align-items:stretch;gap:2px;${r.resolved?'opacity:0.5;':''}">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <span style="font-size:0.54rem;font-weight:800;color:#fff;background:${lv.c};border-radius:4px;padding:2px 6px;letter-spacing:0.3px;">${lv.l}</span>
          <span style="font-weight:700;font-size:0.82rem;">${escH(r.message || '(sem mensagem)')}</span>
        </div>
        <div class="log-row-meta">${escH(who)}${ctx?` · ${ctx}`:''} · ${escH(dt)}</div>
        ${r.stack ? `<pre style="font-size:0.6rem;color:var(--muted);white-space:pre-wrap;max-height:88px;overflow:auto;margin:4px 0 0;background:var(--surface2);padding:6px 8px;border-radius:6px;">${escH(r.stack)}</pre>` : ''}
        ${r.resolved
          ? `<div style="font-size:0.62rem;color:var(--success);margin-top:3px;">✓ resolvido${r.resolvedBy?` por ${escH(r.resolvedBy)}`:''}</div>`
          : `<button class="btn-sm" style="align-self:flex-start;margin-top:5px;font-size:0.68rem;" onclick="resolveErrorLog('${r._id}')">✓ Marcar resolvido</button>`}
      </div>`;
    }).join('');
  } catch(e){
    console.error('[renderErrorLogs]', e);
    el.innerHTML = `<div style="color:var(--danger);font-size:0.82rem;padding:20px;">Não foi possível carregar os erros.</div>`;
  }
}
window.setErrLevelFilter = (lv) => { _errLevelFilter = lv; renderErrorLogs('logViewerContent'); };
window.resolveErrorLog = async (id) => {
  try {
    await update(child(errorLogsRef, id), { resolved:true, resolvedBy: state.currentUser?.email||'', resolvedAt: Date.now() });
    renderErrorLogs('logViewerContent');
  } catch(e){ console.error('[resolveErrorLog]', e); }
};

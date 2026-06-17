// ── KRONOS · BANCO DE LOG ─────────────────────────────────────────────────────
// Registra ações de ESCRITA importantes (quem / o quê / quando) em
// equipes/{equipe}/logs. O registro é "fire-and-forget" e à prova de falha:
// um erro ao logar NUNCA deve interromper a ação principal do usuário.

import { app as state }      from './state.js';
import { db, logsRef }       from './firebase-refs.js';
import { ref, push, query, orderByChild, limitToLast, get }
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
      <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 22px;border-bottom:1.5px solid var(--border);">
        <div style="font-size:0.95rem;font-weight:800;">🗒️ Banco de Log</div>
        <div style="display:flex;gap:6px;">
          <button class="btn-sm" onclick="renderLogsPanel()" title="Atualizar" aria-label="Atualizar log">↻</button>
          <button class="btn-sm" onclick="closeLogPanel()" aria-label="Fechar">✕</button>
        </div>
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
      <div style="font-size:0.82rem;margin-bottom:16px;line-height:1.5;">O log não é carregado automaticamente<br>para economizar acessos ao banco.</div>
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

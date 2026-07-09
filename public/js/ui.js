// ── KRONOS · UI — Toast, Sync, Navegação ─────────────────────────────────────
// Funções de interface independentes de estado de negócio.
// initUI(context) é chamado uma vez no boot para injetar renderPage.

import { escH } from './utils.js';
import { ICONS } from './icons.js';

// ── Contexto injetado no boot ─────────────────────────────────────────────────
let _ctx = { renderPage: () => {} };

export function initUI({ renderPage }) {
  _ctx.renderPage = renderPage;
}

// ── showPage ──────────────────────────────────────────────────────────────────
// Ativa a página correta, marca o nav item e chama renderPage.
export function showPage(id, clickedEl) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const page = document.getElementById('page-' + id);
  if (page) page.classList.add('active');
  if (clickedEl) clickedEl.classList.add('active');
  _ctx.renderPage(id);
  // Notifica o pan do kanban quando a página fica ativa
  if (id === 'kanban') setTimeout(() => document.dispatchEvent(new Event('kronos:page:kanban')), 100);
  document.dispatchEvent(new CustomEvent('kronos:page:show', { detail: { id } }));
}

// ── renderCurrentPage / renderDebounced ───────────────────────────────────────
import { debounce } from './utils.js';

export function renderCurrentPage() {
  const active = document.querySelector('.page.active');
  if (!active) return;
  const id = active.id.replace('page-', '');
  _ctx.renderPage(id);
}

export const renderDebounced = debounce(renderCurrentPage, 100);

// ── setSyncStatus ─────────────────────────────────────────────────────────────
// Atualiza dots e textos de sincronização em toda a UI.
export function setSyncStatus(s, m) {
  ['syncDot', 'syncDot2'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.className = 'sync-dot ' + s;
  });
  ['syncText', 'syncText2'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = m;
  });
  const tbDot = document.getElementById('topbarSyncDot');
  const tbTxt = document.getElementById('topbarSyncText');
  if (tbDot) { tbDot.className = 'topbar-sync-dot'; tbDot.classList.add(s); }
  if (tbTxt) tbTxt.textContent = s === 'ok' ? 'Sync ✓' : s === 'loading' ? 'Salvando…' : 'Erro';
}

// ── showToast ─────────────────────────────────────────────────────────────────
// Toast com detecção automática de tipo e barra de progresso.
const _toastIcons = {
  success: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
  danger:  `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
  warning: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  info:    `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
  default: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`,
};

export function showToast(title, msg, type = '') {
  if (!type) {
    const t = String(title || '').toLowerCase();
    if      (/erro|falha|falhou|inválid|não foi|error/.test(t))       type = 'danger';
    else if (/aprovad|salvo|sucesso|✅|concluíd|feito|✓/.test(t))    type = 'success';
    else if (/atenção|aviso|⚠|fora da janela|bloqueado/.test(t))     type = 'warning';
    else if (/info|ℹ️/.test(t))                                        type = 'info';
    else                                                                type = 'default';
  }
  const dur = type === 'danger' ? 7000 : 5000;
  const c   = document.getElementById('toastContainer');
  if (!c) return;
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.style.setProperty('--toast-dur', dur + 'ms');
  el.setAttribute('role', 'alert');
  el.setAttribute('aria-live', 'polite');
  el.setAttribute('aria-atomic', 'true');
  el.innerHTML = `
    <div class="toast-icon-wrap" aria-hidden="true">${_toastIcons[type] || _toastIcons.default}</div>
    <div class="toast-body">
      <div class="toast-title">${escH(String(title || ''))}</div>
      ${msg ? `<div class="toast-msg">${escH(String(msg || ''))}</div>` : ''}
    </div>
    <button class="toast-close" aria-label="Fechar notificação" onclick="this.closest('.toast').remove()">${ICONS.x}</button>
    <div class="toast-progress" aria-hidden="true"></div>`;
  c.appendChild(el);
  setTimeout(() => {
    el.style.animation = 'toastOut 0.25s ease forwards';
    setTimeout(() => el.remove(), 250);
  }, dur);
}

// ── Focus trap para modais ─────────────────────────────────────────────────────
// Reutilizável: qualquer modal com class 'open' ou atributo aria-modal="true" pode usá-lo.
const FOCUSABLE = 'button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

let _prevFocus  = null;
let _trapEl     = null;
let _trapHandler = null;

export function trapFocus(modalEl) {
  _prevFocus = document.activeElement;
  _trapEl    = modalEl;
  const all   = [...modalEl.querySelectorAll(FOCUSABLE)].filter(el => !el.closest('[hidden]'));
  if (!all.length) return;
  all[0].focus();
  _trapHandler = (e) => {
    if (e.key !== 'Tab') return;
    const visible = [...modalEl.querySelectorAll(FOCUSABLE)].filter(el => !el.closest('[hidden]') && el.offsetParent !== null);
    if (!visible.length) return;
    const first = visible[0], last = visible[visible.length - 1];
    if (e.shiftKey) { if (document.activeElement === first) { e.preventDefault(); last.focus(); } }
    else            { if (document.activeElement === last)  { e.preventDefault(); first.focus(); } }
  };
  modalEl.addEventListener('keydown', _trapHandler);
}

export function releaseFocus() {
  if (_trapEl && _trapHandler) _trapEl.removeEventListener('keydown', _trapHandler);
  _trapEl = _trapHandler = null;
  _prevFocus?.focus();
  _prevFocus = null;
}

// ── enhanceA11y ─────────────────────────────────────────────────────────────────
// Bloco A (acessibilidade): dá semântica de teclado aos elementos que funcionam
// como botão mas foram escritos como <div onclick>. Não altera o HTML nem o CSS —
// apenas injeta role/tabindex e ativa Enter/Espaço. Idempotente e reversível.
const A11Y_SEL = [
  '.nav-item', '.ferr-card', '.sidebar-user',
  '.import-drop-zone', '#trelloDropZone',
  '.avatar-opt', '.mural-title', '.dash-tab-btn'
].join(',');

export function enhanceA11y() {
  // 1) Estampa role/tabindex nos divs-botão estáticos (nav, ferramentas, avatares…)
  document.querySelectorAll(A11Y_SEL).forEach(el => {
    if (el.tagName === 'BUTTON' || el.tagName === 'A') return;
    if (!el.hasAttribute('role'))     el.setAttribute('role', 'button');
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
  });
  // 2) Ativação por teclado — delegado (cobre também elementos re-renderizados)
  if (!document.__a11yKeyBound) {
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
      // Não interceptar controles nativos (já respondem sozinhos)
      if (['BUTTON', 'A', 'INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
      const btn = e.target.closest('[role="button"]');
      if (!btn) return;
      e.preventDefault();
      btn.click();
    });
    document.__a11yKeyBound = true;
  }
}

// ── KRONOS · USUÁRIOS & APROVAÇÕES ──────────────────────────────────────────
// Gestão de colaboradores, painel de aprovações, exportação CSV

import { app as state } from './state.js';
import { ICONS }        from './icons.js';
import {
  escH, fmtDur, fmtTime, fmtDate, fmtShortDate,
  dKey, todayKey, getWeekDays
} from './utils.js';
import {
  db, usersRef, entriesRef, approvalRequestsRef, notifsRef,
  EQUIPE_ID, _getSecondaryAuth, createUserWithEmailAndPassword, signOut
} from './firebase-refs.js';
import { EQUIPE_LABELS } from './auth.js';
import {
  ref, push, set, update, get, remove, child, onValue
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';
import {
  calcDay, calcAmount, getEntriesArray, getEntriesForDay, isActive
} from './dashboard.js';
import { renderCfgColaboradores } from './config.js';
import { showToast, setSyncStatus } from './ui.js';
import { registrarLog } from './log.js';

// ── USER MANAGEMENT ──────────────────────────────────────────────────────────

export function initUsersListener() {
  return onValue(usersRef,(snap)=>{
    state.usersConfig = snap.val() || {};
    Object.keys(state.COLLABS).forEach(k=>{
      if(state.usersConfig[k]===undefined) state.usersConfig[k]={active:true};
    });
    if(document.getElementById('page-usuarios')?.classList.contains('active'))
      renderUsuarios().catch(e=>console.error('[renderUsuarios]',e));
  });
}

// isActive → js/dashboard.js

// toggleUserStatus removida — botão retirado da UI na refatoração de Usuários

export async function renderUsuarios(){
  const grid = document.getElementById('usuariosGrid');
  if(!grid) return;

  // Admin: visão consolidada de TODAS as equipes (com edição)
  if(state.userPapel === 'admin'){
    await _renderUsuariosAdmin(grid, true);
    return;
  }

  // C3: configuração de jornada da equipe — visível p/ gestora E coordenador/auditor
  // (o coordenador analisa; a gravação segue restrita a gestora/admin pelas regras).
  if(state.isManager || state.isAuditor){
    const cfgArea = document.getElementById('usuariosConfigArea');
    if(cfgArea && !cfgArea.dataset.loaded){
      cfgArea.dataset.loaded = '1';
      await renderCfgColaboradores(cfgArea);
    }
  }

  // Coordenação (coordenador/auditor/rh): vê TODOS os colaboradores de TODAS as equipes,
  // igual ao admin, porém somente leitura (edição segue restrita a gestora/admin).
  if(state.isAuditor){
    await _renderUsuariosAdmin(grid, false);
    return;
  }

  // Gestora: somente a própria equipe
  const snap = await get(ref(db,`equipes/${EQUIPE_ID}/config/usuarios`));
  const data = snap.val()||{};
  grid.innerHTML = _buildUserCards(Object.entries(data), state.isManager);
}

function _buildUserCards(entries, canEdit, equipeId = EQUIPE_ID){
  const today = todayKey();
  const now = new Date(); const y=now.getFullYear(), mo=now.getMonth();
  const filtered = entries
    .filter(([,u]) => u.papel !== 'auditor' && u.papel !== 'coordenador')
    .sort((a,b) => (a[1].nome||'').localeCompare(b[1].nome||'','pt-BR'));

  if(!filtered.length)
    return `<div style="color:var(--muted);font-size:0.82rem;padding:20px 0;">Nenhum colaborador cadastrado.</div>`;

  return filtered.map(([uid,u])=>{
    const key      = u.key || uid;
    const initials = u.iniciais || (u.nome||key).slice(0,2).toUpperCase();
    const color    = u.cor || '#94A3B8';
    const active   = u.ativo !== false;
    const roleLabel = u.papel === 'gestora' ? 'Gestão' : u.papel === 'admin' ? 'Administração' : '';
    const todayData = calcDay(key, today);
    const todayH = Math.floor(todayData.totalMs/3600000);
    const todayM = Math.floor((todayData.totalMs%3600000)/60000);
    const monthMs = Object.values(state.allEntries)
      .filter(e=>e.collab===key && new Date(e.startTime).getFullYear()===y && new Date(e.startTime).getMonth()===mo)
      .reduce((s,e)=>s+e.duration, 0);
    const mh = Math.floor(monthMs/3600000), mm2 = Math.floor((monthMs%3600000)/60000);

    return `<div class="user-mgmt-card${active?'':' inactive'}">
      <div class="user-mgmt-card-header">
        <div class="user-mgmt-av" style="background:${color};${active?'':'filter:grayscale(0.5);opacity:0.7'}">${escH(initials)}</div>
        <div style="flex:1;min-width:0;">
          <div class="user-mgmt-name">${escH(u.nome||key)}</div>
          <div class="user-mgmt-email">${escH(u.email||'')}</div>
        </div>
        ${roleLabel?`<span style="font-size:0.6rem;color:var(--orange);font-weight:700;padding:2px 7px;background:var(--orange-light);border-radius:5px;flex-shrink:0;">${roleLabel}</span>`:''}
        ${canEdit?`<button onclick="openEditColabModal('${escH(key)}','${equipeId}')" style="background:none;border:none;cursor:pointer;color:var(--muted);display:flex;align-items:center;padding:4px;border-radius:6px;transition:color 0.2s;" title="Editar" aria-label="Editar ${escH(u.nome||key)}" onmouseover="this.style.color='var(--orange)'" onmouseout="this.style.color='var(--muted)'">${ICONS.edit}</button>`:''}
      </div>
      <div class="user-mgmt-stats">
        <div class="user-stat"><div class="user-stat-label">Horas hoje</div><div class="user-stat-value" style="color:var(--orange)">${todayH}h ${String(todayM).padStart(2,'0')}m</div></div>
        <div class="user-stat"><div class="user-stat-label">Horas no mês</div><div class="user-stat-value">${mh}h ${String(mm2).padStart(2,'0')}m</div></div>
      </div>
    </div>`;
  }).join('');
}

async function _renderUsuariosAdmin(grid, canEdit = true){
  const equipes = state.userEquipes?.length ? state.userEquipes : ['diagramacao','revisao','audiovisual','insercao'];
  grid.innerHTML = `<div style="color:var(--muted);font-size:0.78rem;padding:8px 0;">Carregando todas as equipes...</div>`;

  const results = await Promise.all(equipes.map(async eqId => {
    try {
      const snap = await get(ref(db,`equipes/${eqId}/config/usuarios`));
      return { eqId, data: snap.val()||{} };
    } catch(e) {
      return { eqId, data: {} };
    }
  }));

  const totalUsers = results.reduce((s,r)=>s+Object.keys(r.data).length,0);
  if(!totalUsers){
    grid.innerHTML = `<div style="color:var(--muted);font-size:0.82rem;padding:20px 0;">Nenhum colaborador cadastrado em nenhuma equipe.</div>`;
    return;
  }

  grid.innerHTML = results.map(({ eqId, data })=>{
    const entries = Object.entries(data).filter(([,u])=>u.papel!=='auditor');
    if(!entries.length) return '';
    const eqLabel = EQUIPE_LABELS[eqId] || eqId;
    const count = entries.length;
    return `
      <div style="grid-column:1/-1;margin-top:16px;margin-bottom:4px;">
        <span style="font-size:0.7rem;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:0.08em;">${escH(eqLabel)}</span>
        <span style="font-size:0.65rem;color:var(--muted);margin-left:6px;">${count} usuário${count!==1?'s':''}</span>
      </div>
      ${_buildUserCards(entries, canEdit, eqId)}`;
  }).join('');
}

// ── PAINEL DE APROVAÇÕES (gestora) ───────────────────────────────────────────
export function renderApprovals(){
  const section = document.getElementById('approvalSection');
  if(!section || !state.isManager) return;
  const _fh = ms => { const h=Math.floor(ms/3600000),m=Math.floor((ms%3600000)/60000); return h>0?`${h}h${m?` ${m}m`:''}`:`${m}m`; };
  const pending = Object.entries(state.allApprovals)
    .filter(([,r]) => r.status==='pending')
    .map(([k,r]) => ({...r, _key:k}))
    .sort((a,b) => a.requestedAt - b.requestedAt);

  if(!pending.length){
    section.innerHTML = `<div class="dash-section" style="margin-bottom:24px;">
      <div class="dash-section-title"><span>Aprovações Pendentes</span></div>
      <div style="text-align:center;color:var(--muted);font-size:0.82rem;padding:20px 0;">Nenhuma aprovação pendente ✓</div>
    </div>`;
    return;
  }

  section.innerHTML = `<div class="dash-section" style="margin-bottom:24px;border:1.5px solid var(--warn);border-radius:var(--radius);">
    <div class="dash-section-title">
      <span style="color:#92400E;">Aprovações Pendentes</span>
      <span style="font-family:var(--mono);font-size:0.7rem;background:#FEF3C7;color:#92400E;padding:2px 8px;border-radius:6px;">${pending.length}</span>
    </div>
    ${pending.map(r => {
      const col = state.COLLABS[r.requestedBy] || {label: r.requestedBy||r.requestedByEmail||'?', initials:'?', color:'#94A3B8'};
      const p = r.payload || {};
      const proj = state.PROJECTS[p.project] || {label: p.project||'?'};
      const dateStr = p.startTime ? new Date(p.startTime).toLocaleDateString('pt-BR') : '?';
      const durStr  = p.duration  ? _fh(p.duration) : '?';
      const typeLabel = r.type==='delete' ? `${ICONS.trash} Exclusão` : r.type==='edit' ? `${ICONS.edit} Edição` : `${ICONS.plus} Novo registro`;
      return `<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin-bottom:8px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
        <div style="width:32px;height:32px;border-radius:50%;background:${col.color};display:flex;align-items:center;justify-content:center;font-size:0.58rem;font-weight:800;color:#fff;flex-shrink:0">${col.initials||'?'}</div>
        <div style="flex:1;min-width:160px;">
          <div style="font-size:0.82rem;font-weight:800">${escH(p.task||'Sem título')}</div>
          <div style="font-size:0.68rem;color:var(--muted);margin-top:3px;">${escH(col.label)} · ${escH(proj.label)} · ${dateStr} · ${durStr}</div>
          <div style="font-size:0.65rem;margin-top:2px;color:var(--orange);font-weight:700;">${typeLabel}</div>
        </div>
        <div style="display:flex;gap:8px;">
          <button onclick="approveEntry('${r._key}')" style="padding:6px 16px;border-radius:8px;border:none;background:var(--success);color:#fff;font-size:0.75rem;font-weight:700;cursor:pointer;" aria-label="Aprovar solicitação de ${escH(col.label)}">Aprovar</button>
          <button onclick="rejectEntry('${r._key}')"  style="padding:6px 16px;border-radius:8px;border:none;background:var(--danger);color:#fff;font-size:0.75rem;font-weight:700;cursor:pointer;" aria-label="Recusar solicitação de ${escH(col.label)}">Recusar</button>
        </div>
      </div>`;
    }).join('')}
  </div>`;
}

window.approveEntry = async key => {
  const req = state.allApprovals[key]; if(!req) return;
  try {
    // Suporta formato V2 (entryKey) e V1 legado (state.editingId)
    const targetKey = req.entryKey || req.editingId || null;
    if(req.type === 'delete'){
      if(targetKey) await remove(child(entriesRef, targetKey));
    } else if(targetKey){
      await set(child(entriesRef, targetKey), req.payload);
    } else {
      await push(entriesRef, req.payload);
    }
    await remove(child(approvalRequestsRef, key));
    const dateStr = req.payload?.startTime ? new Date(req.payload.startTime).toLocaleDateString('pt-BR') : '?';
    if(req.requestedBy){
      await push(notifsRef,{
        to: req.requestedBy,
        title: req.type==='delete' ? 'Exclusão aprovada' : 'Lançamento aprovado',
        msg: req.type==='delete'
          ? `Sua solicitação de exclusão do registro de ${dateStr} foi aprovada.`
          : `Seu registro de ${dateStr} foi aprovado.`,
        from: state.currentCollabKey, ts: Date.now(), read: false
      });
    }
    showToast('Aprovado ✓', req.type==='delete' ? 'Exclusão realizada.' : 'Lançamento salvo com sucesso.');
  } catch(e) {
    showToast('Erro','Não foi possível aprovar. Verifique sua conexão.');
    console.error('[approveEntry]', e);
  }
};

window.rejectEntry = async key => {
  const req = state.allApprovals[key]; if(!req) return;
  try {
    await remove(child(approvalRequestsRef, key));
    const dateStr = req.payload?.startTime ? new Date(req.payload.startTime).toLocaleDateString('pt-BR') : '?';
    if(req.requestedBy){
      await push(notifsRef,{
        to: req.requestedBy,
        title: 'Solicitação recusada',
        msg: `Sua solicitação referente ao registro de ${dateStr} foi recusada pela gestora.`,
        from: state.currentCollabKey, ts: Date.now(), read: false
      });
    }
    showToast('Recusado','Solicitação removida.');
  } catch(e) {
    showToast('Erro','Não foi possível recusar. Verifique sua conexão.');
    console.error('[rejectEntry]', e);
  }
};

// Modal de edição de colaborador (acessível pela Gestão de Usuários)
window.openEditColabModal = async function(key, equipeId = EQUIPE_ID){
  const snap = await get(ref(db,`equipes/${equipeId}/config/usuarios`));
  const usersData = snap.val()||{};
  const uid = Object.entries(usersData).find(([,u])=>u.key===key)?.[0];
  if(!uid){ showToast('Erro','Colaborador não encontrado na config.'); return; }
  const u = usersData[uid];

  let modal = document.getElementById('editColabModal');
  if(!modal){
    modal = document.createElement('div');
    modal.id = 'editColabModal';
    modal.setAttribute('role','dialog');
    modal.setAttribute('aria-modal','true');
    modal.setAttribute('aria-label','Editar Colaborador');
    modal.style.cssText = 'position:fixed;inset:0;z-index:600;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;';
    document.body.appendChild(modal);
  }
  modal.innerHTML = `<div style="background:var(--surface);border-radius:18px;padding:28px;width:min(420px,95vw);box-shadow:var(--shadow-lg);">
    <input type="hidden" id="editColabEquipeId" value="${equipeId}">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
      <div style="font-weight:800;font-size:1rem;">Editar Colaborador</div>
      <button onclick="document.getElementById('editColabModal').style.display='none'" aria-label="Fechar" style="background:none;border:none;font-size:1.2rem;cursor:pointer;color:var(--muted);"><span aria-hidden="true">✕</span></button>
    </div>
    <div style="display:flex;flex-direction:column;gap:14px;">
      <label class="modal-label">Nome
        <input class="filter-select" id="editColabNome" value="${escH(u.nome||key)}" style="width:100%;margin-top:4px;">
      </label>
      ${state.userPapel === 'admin' ? `
      <label class="modal-label">Equipe
        <select class="filter-select" id="editColabNovaEquipe" style="width:100%;margin-top:4px;">
          <option value="all"${equipeId==='all'?' selected':''}>Todas as equipes (acesso global)</option>
          ${(state.userEquipes||[]).map(eq=>`<option value="${eq}"${eq===equipeId?' selected':''}>${EQUIPE_LABELS[eq]||eq}</option>`).join('')}
        </select>
      </label>` : `<input type="hidden" id="editColabNovaEquipe" value="${equipeId}">`}
      <label class="modal-label">Papel
        <select class="filter-select" id="editColabPapel" style="width:100%;margin-top:4px;">
          <option value="colaborador" ${u.papel==='colaborador'?'selected':''}>Colaborador</option>
          <option value="gestora" ${u.papel==='gestora'?'selected':''}>Gestão</option>
        </select>
      </label>
      <label class="modal-label">Cor
        <input type="color" id="editColabCor" value="${u.cor||'#94A3B8'}" style="width:60px;height:32px;margin-left:10px;border-radius:6px;padding:2px;">
      </label>
      <label class="modal-label" style="display:flex;align-items:center;gap:8px;">
        <input type="checkbox" id="editColabCuradora" ${u.curadora?'checked':''}>
        Pode fazer curadoria
      </label>
      <label class="modal-label">Estilo de trabalho
        <select class="filter-select" id="editColabEstilo" style="width:100%;margin-top:4px;">
          <option value="presencial" ${(u.estiloTrabalho||'presencial')==='presencial'?'selected':''}>Presencial</option>
          <option value="remoto" ${u.estiloTrabalho==='remoto'?'selected':''}>Remoto</option>
        </select>
      </label>
    </div>
    <div style="display:flex;gap:8px;margin-top:20px;justify-content:flex-end;">
      <button class="btn-sm" onclick="document.getElementById('editColabModal').style.display='none'">Cancelar</button>
      <button class="btn-sm success" onclick="saveEditColab('${uid}')">${ICONS.save} Salvar</button>
    </div>
  </div>`;
  modal.style.display = 'flex';
};

window.openNovoColabModal = function(){
  let modal = document.getElementById('editColabModal');
  if(!modal){
    modal = document.createElement('div');
    modal.id = 'editColabModal';
    modal.setAttribute('role','dialog');
    modal.setAttribute('aria-modal','true');
    modal.setAttribute('aria-label','Novo Colaborador');
    modal.style.cssText = 'position:fixed;inset:0;z-index:600;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;';
    document.body.appendChild(modal);
  }
  modal.innerHTML = `<div style="background:var(--surface);border-radius:var(--radius);padding:28px;width:min(460px,95vw);box-shadow:var(--shadow-lg);">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
      <div style="font-weight:800;font-size:1rem;">Novo Colaborador</div>
      <button onclick="document.getElementById('editColabModal').style.display='none'" style="background:none;border:none;cursor:pointer;color:var(--muted);display:flex;align-items:center;">${ICONS.x}</button>
    </div>
    <div style="display:flex;flex-direction:column;gap:14px;">
      <label class="modal-label">Nome completo
        <input class="modal-input" id="editColabNome" placeholder="Ex: Ana Silva" style="width:100%;margin-top:4px;">
      </label>
      <label class="modal-label">E-mail de acesso
        <input class="modal-input" id="editColabEmail" placeholder="ana@labtecie.com" type="email" autocomplete="off" style="width:100%;margin-top:4px;">
      </label>
      <label class="modal-label">Senha inicial
        <div style="position:relative;margin-top:4px;">
          <input class="modal-input" id="editColabSenha" type="password" placeholder="Mínimo 6 caracteres" autocomplete="new-password" style="width:100%;padding-right:44px;">
          <button type="button" onclick="const i=document.getElementById('editColabSenha');i.type=i.type==='password'?'text':'password';" style="position:absolute;right:10px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;color:var(--muted);display:flex;align-items:center;">${ICONS.edit}</button>
        </div>
        <div style="font-size:0.68rem;color:var(--muted);margin-top:4px;">A conta Firebase Auth será criada automaticamente com este e-mail e senha.</div>
      </label>
      ${state.userPapel === 'admin' ? `
      <label class="modal-label">Equipe
        <select class="modal-input" id="editColabEquipe" style="width:100%;margin-top:4px;">
          <option value="all">Todas as equipes (acesso global)</option>
          ${(state.userEquipes||[]).map(eq=>`<option value="${eq}"${eq===EQUIPE_ID?' selected':''}>${EQUIPE_LABELS[eq]||eq}</option>`).join('')}
        </select>
      </label>` : `<input type="hidden" id="editColabEquipe" value="${EQUIPE_ID}">`}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <label class="modal-label">Papel
          <select class="modal-input" id="editColabPapel" style="width:100%;margin-top:4px;">
            <option value="colaborador">Colaborador</option>
            <option value="gestora">Gestão</option>
            <option value="coordenador">Coordenador</option>
          </select>
        </label>
        <label class="modal-label">Cor
          <div style="display:flex;align-items:center;gap:8px;margin-top:4px;">
            <input type="color" id="editColabCor" value="#F15A24" style="width:44px;height:36px;padding:2px;border-radius:var(--ctrl-r);cursor:pointer;border:1.5px solid var(--border);">
            <span id="editColabCorLabel" style="font-size:0.72rem;color:var(--muted);">Escolha uma cor</span>
          </div>
        </label>
      </div>
      <label class="modal-label" style="display:flex;align-items:center;gap:8px;font-size:0.78rem;font-weight:500;text-transform:none;letter-spacing:0;cursor:pointer;">
        <input type="checkbox" id="editColabCuradora"> Pode fazer curadoria no Kanban
      </label>
    </div>
    <div id="editColabError" style="display:none;background:var(--danger-bg);border:1px solid var(--danger-border);border-radius:var(--ctrl-r);padding:8px 12px;font-size:0.78rem;color:var(--danger);margin-top:12px;"></div>
    <div style="display:flex;gap:8px;margin-top:20px;justify-content:flex-end;">
      <button class="btn-sm" onclick="document.getElementById('editColabModal').style.display='none'">Cancelar</button>
      <button class="btn-sm success" id="btnSaveNovoColab" onclick="saveNovoColab()">+ Criar colaborador</button>
    </div>
  </div>`;
  modal.style.display = 'flex';
};

window.saveNovoColab = async function(){
  const nome     = document.getElementById('editColabNome')?.value?.trim();
  // FIX: e-mail sempre em minúsculo (o Firebase Auth normaliza assim) — evita
  // que o mapeamento e-mail→colaborador quebre e o timer grave collab vazio.
  const email    = document.getElementById('editColabEmail')?.value?.trim().toLowerCase();
  const senha    = document.getElementById('editColabSenha')?.value;
  const papel    = document.getElementById('editColabPapel')?.value;
  const cor      = document.getElementById('editColabCor')?.value||'#94A3B8';
  const curadora = document.getElementById('editColabCuradora')?.checked;
  const equipeId = document.getElementById('editColabEquipe')?.value || EQUIPE_ID;
  const errEl    = document.getElementById('editColabError');
  const saveBtn  = document.getElementById('btnSaveNovoColab');
  const showErr  = msg=>{if(errEl){errEl.textContent=msg;errEl.style.display='block';}};
  if(errEl) errEl.style.display='none';

  if(!nome)                        return showErr('Nome é obrigatório.');
  if(!email||!email.includes('@')) return showErr('E-mail inválido.');
  if(!senha||senha.length<6)       return showErr('Senha precisa ter pelo menos 6 caracteres.');
  if(!equipeId)                    return showErr('Selecione a equipe do colaborador.');

  if(saveBtn){saveBtn.disabled=true;saveBtn.textContent='Criando...';}
  try{
    // Cria conta Firebase Auth via instância secundária — não desloga a gestora
    const secAuth = _getSecondaryAuth();
    const cred = await createUserWithEmailAndPassword(secAuth, email, senha);
    const firebaseUid = cred.user.uid;
    await signOut(secAuth);

    // Salva dados no banco usando o UID real do Firebase Auth
    const key = nome.toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g,'')
      .replace(/\s+/g,'_').replace(/[^a-z0-9_]/g,'');
    const iniciais = nome.split(' ').map(p=>p[0]?.toUpperCase()||'').slice(0,2).join('');
    const userData = {key,nome,email,papel,cor,curadora,ativo:true,iniciais};
    const todasEquipes = state.userEquipes?.length ? state.userEquipes : ['diagramacao','revisao','audiovisual','insercao'];
    const equipeDefault = todasEquipes[0] || 'diagramacao';

    const isCoord = papel === 'coordenador' || papel === 'auditor' || papel === 'rh';
    if(equipeId === 'all' || isCoord){
      // Coordenador/auditor: apenas no registro global, sem config de equipe
      await set(ref(db,`usuarios/${firebaseUid}`),{nome,email,equipeId:equipeDefault,equipes:todasEquipes,papel});
    } else {
      await set(ref(db,`equipes/${equipeId}/config/usuarios/${firebaseUid}`),userData);
      await set(ref(db,`usuarios/${firebaseUid}`),{nome,email,equipeId,papel});
    }

    // Atualiza memória local
    if(papel!=='auditor'&&papel!=='coordenador'){state.COLLABS[key]={label:nome,initials:iniciais,color:cor,active:true};state.COLLAB_EMAILS[email]=key;}
    if(papel==='gestora'){state.MANAGER_EMAILS.push(email);state.KANBAN_ROLES.gestora.push(key);}
    else if(papel==='auditor'||papel==='coordenador') state.AUDITOR_EMAILS.push(email);
    if(curadora&&!state.KANBAN_ROLES.curadoras.includes(key)) state.KANBAN_ROLES.curadoras.push(key);

    document.getElementById('editColabModal').style.display='none';
    showToast('Colaborador criado',`${nome} foi adicionado. Já pode fazer login com o e-mail e senha informados.`);
    registrarLog('usuario','Criou colaborador', `${nome} (${email})`);
    const cfgArea=document.getElementById('usuariosConfigArea');
    if(cfgArea) cfgArea.removeAttribute('data-loaded');
    await renderUsuarios();

  }catch(err){
    const msgs={
      'auth/email-already-in-use':'Este e-mail já possui uma conta no sistema.',
      'auth/invalid-email':       'E-mail inválido.',
      'auth/weak-password':       'Senha fraca — use pelo menos 6 caracteres.',
      'auth/network-request-failed':'Sem conexão. Verifique sua internet.',
    };
    showErr(msgs[err.code]||'Erro: '+err.message);
    console.error('[saveNovoColab]',err);
  }finally{
    if(saveBtn){saveBtn.disabled=false;saveBtn.textContent='+ Criar colaborador';}
  }
};


window.saveEditColab = async function(uid){
  const nome       = document.getElementById('editColabNome')?.value?.trim();
  const papel      = document.getElementById('editColabPapel')?.value;
  const cor        = document.getElementById('editColabCor')?.value;
  const curadora   = document.getElementById('editColabCuradora')?.checked;
  const estiloTrabalho = document.getElementById('editColabEstilo')?.value || 'presencial';
  const eqIdOrig   = document.getElementById('editColabEquipeId')?.value || EQUIPE_ID;
  const eqIdNova   = document.getElementById('editColabNovaEquipe')?.value || eqIdOrig;
  if(!nome) return;

  const equipeChanged = eqIdNova !== eqIdOrig;
  const todasEquipes  = state.userEquipes?.length ? state.userEquipes : ['diagramacao','revisao','audiovisual','insercao'];
  const equipeDefault = todasEquipes[0] || 'diagramacao';

  const isCoord = papel === 'coordenador' || papel === 'auditor' || papel === 'rh';

  if(isCoord || eqIdNova === 'all'){
    // Coordenador: apenas no registro global — remove de todas as configs de equipe
    for(const eq of todasEquipes){
      try { await remove(ref(db,`equipes/${eq}/config/usuarios/${uid}`)); } catch(e) {}
    }
    await update(ref(db,`usuarios/${uid}`),{equipeId:equipeDefault,equipes:todasEquipes,papel});
  } else if(equipeChanged){
    const snapOrig = await get(ref(db,`equipes/${eqIdOrig}/config/usuarios/${uid}`));
    const dataOrig = snapOrig.val()||{};
    await set(ref(db,`equipes/${eqIdNova}/config/usuarios/${uid}`),{...dataOrig,nome,papel,cor,curadora,estiloTrabalho});
    await remove(ref(db,`equipes/${eqIdOrig}/config/usuarios/${uid}`));
    await update(ref(db,`usuarios/${uid}`),{equipeId:eqIdNova,papel});
  } else {
    await update(ref(db,`equipes/${eqIdOrig}/config/usuarios/${uid}`),{nome,papel,cor,curadora,estiloTrabalho});
  }

  const readEqId = eqIdNova === 'all' ? equipeDefault : eqIdNova;
  const snap = await get(ref(db,`equipes/${readEqId}/config/usuarios/${uid}`));
  const u = snap.val()||{};
  if(u.key && state.COLLABS[u.key]){
    state.COLLABS[u.key] = {...state.COLLABS[u.key], label:nome, color:cor};
    if(curadora && !state.KANBAN_ROLES.curadoras.includes(u.key)) state.KANBAN_ROLES.curadoras.push(u.key);
    if(!curadora) state.KANBAN_ROLES.curadoras = state.KANBAN_ROLES.curadoras.filter(k=>k!==u.key);
  }
  document.getElementById('editColabModal').style.display = 'none';
  const msg = eqIdNova === 'all'
    ? `${nome} agora tem acesso a todas as equipes.`
    : equipeChanged
    ? `${nome} movido para ${EQUIPE_LABELS[eqIdNova]||eqIdNova}.`
    : `${nome} atualizado.`;
  showToast('Salvo', msg);
  registrarLog('usuario','Editou colaborador', msg);
  renderUsuarios();
};

window.exportDemandasCSV = ()=>{
  const dateStart=document.getElementById('filterDateStart')?.value||'';
  const dateEnd=document.getElementById('filterDateEnd')?.value||'';
  const collabFilter=document.getElementById('filterCollabD')?.value||'';
  let data=getEntriesArray().map(([k,e])=>({...e,_key:k}));
  if(dateStart || dateEnd){
    const startTs = dateStart ? new Date(dateStart+'T00:00:00').getTime() : 0;
    const endTs   = dateEnd   ? new Date(dateEnd+'T23:59:59').getTime()   : Infinity;
    data=data.filter(e=>e.startTime>=startTs && e.startTime<=endTs);
  }
  if(collabFilter)data=data.filter(e=>e.collab===collabFilter);
  const header='Data,Colaborador,Tarefa,Projeto,Início,Fim,Duração,% Amount,Tags,Observação';
  const lines=data.map(e=>{const col=state.COLLABS[e.collab]||{label:e.collab};const proj=state.PROJECTS[e.project]||{label:e.project};return[new Date(e.startTime).toLocaleDateString('pt-BR'),col.label,`"${(e.task||'').replace(/"/g,'""')}"`,proj.label,fmtTime(e.startTime),fmtTime(e.endTime),fmtDur(e.duration),calcAmount(e.project,e.duration).toFixed(2)+'%',`"${(e.tags||[]).join('; ')}"`,`"${(e.obs||'').replace(/"/g,'""')}"`].join(',');});
  dlCSV([header,...lines].join('\n'),`kronos_demandas_${new Date().toISOString().slice(0,10)}.csv`);
};

function dlCSV(content,filename){
  const blob=new Blob(['\uFEFF'+content],{type:'text/csv;charset=utf-8;'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=filename;a.click();URL.revokeObjectURL(url);
}

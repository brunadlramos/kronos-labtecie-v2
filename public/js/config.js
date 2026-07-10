// ── KRONOS · CONFIGURAÇÕES ──────────────────────────────────────────────────
// Painel de configurações da gestora: projetos, metas, tags, colunas,
// colaboradores, geral, e utilitários de migração.

import { app as state } from './state.js';
import { ICONS }        from './icons.js';
import { escH, fmtDur, fmtShortDate, dKey, getWeekDays, resizeImageToDataURL } from './utils.js';
import {
  db, auth, kanbanRef, customTagsRef, removedTagsRef,
  customProjectsRef, usersRef, notifsRef, avatarsRef, entriesRef, EQUIPE_ID
} from './firebase-refs.js';
import { sendPasswordResetEmail } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
  ref, push, set, update, get, remove, child, onValue
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';
import { _refreshKColSelect, _initKColState } from './kanban.js';
import { showToast, setSyncStatus } from './ui.js';
import { registrarLog } from './log.js';

// Gera um ID a partir do NOME (sem acentos, minúsculo, _). O gestor só digita o nome.
function _slugify(nome){
  return String(nome||'')
    .normalize('NFD').replace(new RegExp('[\\u0300-\\u036f]','g'),'')   // remove acentos
    .toLowerCase()
    .replace(/[^a-z0-9]+/g,'_')                          // não-alfanumérico → _
    .replace(/^_+|_+$/g,'')                              // tira _ das pontas
    .slice(0,40);
}
// Garante ID único frente aos já existentes (anexa _2, _3, …)
function _uniqueId(base, existing){
  if(!base) return '';
  let id = base, n = 2;
  while(existing && existing[id]) id = `${base}_${n++}`;
  return id;
}

// Quem pode alterar o CARGO de um colaborador (promover/rebaixar): só coordenador/admin.
// A gestão apenas ativa a curadoria — não promove colaboradores.
function _canPromover(){ return state.userPapel === 'admin' || state.userPapel === 'coordenador'; }

// ── CFG: COLABORADORES ───────────────────────────────────────────────────────
export async function renderCfgColaboradores(targetEl){
  const snap = await get(ref(db,`equipes/${EQUIPE_ID}/config/usuarios`));
  const data = snap.val()||{};
  const el = targetEl || document.getElementById('cfgContent');
  if(!el) return;
  el.innerHTML = `
  <div class="dash-section">
    <div class="dash-section-title"><span>Configuração de Colaboradores</span></div>
    <div style="overflow-x:auto;">
    <table class="demands-table cfg-colab-table" style="min-width:920px;">
      <thead><tr>
        <th>Nome</th><th>E-mail</th><th>Papel</th><th>Cor</th>
        <th title="Horas por dia útil">H/Dia</th>
        <th title="Horas por semana (referência)">H/Semana</th>
        <th title="Presencial ou remoto">Estilo</th>
        <th style="text-align:center">Ativo</th>
        <th style="text-align:center">Curadora</th>
        <th style="text-align:center" title="Gestor temporário: dá poderes de gestão à pessoa enquanto o gestor titular está de férias/atestado. NÃO altera o cargo e não entra no ranking.">Gestor temp.</th>
        <th>Ações</th>
      </tr></thead>
      <tbody>
        ${(()=>{ const _row = ([uid,u]) => `<tr>
          <td><input class="filter-select" value="${escH(u.nome||u.key||uid)}" id="unm_${uid}" style="width:120px;height:var(--ctrl-h)"></td>
          <td style="font-size:0.75rem;color:var(--muted);white-space:nowrap">${escH(u.email||'')}</td>
          <td><select class="filter-select" id="upl_${uid}" style="width:110px" ${_canPromover()?'':'disabled title="Apenas o coordenador altera o cargo. A gestão só ativa a curadoria."'}>
            <option value="colaborador"  ${u.papel==='colaborador'?'selected':''}>Colaborador</option>
            <option value="gestora"      ${u.papel==='gestora'?'selected':''}>Gestão</option>
            <option value="coordenador"  ${(u.papel==='coordenador'||u.papel==='auditor'||u.papel==='rh')?'selected':''}>Coordenador</option>
          </select></td>
          <td style="vertical-align:middle;">
            <div style="display:inline-flex;align-items:center;gap:6px;">
              <span id="udot_${uid}" style="width:16px;height:16px;border-radius:50%;background:${u.cor||'#94A3B8'};border:1px solid var(--border);flex-shrink:0;display:inline-block;"></span>
              <input type="color" value="${u.cor||'#94A3B8'}" id="ucl_${uid}" oninput="document.getElementById('udot_${uid}').style.background=this.value" style="width:36px;height:26px;padding:2px;border-radius:6px;cursor:pointer;vertical-align:middle;">
            </div>
          </td>
          <td>
            <input type="number" class="filter-select" id="uhd_${uid}"
              value="${u.horasDia??''}" placeholder="Padrão"
              min="0" max="24" step="0.5" style="width:80px;height:var(--ctrl-h)"
              title="Horas por dia. Deixe vazio para usar a meta global da equipe.">
          </td>
          <td>
            <input type="number" class="filter-select" id="uhs_${uid}"
              value="${u.horasSemana??''}" placeholder="Auto"
              min="0" max="60" step="0.5" style="width:80px;height:var(--ctrl-h)"
              title="Horas semanais (apenas referência — calculado automaticamente se vazio).">
          </td>
          <td>
            <select class="filter-select" id="ues_${uid}" style="width:112px;height:var(--ctrl-h)">
              <option value="presencial" ${(u.estiloTrabalho||'presencial')==='presencial'?'selected':''}>Presencial</option>
              <option value="remoto" ${u.estiloTrabalho==='remoto'?'selected':''}>Remoto</option>
            </select>
          </td>
          <td style="text-align:center"><input type="checkbox" ${u.ativo!==false?'checked':''} id="uat_${uid}"></td>
          <td style="text-align:center"><input type="checkbox" ${u.curadora?'checked':''} id="ucr_${uid}"></td>
          <td style="text-align:center"><input type="checkbox" ${u.gestorTemp?'checked':''} id="gtmp_${uid}" title="Gestor temporário"></td>
          <td style="display:flex;gap:4px;flex-wrap:wrap;">
            <button class="btn-sm" onclick="cfgSaveColaborador('${uid}')">${ICONS.save} Salvar</button>
            <button class="btn-sm" onclick="openAusenciasModal('${uid}')" title="Ausências recorrentes (ex.: estágio)" style="font-size:0.7rem;">⏰ Ausências${Array.isArray(u.ausencias)&&u.ausencias.length?` (${u.ausencias.length})`:''}</button>
            <button class="btn-sm" onclick="openFeriasModal('${uid}')" title="Períodos de férias" style="font-size:0.7rem;">Férias${Array.isArray(u.ferias)&&u.ferias.length?` (${u.ferias.length})`:''}</button>
            ${u.email?`<button class="btn-sm" onclick="cfgResetPassword('${escH(u.email)}')" title="Enviar e-mail de redefinição de senha" style="font-size:0.7rem;">${ICONS.send} Senha</button>`:''}
          </td>
        </tr>`;
          const _all = Object.entries(data);
          const _act = _all.filter(([,u])=>u.ativo!==false);
          const _ina = _all.filter(([,u])=>u.ativo===false);
          let _o = _act.map(_row).join('');
          if(_ina.length){
            _o += `<tr class="cfg-inativos-toggle" onclick="toggleCfgInativos()" style="cursor:pointer;" title="Mostrar/ocultar inativos"><td colspan="11" style="padding:14px 10px 8px;font-size:0.64rem;font-weight:800;text-transform:uppercase;letter-spacing:0.06em;color:var(--muted);background:var(--surface2);border-bottom:1.5px solid var(--border);">Inativos (${_ina.length}) <span id="cfgInativosArrow">▾</span></td></tr>`;
            _o += _ina.map(e => _row(e).replace('<tr>', '<tr class="cfg-inativa-row" style="display:none">')).join('');
          }
          return _o;
        })()}
      </tbody>
    </table>
    </div>
    <p style="font-size:0.72rem;color:var(--muted);margin-top:10px;line-height:1.6;">
      ${ICONS.warning} <strong>H/Dia</strong> define a meta diária individual. Deixe vazio para usar a meta global configurada em Metas.
      Útil para estagiários, meio período ou jornadas reduzidas.
    </p>
  </div>`;
}

// cfgAddColaborador removida — substituída por openNovoColabModal + saveNovoColab (com Firebase Auth)

window.cfgResetPassword = async function(email){
  if(!confirm(`Enviar e-mail de redefinição de senha para ${email}?`)) return;
  try{
    await sendPasswordResetEmail(auth, email);
    showToast('E-mail enviado', `Instruções de redefinição enviadas para ${email}.`);
  }catch(err){
    const msg = err.code === 'auth/user-not-found'
      ? 'Nenhuma conta encontrada com esse e-mail.'
      : 'Não foi possível enviar o e-mail. Verifique sua conexão.';
    showToast('Erro', msg);
  }
};

window.cfgSaveColaborador = async function(uid){
  const snap = await get(ref(db,`equipes/${EQUIPE_ID}/config/usuarios/${uid}`));
  const orig = snap.val()||{};
  const nome     = document.getElementById(`unm_${uid}`)?.value?.trim()||orig.nome;
  // Cargo só muda se o usuário pode promover (coordenador/admin). Gestão mantém o original.
  const papel    = _canPromover() ? (document.getElementById(`upl_${uid}`)?.value||orig.papel) : (orig.papel||'colaborador');
  const cor      = document.getElementById(`ucl_${uid}`)?.value||orig.cor;
  const ativo    = document.getElementById(`uat_${uid}`)?.checked;
  const curadora = document.getElementById(`ucr_${uid}`)?.checked;
  const horasDia     = parseFloat(document.getElementById(`uhd_${uid}`)?.value)||null;
  const horasSemana  = parseFloat(document.getElementById(`uhs_${uid}`)?.value)||null;
  const estiloTrabalho = document.getElementById(`ues_${uid}`)?.value || orig.estiloTrabalho || 'presencial';
  const gestorTemp = document.getElementById(`gtmp_${uid}`)?.checked || false;
  const updates = {nome,papel,cor,ativo,curadora,estiloTrabalho,gestorTemp};
  if(horasDia    !== null) updates.horasDia    = horasDia;
  if(horasSemana !== null) updates.horasSemana = horasSemana;
  await update(ref(db,`equipes/${EQUIPE_ID}/config/usuarios/${uid}`),updates);
  // FIX (causa raiz): as regras de segurança leem o papel do nó GLOBAL /usuarios.
  // Ao promover/editar cargo, sincroniza papel + equipeId no global — senão a gestora
  // "de config" fica como colaborador para as regras e NÃO consegue excluir/editar
  // registros de outros. Só admin tem permissão de escrever no global existente; para
  // coordenador a regra de entries já reconhece a gestora via config (fallback).
  if(_canPromover()){
    try { await update(ref(db,`usuarios/${uid}`), { papel, equipeId: EQUIPE_ID }); }
    catch(e){ console.warn('[cfgSaveColaborador] papel global não sincronizado (permissão):', e?.code||e); }
  }
  // Atualiza cache local imediatamente
  const key = orig.key||nome.toLowerCase().replace(/\s+/g,'_');
  if(horasDia !== null)   state.COLLAB_HOURS[key] = {...(state.COLLAB_HOURS[key]||{}), horasDia};
  if(horasSemana !== null) state.COLLAB_HOURS[key] = {...(state.COLLAB_HOURS[key]||{}), horasSemana};
  showToast('Salvo',`${nome} atualizado.`);
  // Atualiza os cards na hora (ex.: desativar move o card para a seção "Inativos").
  if(window.renderUsuarios) window.renderUsuarios();
};

// Mostra/oculta as linhas de colaboradores inativos na tabela de config avançada.
window.toggleCfgInativos = ()=>{
  const rows = document.querySelectorAll('.cfg-inativa-row');
  if(!rows.length) return;
  const willOpen = rows[0].style.display === 'none';
  rows.forEach(r => { r.style.display = willOpen ? '' : 'none'; });
  const arrow = document.getElementById('cfgInativosArrow');
  if(arrow) arrow.textContent = willOpen ? '▴' : '▾';
};

// Gestão define a foto de um colaborador (base64 reduzido, sem Storage)
window.cfgUploadColabFoto = async (key, input)=>{
  const file = input.files && input.files[0];
  if(!file){ return; }
  try{
    const dataUrl = await resizeImageToDataURL(file, 128, 0.72);
    if(dataUrl.length > 60000){ showToast('Imagem muito pesada','Tente uma foto menor/mais simples.'); return; }
    await update(child(avatarsRef, key), { foto: dataUrl });   // só o campo foto (preserva emoji/cor/nome)
    state.allAvatars[key] = { ...(state.allAvatars[key]||{}), foto: dataUrl };
    registrarLog('usuario','Atualizou foto do colaborador', key);
    showToast('Foto atualizada','A foto do colaborador foi salva.');
    try { window.renderDashboard?.(); } catch(e){}
  }catch(e){
    showToast('Erro','Não foi possível salvar a foto.');
    console.error('[cfgUploadColabFoto]', e);
  } finally { input.value=''; }
};

// ── AUSÊNCIAS RECORRENTES (ex.: estágio) ──────────────────────────────────────
// Janelas fixas por dia da semana que reduzem a meta do dia automaticamente.
const _DOW_LABELS = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
window.openAusenciasModal = async function(uid){
  const snap = await get(ref(db,`equipes/${EQUIPE_ID}/config/usuarios/${uid}`));
  const u = snap.val()||{};
  window._ausUid  = uid;
  window._ausKey  = u.key || uid;
  window._ausNome = u.nome || u.key || uid;
  window._ausList = Array.isArray(u.ausencias) ? u.ausencias.map(a=>({...a})) : [];
  let modal = document.getElementById('ausenciasModal');
  if(!modal){
    modal = document.createElement('div');
    modal.id = 'ausenciasModal';
    modal.className = 'modal-overlay';
    modal.setAttribute('role','dialog');
    modal.setAttribute('aria-modal','true');
    document.body.appendChild(modal);
  }
  _renderAusenciasModal();
  modal.classList.add('open');
};
window.closeAusenciasModal = ()=>{ document.getElementById('ausenciasModal')?.classList.remove('open'); };
function _renderAusenciasModal(){
  const modal = document.getElementById('ausenciasModal'); if(!modal) return;
  const list = window._ausList||[];
  const linhas = list.length ? list.map((a,i)=>`
    <div style="display:flex;align-items:center;gap:8px;background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:7px 10px;margin-bottom:6px;">
      <div style="flex:1;font-size:0.78rem;"><strong>${escH(_DOW_LABELS[a.dow]||'?')}</strong> · ${escH(a.ini||'')}–${escH(a.fim||'')}${a.motivo?` · <span style="color:var(--muted)">${escH(a.motivo)}</span>`:''}</div>
      <button class="btn-sm danger" onclick="removeAusencia(${i})" style="font-size:0.7rem;" aria-label="Remover">${ICONS.trash}</button>
    </div>`).join('') : `<div style="font-size:0.78rem;color:var(--muted);padding:6px 0;">Nenhuma ausência cadastrada.</div>`;
  modal.innerHTML = `
    <div class="modal" style="max-width:520px;">
      <div class="modal-title">Ausências de ${escH(window._ausNome||'')}</div>
      <div style="font-size:0.72rem;color:var(--muted);margin:-6px 0 14px;line-height:1.5;">Janelas fixas por dia da semana (ex.: estágio). A meta do dia é reduzida automaticamente nesse período — o colaborador não precisa registrar.</div>
      <div style="margin-bottom:12px;">${linhas}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:flex-end;border-top:1px solid var(--border);padding-top:12px;">
        <div><label class="modal-label" for="ausDow">Dia</label>
          <select class="modal-select" id="ausDow" style="width:120px;">
            ${[1,2,3,4,5].map(d=>`<option value="${d}">${_DOW_LABELS[d]}</option>`).join('')}
          </select></div>
        <div><label class="modal-label" for="ausIni">Início</label>
          <input class="modal-input" type="time" id="ausIni" style="width:110px;" value="13:00"></div>
        <div><label class="modal-label" for="ausFim">Fim</label>
          <input class="modal-input" type="time" id="ausFim" style="width:110px;" value="15:00"></div>
        <div style="flex:1;min-width:120px;"><label class="modal-label" for="ausMotivo">Motivo</label>
          <input class="modal-input" type="text" id="ausMotivo" placeholder="Ex.: estágio" maxlength="60"></div>
        <button class="btn-sm" onclick="addAusencia()" style="height:var(--ctrl-h);">+ Adicionar</button>
      </div>
      <div class="modal-actions">
        <button class="btn-cancel" onclick="closeAusenciasModal()">Cancelar</button>
        <button class="btn-save" onclick="saveAusencias()">Salvar</button>
      </div>
    </div>`;
}
window.addAusencia = ()=>{
  const dow = parseInt(document.getElementById('ausDow')?.value,10);
  const ini = document.getElementById('ausIni')?.value||'';
  const fim = document.getElementById('ausFim')?.value||'';
  const motivo = (document.getElementById('ausMotivo')?.value||'').trim().slice(0,60);
  if(!ini || !fim){ showToast('⚠️ Atenção','Informe início e fim.'); return; }
  if(fim <= ini){ showToast('⚠️ Atenção','O fim deve ser depois do início.'); return; }
  window._ausList = window._ausList||[];
  window._ausList.push({dow, ini, fim, motivo});
  _renderAusenciasModal();
};
window.removeAusencia = (i)=>{ (window._ausList||[]).splice(i,1); _renderAusenciasModal(); };
window.saveAusencias = async ()=>{
  const uid = window._ausUid, key = window._ausKey;
  const list = window._ausList||[];
  try{
    await update(ref(db,`equipes/${EQUIPE_ID}/config/usuarios/${uid}`), { ausencias: list.length ? list : null });
    state.COLLAB_HOURS[key] = { ...(state.COLLAB_HOURS[key]||{}), ausencias: list.length ? list : undefined };
    registrarLog('config','Atualizou ausências', `${window._ausNome} (${list.length})`);
    showToast('Salvo','Ausências atualizadas. A meta do dia será ajustada automaticamente.');
    closeAusenciasModal();
    try { window.renderDashboard?.(); } catch(e){}
    await renderCfgColaboradores(document.getElementById('usuariosConfigArea')||document.getElementById('cfgContent'));
  }catch(e){
    showToast('Erro','Não foi possível salvar as ausências.');
    console.error('[saveAusencias]', e);
  }
};

// ── FÉRIAS (períodos por colaborador) ─────────────────────────────────────────
// Intervalos de datas em que o colaborador está de férias. Nesses dias a meta é 0
// (não é penalizado) e a tabela/cards mostram "Férias".
const _fmtFeriasRange = (ini,fim)=>{
  const f = s => { const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s||'')); return m?`${m[3]}/${m[2]}/${m[1]}`:s; };
  return `${f(ini)} → ${f(fim)}`;
};
window.openFeriasModal = async function(uid){
  const snap = await get(ref(db,`equipes/${EQUIPE_ID}/config/usuarios/${uid}`));
  const u = snap.val()||{};
  window._ferUid  = uid;
  window._ferKey  = u.key || uid;
  window._ferNome = u.nome || u.key || uid;
  window._ferList = Array.isArray(u.ferias) ? u.ferias.map(a=>({...a})) : [];
  let modal = document.getElementById('feriasModal');
  if(!modal){
    modal = document.createElement('div');
    modal.id = 'feriasModal';
    modal.className = 'modal-overlay';
    modal.setAttribute('role','dialog');
    modal.setAttribute('aria-modal','true');
    document.body.appendChild(modal);
  }
  _renderFeriasModal();
  modal.classList.add('open');
};
window.closeFeriasModal = ()=>{ document.getElementById('feriasModal')?.classList.remove('open'); };
function _renderFeriasModal(){
  const modal = document.getElementById('feriasModal'); if(!modal) return;
  const list = (window._ferList||[]).slice().sort((a,b)=>String(a.ini).localeCompare(String(b.ini)));
  const linhas = list.length ? list.map((a,i)=>`
    <div style="display:flex;align-items:center;gap:8px;background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:7px 10px;margin-bottom:6px;">
      <div style="flex:1;font-size:0.78rem;"><strong>${escH(_fmtFeriasRange(a.ini,a.fim))}</strong>${a.motivo?` · <span style="color:var(--muted)">${escH(a.motivo)}</span>`:''}</div>
      <button class="btn-sm danger" onclick="removeFerias(${i})" style="font-size:0.7rem;" aria-label="Remover">${ICONS.trash}</button>
    </div>`).join('') : `<div style="font-size:0.78rem;color:var(--muted);padding:6px 0;">Nenhum período cadastrado.</div>`;
  modal.innerHTML = `
    <div class="modal" style="max-width:520px;">
      <div class="modal-title">Férias de ${escH(window._ferNome||'')}</div>
      <div style="font-size:0.72rem;color:var(--muted);margin:-6px 0 14px;line-height:1.5;">Nos dias dentro do período, a meta do dia fica zerada e o colaborador aparece como "Férias".</div>
      <div style="margin-bottom:12px;">${linhas}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:flex-end;border-top:1px solid var(--border);padding-top:12px;">
        <div><label class="modal-label" for="ferIni">Início</label>
          <input class="modal-input" type="date" id="ferIni" style="width:150px;"></div>
        <div><label class="modal-label" for="ferFim">Fim</label>
          <input class="modal-input" type="date" id="ferFim" style="width:150px;"></div>
        <div style="flex:1;min-width:120px;"><label class="modal-label" for="ferMotivo">Motivo (opcional)</label>
          <input class="modal-input" type="text" id="ferMotivo" placeholder="Ex.: férias" maxlength="60"></div>
        <button class="btn-sm" onclick="addFerias()" style="height:var(--ctrl-h);">+ Adicionar</button>
      </div>
      <div class="modal-actions">
        <button class="btn-cancel" onclick="closeFeriasModal()">Cancelar</button>
        <button class="btn-save" onclick="saveFerias()">Salvar</button>
      </div>
    </div>`;
}
window.addFerias = ()=>{
  const ini = document.getElementById('ferIni')?.value||'';
  const fim = document.getElementById('ferFim')?.value||'';
  const motivo = (document.getElementById('ferMotivo')?.value||'').trim().slice(0,60);
  if(!ini || !fim){ showToast('⚠️ Atenção','Informe início e fim.'); return; }
  if(fim < ini){ showToast('⚠️ Atenção','O fim deve ser igual ou depois do início.'); return; }
  window._ferList = window._ferList||[];
  window._ferList.push({ini, fim, motivo});
  _renderFeriasModal();
};
window.removeFerias = (i)=>{ (window._ferList||[]).splice(i,1); _renderFeriasModal(); };
window.saveFerias = async ()=>{
  const uid = window._ferUid, key = window._ferKey;
  const list = window._ferList||[];
  try{
    await update(ref(db,`equipes/${EQUIPE_ID}/config/usuarios/${uid}`), { ferias: list.length ? list : null });
    state.COLLAB_HOURS[key] = { ...(state.COLLAB_HOURS[key]||{}), ferias: list.length ? list : undefined };
    registrarLog('config','Atualizou férias', `${window._ferNome} (${list.length})`);
    showToast('Salvo','Férias atualizadas.');
    closeFeriasModal();
    try { window.renderDashboard?.(); } catch(e){}
    await renderCfgColaboradores(document.getElementById('usuariosConfigArea')||document.getElementById('cfgContent'));
  }catch(e){
    showToast('Erro','Não foi possível salvar as férias.');
    console.error('[saveFerias]', e);
  }
};

// ── CFG: GERAL ───────────────────────────────────────────────────────────────
async function renderCfgGeral(){
  const snap = await get(ref(db,`equipes/${EQUIPE_ID}/config/geral`));
  const data = snap.val()||{};
  // A7: configs legados (sem o flag) mantêm a avaliação ligada por padrão
  const avalAtiva = data.avaliacaoAtiva !== undefined ? !!data.avaliacaoAtiva : true;
  const el = document.getElementById('cfgContent');
  el.innerHTML = `
  <div class="dash-section">
    <div class="dash-section-title">Configurações Gerais</div>
    <div style="display:flex;flex-direction:column;gap:14px;max-width:440px;">
      <label class="modal-label">Nome da equipe
        <input class="filter-select" id="cfgNome" value="${escH(data.nome||state.EQUIPE_NOME)}" style="width:200px;margin-left:10px;">
      </label>
      <label class="modal-label" style="display:flex;align-items:center;gap:8px;text-transform:none;letter-spacing:0;font-weight:500;cursor:pointer;">
        <input type="checkbox" id="cfgAvaliacaoAtiva" ${avalAtiva?'checked':''}>
        Usar avaliação por estrelas (curadoria) nesta equipe
      </label>
      <button class="btn-sm success" onclick="cfgSaveGeral()" style="width:120px;">${ICONS.save} Salvar</button>
    </div>
  </div>`;
}

window.cfgSaveGeral = async function(){
  const nome = document.getElementById('cfgNome')?.value?.trim();
  if(!nome) return;
  const avaliacaoAtiva = !!document.getElementById('cfgAvaliacaoAtiva')?.checked;
  // update (não set) preserva demais chaves de config/geral
  await update(ref(db,`equipes/${EQUIPE_ID}/config/geral`),{nome, janelaEdicao:state.EDIT_WINDOW_DAYS, avaliacaoAtiva});
  state.EQUIPE_NOME = nome;
  state.avaliacaoAtiva = avaliacaoAtiva;
  const ttl = document.getElementById('topbarTeamName');
  if(ttl) ttl.textContent = nome;
  showToast('Salvo','Nome da equipe atualizado.');
  registrarLog('config','Alterou configurações gerais', nome);
};

// ── V2: SCRIPT DE INICIALIZAÇÃO ──────────────────────────────────────────────
// Removido: o antigo window.runMigracao embutia UIDs/e-mails reais no bundle do
// cliente. A migração já foi concluída; o seed agora vive fora do código servido.

// ── V2: PAINEL DE CONFIGURAÇÕES DA GESTORA ───────────────────────────────────
// Called from index_v2.js AFTER window.showPage = showPage is set
export function patchShowPageForConfig(origShowPage) {
  window.showPage = (id, el) => {
    if(id === 'configuracoes') renderConfiguracoes();
    origShowPage(id, el);
  };
}

// Exporta para uso pelo Kanban (openKanbanColsModal)
window.renderCfgColunas = renderCfgColunas;

export async function renderConfiguracoes(){
  const wrap = document.getElementById('page-configuracoes');
  if(!wrap) return;
  wrap.innerHTML = `<div class="section-heading">Configurações</div>
  <div class="section-sub">Gerencie projetos, metas, colunas e dados gerais da equipe</div>
  <div style="display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap;" id="cfgTabs">
    <button class="btn-sm cfg-tab" data-tab="projetos" onclick="showCfgTab('projetos')">Projetos</button>
    <button class="btn-sm cfg-tab" data-tab="metas"    onclick="showCfgTab('metas')">Metas</button>
    <button class="btn-sm cfg-tab" data-tab="tags"     onclick="showCfgTab('tags')">Tags</button>
    <button class="btn-sm cfg-tab" data-tab="colunas"  onclick="showCfgTab('colunas')">Colunas Kanban</button>
    <button class="btn-sm cfg-tab" data-tab="colarq"   onclick="showCfgTab('colarq')">Colunas Arquivo</button>
    <button class="btn-sm cfg-tab" data-tab="geral"    onclick="showCfgTab('geral')">Geral</button>
  </div>
  <div id="cfgContent"></div>`;
  showCfgTab('projetos');
};

window.showCfgTab = function(tab){
  document.querySelectorAll('.cfg-tab').forEach(b=>b.classList.toggle('active', b.dataset.tab === tab));
  const el = document.getElementById('cfgContent');
  if(!el) return;
  const handlers = {
    projetos: renderCfgProjetos,
    metas:    renderCfgMetas,
    tags:     renderCfgTags,
    colunas:  renderCfgColunas,
    colarq:   window.renderCfgArquivoCols,
    geral:    renderCfgGeral,
  };
  (handlers[tab] || (()=>{}))();
};

// ── CFG: PROJETOS ────────────────────────────────────────────────────────────
async function renderCfgProjetos(){
  const snap = await get(ref(db, `equipes/${EQUIPE_ID}/config/projetos`));
  const data = snap.val() || {};
  const el = document.getElementById('cfgContent');
  el.innerHTML = `
  <div class="dash-section">
    <div class="dash-section-title"><span>Projetos e Pesos</span>
      <button class="btn-sm success" onclick="cfgAddProjeto()">+ Novo Projeto</button>
    </div>
    <table class="demands-table">
      <thead><tr><th>Nome</th><th>Cor</th><th>R$/hora</th><th>Ações</th></tr></thead>
      <tbody>
        ${Object.entries(data).map(([k,p])=>`<tr>
          <td><input class="filter-select" value="${escH(p.label||k)}" id="pnm_${k}" style="width:140px"></td>
          <td style="vertical-align:middle;">
            <div style="display:inline-flex;align-items:center;gap:6px;">
              <span id="pdot_${k}" style="width:16px;height:16px;border-radius:50%;background:${p.color||'#94A3B8'};border:1px solid var(--border);flex-shrink:0;display:inline-block;"></span>
              <input type="color" value="${p.color||'#94A3B8'}" id="pcl_${k}" oninput="document.getElementById('pdot_${k}').style.background=this.value" style="width:36px;height:26px;padding:2px;border-radius:6px;cursor:pointer;vertical-align:middle;">
            </div>
          </td>
          <td><input type="number" step="0.5" min="0" value="${p.amountPerHour||0}" id="pah_${k}" style="width:70px" class="filter-select"></td>
          <td style="display:flex;gap:6px;">
            <button class="btn-sm" onclick="cfgSaveProjeto('${k}')">${ICONS.save} Salvar</button>
            <button class="btn-sm danger" onclick="cfgDelProjeto('${k}')" aria-label="Remover projeto">${ICONS.trash}</button>
          </td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>`;
}

window.cfgAddProjeto = async function(){
  const nome = prompt('Nome do projeto (ex: Ajustes):');
  if(!nome || !nome.trim()) return;
  const snap = await get(ref(db,`equipes/${EQUIPE_ID}/config/projetos`));
  const existing = snap.val()||{};
  const id = _uniqueId(_slugify(nome), existing);
  if(!id){ showToast('Erro','Não foi possível gerar um identificador a partir desse nome.'); return; }
  await set(ref(db,`equipes/${EQUIPE_ID}/config/projetos/${id}`),{label:nome.trim(),color:'#94A3B8',amountPerHour:0});
  registrarLog('config','Criou projeto', nome.trim());
  _refreshProjectSelects();
  await renderCfgProjetos();
};

window.cfgSaveProjeto = async function(k){
  const label = document.getElementById(`pnm_${k}`)?.value?.trim();
  const color = document.getElementById(`pcl_${k}`)?.value;
  const amountPerHour = parseFloat(document.getElementById(`pah_${k}`)?.value)||0;
  if(!label){ showToast('Erro','Nome não pode ser vazio.'); return; }
  const oldW = Number(state.PROJECTS[k]?.amountPerHour ?? 0);
  await set(ref(db,`equipes/${EQUIPE_ID}/config/projetos/${k}`),{label,color,amountPerHour});
  state.PROJECTS[k]={label,color,amountPerHour};
  _refreshProjectSelects();
  registrarLog('config','Editou projeto', label);
  // Se o PESO mudou e o usuário pode escrever registros (gestora/admin), pergunta o escopo
  if(amountPerHour !== oldW && (state.isManager || state.userPapel === 'admin')){
    _abrirDecisaoPesoProjeto(k, label, oldW, amountPerHour);
  } else {
    showToast('Salvo',`Projeto "${label}" atualizado.`);
  }
};

// Decisão ao mudar o peso: aplicar a TODOS (recalcula histórico ao vivo) ou SÓ FUTUROS
// (congela o peso antigo nos registros existentes daquele projeto via snapshot e.peso).
function _abrirDecisaoPesoProjeto(k, label, oldW, newW){
  let modal = document.getElementById('pesoDecisaoModal');
  if(!modal){
    modal = document.createElement('div');
    modal.id = 'pesoDecisaoModal';
    modal.className = 'modal-overlay';
    modal.setAttribute('role','dialog');
    modal.setAttribute('aria-modal','true');
    document.body.appendChild(modal);
  }
  modal.innerHTML = `
    <div class="modal" style="max-width:480px;">
      <div class="modal-title">Peso do projeto alterado</div>
      <div style="font-size:0.8rem;color:var(--muted);line-height:1.6;margin-bottom:16px;">
        O peso de "<strong>${escH(label)}</strong>" mudou de <strong>${oldW}</strong> para <strong>${newW}</strong>.
        Como aplicar isso aos registros de horas?
      </div>
      <div style="display:flex;flex-direction:column;gap:10px;">
        <button class="btn-sm" onclick="aplicarPesoProjeto('${escH(k)}',${oldW},'futuros')" style="text-align:left;padding:12px;line-height:1.4;">
          <strong>Aplicar só aos FUTUROS</strong><br><span style="font-size:0.7rem;color:var(--muted)">Mantém os registros já existentes no peso anterior (${oldW}). O novo peso vale só daqui pra frente.</span>
        </button>
        <button class="btn-sm" onclick="aplicarPesoProjeto('${escH(k)}',${oldW},'todos')" style="text-align:left;padding:12px;line-height:1.4;">
          <strong>Aplicar a TODOS os registros</strong><br><span style="font-size:0.7rem;color:var(--muted)">Recalcula todo o histórico (passado e futuro) com o novo peso.</span>
        </button>
      </div>
      <div class="modal-actions"><button class="btn-cancel" onclick="closePesoDecisao()">Fechar (mantém "todos")</button></div>
    </div>`;
  modal.classList.add('open');
}
window.closePesoDecisao = ()=>document.getElementById('pesoDecisaoModal')?.classList.remove('open');
window.aplicarPesoProjeto = async (k, oldW, modo)=>{
  const updates = {}; let n = 0;
  Object.entries(state.allEntries||{}).forEach(([id,e])=>{
    if(e.project !== k) return;
    if(modo === 'futuros'){
      if(e.peso === undefined || e.peso === null){ updates[`${id}/peso`] = oldW; n++; }   // congela no peso antigo
    } else {
      if(e.peso !== undefined && e.peso !== null){ updates[`${id}/peso`] = null; n++; }     // libera p/ usar o peso atual
    }
  });
  try{
    if(n) await update(entriesRef, updates);
    registrarLog('config', modo==='futuros'?'Peso do projeto: só futuros (congelou antigos)':'Peso do projeto: aplicou a todos', `${k} · ${n} registro(s)`);
    showToast(modo==='futuros'?'✅ Só futuros':'✅ Aplicado a todos',
      modo==='futuros' ? `${n} registro(s) mantido(s) no peso anterior.` : (n?`${n} registro(s) liberado(s) p/ o novo peso.`:'Histórico recalculado com o novo peso.'));
    closePesoDecisao();
    try{ window.renderDashboard?.(); }catch(e){}
  }catch(e){
    showToast('Erro','Não foi possível atualizar os registros.');
    console.error('[aplicarPesoProjeto]', e);
  }
};

window.cfgDelProjeto = async function(k){
  if(!confirm(`Remover projeto "${k}"? Registros existentes não serão afetados.`)) return;
  await remove(ref(db,`equipes/${EQUIPE_ID}/config/projetos/${k}`));
  delete state.PROJECTS[k];
  _refreshProjectSelects();
  await renderCfgProjetos();
  showToast('Removido',`Projeto "${k}" removido.`);
  registrarLog('config','Removeu projeto', k);
};

// Reconstrói todos os selects de colaborador a partir do state.COLLABS carregado
export function _refreshCollabSelects(){
  const ids = ['mCollab','collabSelect','dashDemandasCollab','filterCollabD',
                'kanbanFilterCollab','arquivoCollabFilter','kanbanFilterAssignee'];
  const collabEntries = Object.entries(state.COLLABS)
    .filter(([,c])=>c.active!==false)
    .sort((a,b)=>(a[1].label||'').localeCompare(b[1].label||'','pt-BR'));

  ids.forEach(id=>{
    const sel = document.getElementById(id);
    if(!sel) return;
    const cur = sel.value;
    // Preserva a primeira option (Todos/placeholder) e substitui o restante
    const first = sel.options[0];
    sel.innerHTML = '';
    if(first) sel.appendChild(first);
    collabEntries.forEach(([k,col])=>{
      const opt = document.createElement('option');
      opt.value = k;
      opt.textContent = col.label;
      sel.appendChild(opt);
    });
    if(cur && sel.querySelector(`option[value="${cur}"]`)) sel.value = cur;
  });
}

// Atualiza os seletores de projeto na interface após mudança de config
export function _refreshProjectSelects(){
  // Timer: combobox próprio (dropdown rolável) — reconstrói a lista e ressincroniza o campo
  if(document.getElementById('projectComboList')){
    window._initProjectCombo?.();
    window._renderProjectCombo?.();
    window._syncProjectSearchFromHidden?.();
  }
  // Modal de edição de registro (mProject) — continua sendo <select> por chave
  const sel = document.getElementById('mProject');
  if(sel){
    const cur = sel.value;
    sel.querySelectorAll('option[data-cfg]').forEach(o=>o.remove());
    Object.entries(state.PROJECTS).forEach(([k,p])=>{
      if(sel.querySelector(`option[value="${k}"]`)) return;
      const opt = document.createElement('option');
      opt.value = k;
      opt.textContent = p.label;
      opt.setAttribute('data-cfg','1');
      sel.appendChild(opt);
    });
    if(cur) sel.value = cur;
  }
}

// ── CFG: METAS ───────────────────────────────────────────────────────────────
async function renderCfgMetas(){
  const snap = await get(ref(db,`equipes/${EQUIPE_ID}/config/metas`));
  const data = snap.val() || { horasDia:9, threshold:90, janelaEdicao:7 };
  const dias = ['seg','ter','qua','qui','sex','sab','dom'];
  const diaLabels = {seg:'Segunda',ter:'Terça',qua:'Quarta',qui:'Quinta',sex:'Sexta',sab:'Sábado',dom:'Domingo'};
  const metasDias = data.metasDias || {};
  const el = document.getElementById('cfgContent');
  el.innerHTML = `
  <div class="dash-section" style="margin-bottom:20px;">
    <div class="dash-section-title" style="margin-bottom:14px;">Meta por Dia da Semana
      <button class="btn-sm" onclick="cfgSyncMetas()" style="margin-left:12px;" title="Replica o valor de Segunda para todos os dias">↺ Sincronizar todos</button>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px;max-width:700px;">
      ${dias.map(d=>`
        <div style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:12px;">
          <div style="font-size:0.75rem;font-weight:700;color:var(--muted);margin-bottom:8px;">${diaLabels[d]}</div>
          <div style="display:flex;align-items:center;gap:6px;">
            <input class="filter-select" type="number" id="cfgMeta_${d}"
              value="${metasDias[d]??data.horasDia??9}" min="0" max="24" step="0.5"
              style="width:70px;">
            <span style="font-size:0.75rem;color:var(--muted);">h</span>
          </div>
        </div>
      `).join('')}
    </div>
  </div>
  <div class="dash-section" style="margin-bottom:20px;">
    <div class="dash-section-title" style="margin-bottom:14px;">Desempenho</div>
    <div style="display:flex;flex-direction:column;gap:14px;max-width:400px;">
      <label class="modal-label">Threshold de desempenho (% para verde)
        <input class="filter-select" type="number" id="cfgThreshold" value="${data.threshold||90}" min="1" max="100" style="width:100px;margin-left:10px;">
      </label>
      <label class="modal-label">Janela de edição retroativa (dias)
        <input class="filter-select" type="number" id="cfgJanela" value="${data.janelaEdicao||7}" min="1" max="30" style="width:100px;margin-left:10px;">
      </label>
    </div>
  </div>
  <button class="btn-sm success" onclick="cfgSaveMetas()" style="width:120px;">${ICONS.save} Salvar tudo</button>`;
}

window.cfgSyncMetas = function(){
  const val = document.getElementById('cfgMeta_seg')?.value;
  if(!val) return;
  ['ter','qua','qui','sex','sab'].forEach(d=>{
    const el = document.getElementById(`cfgMeta_${d}`);
    if(el) el.value = val;
  });
  showToast('Sincronizado','Valor de Segunda replicado para todos os dias.');
};

window.cfgSaveMetas = async function(){
  const dias = ['seg','ter','qua','qui','sex','sab','dom'];
  const metasDias = {};
  dias.forEach(d=>{
    metasDias[d] = parseFloat(document.getElementById(`cfgMeta_${d}`)?.value)||0;
  });
  const threshold    = parseFloat(document.getElementById('cfgThreshold')?.value)||90;
  const janelaEdicao = parseInt(document.getElementById('cfgJanela')?.value)||7;
  // horasDia = média da semana (para compatibilidade com calcDay)
  const horasDia = metasDias['seg']; // usa segunda como referência global
  await set(ref(db,`equipes/${EQUIPE_ID}/config/metas`),{horasDia, metasDias, threshold, janelaEdicao});
  state.DAILY_GOAL_MS    = horasDia * 3600000;
  state.PERF_THRESHOLD   = threshold / 100;
  state.EDIT_WINDOW_DAYS = janelaEdicao;
  showToast('Salvo','Metas atualizadas.');
};

// ── CFG: TAGS ────────────────────────────────────────────────────────────────
// Tags padrão vazias — cada equipe cria as suas próprias em Configurações → Tags
const DEFAULT_TAGS = [];

async function renderCfgTags(){
  const snap = await get(customTagsRef);
  const rawTags = snap.val() || [];
  const customList = Array.isArray(rawTags) ? rawTags : Object.values(rawTags);
  const removedSnap = await get(removedTagsRef);
  const removedDefaults = removedSnap.val() || [];
  const activeDefs = DEFAULT_TAGS.filter(t=>!removedDefaults.includes(t));
  const allTags = [...new Set([...activeDefs, ...customList])];
  const el = document.getElementById('cfgContent');
  el.innerHTML = `
  <div class="dash-section">
    <div class="dash-section-title"><span>Tags da Equipe</span>
      <button class="btn-sm success" onclick="cfgAddTag()">+ Nova Tag</button>
    </div>
    <p style="font-size:0.78rem;color:var(--muted);margin-bottom:12px;">Todas as tags podem ser editadas ou removidas.</p>
    <div id="cfgTagsList">
      ${allTags.length === 0
        ? `<div style="color:var(--muted);font-size:0.82rem;">Nenhuma tag cadastrada.</div>`
        : allTags.map((t,i)=>`
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
            <input class="filter-select" value="${escH(t)}" id="cfgTagVal_${i}" style="width:200px;">
            <button class="btn-sm danger" onclick="cfgDelTagByName(${escH(JSON.stringify(t))})" aria-label="Remover tag">${ICONS.trash}</button>
            <button class="btn-sm" onclick="cfgSaveTagByIndex(${i}, ${escH(JSON.stringify(t))})">&#128190;</button>
          </div>`).join('')}
    </div>
  </div>`;
}


window.cfgAddTag = async function(){
  const name = prompt('Nome da nova tag:');
  if(!name?.trim()) return;
  const snap = await get(customTagsRef);
  const raw = snap.val()||[];
  const list = Array.isArray(raw) ? raw : Object.values(raw);
  const allExisting = [...new Set([...DEFAULT_TAGS,...list])];
  if(allExisting.includes(name.trim())){ showToast('Aviso','Essa tag já existe.'); return; }
  const newList = [...list, name.trim()];
  await set(customTagsRef, newList);
  state.customTags = newList;
  await renderCfgTags();
  showToast('Tag adicionada',`"${name.trim()}" disponível no Timer e Kanban.`);
};

window.cfgSaveTagByIndex = async function(i, oldName){
  const newVal = document.getElementById(`cfgTagVal_${i}`)?.value?.trim();
  if(!newVal) return;
  // Atualiza customTags: se era padrão, adiciona como custom; se era custom, renomeia
  const snap = await get(customTagsRef);
  const raw = snap.val()||[];
  let list = Array.isArray(raw) ? [...raw] : Object.values(raw);
  const isDefault = DEFAULT_TAGS.includes(oldName);
  if(isDefault){
    // Padrão renomeado: adiciona versão renomeada como custom
    if(!list.includes(newVal)) list.push(newVal);
  } else {
    const idx = list.indexOf(oldName);
    if(idx >= 0) list[idx] = newVal; else list.push(newVal);
  }
  await set(customTagsRef, list);
  state.customTags = list;
  showToast('Salvo','Tag atualizada.');
  await renderCfgTags();
};

window.cfgDelTagByName = async function(tagName){
  if(!confirm(`Remover tag "${tagName}"?`)) return;
  const snap = await get(customTagsRef);
  const raw = snap.val()||[];
  let list = Array.isArray(raw) ? [...raw] : Object.values(raw);
  const isDefault = DEFAULT_TAGS.includes(tagName);
  if(isDefault){
    // Tag padrão: salvar lista de padrões removidos para suprimir no UI
    const removedSnap = await get(removedTagsRef);
    const removed = removedSnap.val()||[];
    if(!removed.includes(tagName)) await set(removedTagsRef,[...removed,tagName]);
  } else {
    list = list.filter(t=>t!==tagName);
    await set(customTagsRef, list);
    state.customTags = list;
  }
  await renderCfgTags();
  showToast('Removida','Tag removida.');
};

// ── CFG: COLUNAS KANBAN ──────────────────────────────────────────────────────
async function renderCfgColunas(){
  const snap = await get(ref(db,`equipes/${EQUIPE_ID}/config/colunas`));
  const data = snap.val() || {};
  const sorted = Object.entries(data).sort((a,b)=>(a[1].ordem||0)-(b[1].ordem||0));
  const colIds = sorted.map(([k])=>k);
  // Suporta painel do Kanban E aba de Configurações
  const el = document.getElementById('kanbanColsPanelContent') || document.getElementById('cfgContent');

  const _botaoRow = (colId, b, idx) => {
    const destOpts = colIds.filter(id=>id!==colId).map(id=>`<option value="${id}" ${b.destino===id?'selected':''}>${escH(data[id]?.label||id)}</option>`).join('');
    if(b.tipo==='timer') return `
      <div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--surface2);border-radius:8px;margin-bottom:4px;">
        <span style="font-size:0.72rem;font-weight:700;color:var(--orange)">▶ Timer</span>
        <span style="font-size:0.68rem;color:var(--muted);flex:1">Inicia timer do Kanban para este card</span>
        <button class="btn-sm danger" style="padding:2px 7px;" onclick="cfgRemoveBotao('${colId}',${idx})">✕</button>
      </div>`;
    if(b.tipo==='mover') return `
      <div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--surface2);border-radius:8px;margin-bottom:4px;flex-wrap:wrap;">
        <span style="font-size:0.72rem;font-weight:700;min-width:40px;">⇒ Mover</span>
        <input class="filter-select" value="${escH(b.label||'')}" placeholder="Label do botão" id="blbl_${colId}_${idx}" style="width:160px;height:28px;">
        <select class="filter-select" id="bdst_${colId}_${idx}" style="height:28px;">${destOpts}</select>
        <button class="btn-sm" style="padding:2px 10px;" onclick="cfgSaveBotao('${colId}',${idx},'mover')">✓</button>
        <button class="btn-sm danger" style="padding:2px 7px;" onclick="cfgRemoveBotao('${colId}',${idx})">✕</button>
      </div>`;
    if(b.tipo==='concluir') return `
      <div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--surface2);border-radius:8px;margin-bottom:4px;">
        <span style="font-size:0.72rem;font-weight:700;color:var(--success)">✓ Concluir</span>
        <input class="filter-select" value="${escH(b.label||'Concluir')}" placeholder="Label" id="blbl_${colId}_${idx}" style="width:140px;height:28px;">
        <button class="btn-sm" style="padding:2px 10px;" onclick="cfgSaveBotao('${colId}',${idx},'concluir')">✓</button>
        <button class="btn-sm danger" style="padding:2px 7px;" onclick="cfgRemoveBotao('${colId}',${idx})">✕</button>
      </div>`;
    return '';
  };

  el.innerHTML = `
  <div class="dash-section">
    <div class="dash-section-title"><span>Colunas do Kanban</span>
      <button class="btn-sm success" onclick="cfgAddColuna()">+ Nova Coluna</button>
    </div>
    ${sorted.map(([k,c],i)=>`
    <div style="background:var(--surface);border:1.5px solid var(--border);border-radius:var(--radius);padding:16px;margin-bottom:12px;">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
        <div style="display:flex;gap:4px;">
          ${i>0?`<button class="btn-sm" onclick="cfgMoveColuna('${k}',-1,false)" style="padding:2px 8px;">↑</button>`:''}
          ${i<sorted.length-1?`<button class="btn-sm" onclick="cfgMoveColuna('${k}',1,false)" style="padding:2px 8px;">↓</button>`:''}
        </div>
        <input class="filter-select" value="${escH(c.label||k)}" id="cnm_${k}" style="flex:1;min-width:120px;">
        <div style="display:inline-flex;align-items:center;gap:6px;">
          <span id="cdot_${k}" style="width:16px;height:16px;border-radius:50%;background:${c.color||'#94A3B8'};border:1px solid var(--border);flex-shrink:0;"></span>
          <input type="color" value="${c.color||'#94A3B8'}" id="ccl_${k}" oninput="document.getElementById('cdot_${k}').style.background=this.value" style="width:36px;height:28px;padding:2px;border-radius:6px;cursor:pointer;">
        </div>
        <button class="btn-sm success" onclick="cfgSaveColuna('${k}',${c.ordem||i})">${ICONS.save} Salvar</button>
        <button class="btn-sm danger" onclick="cfgDelColuna('${k}')">${ICONS.trash}</button>
      </div>
      <div style="border-top:1px solid var(--border);padding-top:10px;">
        <div style="font-size:0.7rem;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px;">Botões do card</div>
        <div id="botoes_${k}">
          ${(Array.isArray(c.botoes)?c.botoes:[]).map((b,idx)=>_botaoRow(k,b,idx)).join('')}
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;">
          <button class="btn-sm" onclick="cfgAddBotao('${k}','timer')" style="font-size:0.72rem;">▶ + Timer</button>
          <button class="btn-sm" onclick="cfgAddBotao('${k}','mover')" style="font-size:0.72rem;">⇒ + Mover para...</button>
          <button class="btn-sm" onclick="cfgAddBotao('${k}','concluir')" style="font-size:0.72rem;">✓ + Concluir</button>
        </div>
      </div>
    </div>`).join('')}
  </div>`;
}

// ── Funções de edição de botões ────────────────────────────────────────────────
// Atualiza state.K_COLS localmente + re-renderiza o board (config não tem listener live).
// `botoes` pode ser um array OU a string 'none' (marcador de "sem botões"): o Firebase
// descarta arrays vazios, então sem o marcador o kGetColBotoes voltaria aos botões padrão.
function _syncKColBotoes(colId, botoes){
  const col = (state.K_COLS||[]).find(c=>c.id===colId);
  if(col) col.botoes = botoes;
  window.renderKanban?.();
}
window.cfgAddBotao = async(colId, tipo)=>{
  const snap = await get(ref(db,`equipes/${EQUIPE_ID}/config/colunas/${colId}`));
  const col = snap.val()||{};
  const botoes = Array.isArray(col.botoes) ? col.botoes : [];   // 'none'/ausente → []
  // Impede duplicata de timer/concluir
  if((tipo==='timer'||tipo==='concluir') && botoes.some(b=>b.tipo===tipo)){
    showToast('Já existe', `Botão "${tipo}" já adicionado nesta coluna.`); return;
  }
  const novo = tipo==='mover' ? {tipo:'mover',label:'',destino:''} : {tipo};
  botoes.push(novo);
  await set(ref(db,`equipes/${EQUIPE_ID}/config/colunas/${colId}/botoes`), botoes);
  _syncKColBotoes(colId, botoes);
  showToast('Botão adicionado','Configure o destino e salve.');
  renderCfgColunas();
};

window.cfgRemoveBotao = async(colId, idx)=>{
  const snap = await get(ref(db,`equipes/${EQUIPE_ID}/config/colunas/${colId}`));
  const col = snap.val()||{};
  const botoes = Array.isArray(col.botoes) ? col.botoes : [];
  botoes.splice(idx,1);
  // Lista vazia vira marcador 'none' (Firebase descarta [] → voltaria aos botões padrão)
  const toSave = botoes.length ? botoes : 'none';
  await set(ref(db,`equipes/${EQUIPE_ID}/config/colunas/${colId}/botoes`), toSave);
  _syncKColBotoes(colId, toSave);
  renderCfgColunas();
};

window.cfgSaveBotao = async(colId, idx, tipo)=>{
  const snap = await get(ref(db,`equipes/${EQUIPE_ID}/config/colunas/${colId}`));
  const col = snap.val()||{};
  const botoes = Array.isArray(col.botoes) ? col.botoes : [];
  const label = document.getElementById(`blbl_${colId}_${idx}`)?.value?.trim()||'';
  if(tipo==='mover'){
    const destino = document.getElementById(`bdst_${colId}_${idx}`)?.value||'';
    if(!destino){ showToast('Atenção','Selecione a coluna de destino.'); return; }
    botoes[idx] = {tipo:'mover', label, destino};
  } else if(tipo==='concluir'){
    botoes[idx] = {tipo:'concluir', label:label||'Concluir'};
  }
  await set(ref(db,`equipes/${EQUIPE_ID}/config/colunas/${colId}/botoes`), botoes);
  _syncKColBotoes(colId, botoes);
  showToast('Salvo','Botão atualizado.');
  renderCfgColunas();
};

async function _reloadKCols(){
  const snap = await get(ref(db,`equipes/${EQUIPE_ID}/config/colunas`));
  const data = snap.val()||{};
  state.K_COLS = Object.entries(data)
    .sort((a,b)=>(a[1].ordem||0)-(b[1].ordem||0))
    .map(([id,c])=>({id,label:c.label||id,color:c.color||'#94A3B8', botoes:c.botoes||null, project:c.project||null}));
  if(document.getElementById('page-kanban')?.classList.contains('active')) window.renderKanban?.();
}

window.cfgAddColuna = async function(fromModal=false){
  const nome = prompt('Nome da coluna (ex: Revisão Final):');
  if(!nome || !nome.trim()) return;
  const snap = await get(ref(db,`equipes/${EQUIPE_ID}/config/colunas`));
  const existing = snap.val()||{};
  const id = _uniqueId(_slugify(nome), existing);
  if(!id){ showToast('Erro','Não foi possível gerar um identificador a partir desse nome.'); return; }
  const ordem = Object.keys(existing).length;
  await set(ref(db,`equipes/${EQUIPE_ID}/config/colunas/${id}`),{label:nome.trim(),color:'#94A3B8',ordem});
  registrarLog('config','Criou coluna do Kanban', nome.trim());
  await _reloadKCols();
  await renderCfgColunas();
};

window.cfgSaveColuna = async function(k, ordem, fromModal=false){
  const label = document.getElementById(`cnm_${k}`)?.value?.trim();
  const color = document.getElementById(`ccl_${k}`)?.value;
  if(!label) return;
  // Preserva botoes existentes ao salvar
  const snap = await get(ref(db,`equipes/${EQUIPE_ID}/config/colunas/${k}/botoes`));
  const botoes = snap.val() || null;
  const data = {label, color, ordem};
  if(botoes) data.botoes = botoes;
  await set(ref(db,`equipes/${EQUIPE_ID}/config/colunas/${k}`), data);
  await _reloadKCols();
  registrarLog('config','Editou coluna do Kanban', label);
  showToast('Salvo',`Coluna "${label}" atualizada.`);
  await renderCfgColunas();
};

window.cfgMoveColuna = async function(k, dir, fromModal=false){
  const snap = await get(ref(db,`equipes/${EQUIPE_ID}/config/colunas`));
  const data = snap.val()||{};
  const sorted = Object.entries(data).sort((a,b)=>(a[1].ordem||0)-(b[1].ordem||0));
  const idx = sorted.findIndex(([id])=>id===k);
  const swapIdx = idx+dir;
  if(idx<0 || swapIdx<0 || swapIdx>=sorted.length) return;
  // Bug: trocar só os dois 'ordem' falhava quando havia ordens DUPLICADAS (gravava o
  // mesmo valor nas duas colunas → nada mudava). Agora trocamos a posição no array e
  // RENUMERAMOS todas as colunas sequencialmente — robusto contra ordens repetidas/ausentes.
  [sorted[idx], sorted[swapIdx]] = [sorted[swapIdx], sorted[idx]];
  const updates = {};
  sorted.forEach(([id],i)=>{ updates[`${id}/ordem`] = i; });
  await update(ref(db,`equipes/${EQUIPE_ID}/config/colunas`), updates);
  await _reloadKCols();
  await renderCfgColunas();
};

window.cfgDelColuna = async function(k, fromModal=false){
  if(!confirm(`Remover coluna "${k}"? Cards existentes precisarão ser movidos.`)) return;
  await remove(ref(db,`equipes/${EQUIPE_ID}/config/colunas/${k}`));
  registrarLog('config','Removeu coluna do Kanban', k);
  await _reloadKCols();
  await renderCfgColunas();
};

// ── MODAL: GERENCIAR COLUNAS DO ARQUIVO MORTO ─────────────────────────────────
// ── ARQUIVO MORTO: Configuração de colunas ───────────────────────────────────
const MONTHS_PT = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

// Auto-detecta painel do Arquivo ou tab de Configurações
function _getArquivoColsEl(){
  return document.getElementById('arquivoColsPanelContent') || document.getElementById('arquivoColsContent') || document.getElementById('cfgContent');
}

// Garante que colunas_arquivo existe no Firebase com valores padrão
async function _ensureArquivoCols(){
  const snap = await get(ref(db,`equipes/${EQUIPE_ID}/config/colunas_arquivo`));
  if(!snap.val()){
    const defaultCols = {
      TRELLO:{label:'Importados do Trello',color:'#0052CC',ordem:0,months:null},
      MOD1:{label:'MOD 1 — Jan/Fev/Mar',color:'#7C6AFF',ordem:1,months:[0,1,2]},
      MOD2:{label:'MOD 2 — Abr/Mai/Jun',color:'#10B981',ordem:2,months:[3,4,5]},
      MOD3:{label:'MOD 3 — Jul/Ago/Set',color:'#F59E0B',ordem:3,months:[6,7,8]},
      MOD4:{label:'MOD 4 — Out/Nov/Dez',color:'#EF4444',ordem:4,months:[9,10,11]},
    };
    await set(ref(db,`equipes/${EQUIPE_ID}/config/colunas_arquivo`), defaultCols);
    state.MODS = Object.entries(defaultCols).sort((a,b)=>a[1].ordem-b[1].ordem).map(([id,m])=>({id,...m}));
  }
}

// Re-sincroniza state.MODS a partir do Firebase e atualiza o board + filtro do Arquivo Morto.
// Sem isso, criar/editar/remover/mover coluna só aparecia após recarregar a página (não havia
// listener live em colunas_arquivo — ele é lido 1x na inicialização).
async function _syncMODSFromFirebase(){
  const snap = await get(ref(db,`equipes/${EQUIPE_ID}/config/colunas_arquivo`));
  const data = snap.val()||{};
  state.MODS = Object.entries(data)
    .sort((a,b)=>(a[1].ordem||0)-(b[1].ordem||0))
    .map(([id,m])=>({ id, label:m.label||id, color:m.color||'#94A3B8', months:m.months||null }));
  // Repopula o filtro de módulos (preserva a 1ª opção "Todos"); o combobox re-sincroniza via MutationObserver
  const sel = document.getElementById('arquivoModFilter');
  if(sel){
    const cur = sel.value; const first = sel.options[0];
    sel.innerHTML=''; if(first) sel.appendChild(first);
    state.MODS.forEach(m=>{ const o=document.createElement('option'); o.value=m.id; o.textContent=m.label; sel.appendChild(o); });
    if(cur && sel.querySelector(`option[value="${cur}"]`)) sel.value=cur;
  }
  window.renderArquivo?.();
}

// F8: alterna o estado "mostrar cards antigos" (controle movido p/ dentro da config)
window._toggleArquivoShowOld = (btn)=>{
  const b = document.getElementById('arquivoShowOld'); if(!b) return;
  b.dataset.show = b.dataset.show === '1' ? '0' : '1';
  if(btn) btn.textContent = b.dataset.show === '1'
    ? '🗃 Ocultar cards antigos (+60 dias)'
    : '🗃 Mostrar cards antigos (+60 dias)';
  window.renderArquivo?.();
};

// Painel lateral a partir do Arquivo Morto
window.openArquivoColsModal = async function(){
  let panel = document.getElementById('arquivoColsPanel');
  if(!panel){
    panel = document.createElement('div');
    panel.id = 'arquivoColsPanel';
    panel.style.cssText = 'position:fixed;top:0;right:0;width:min(680px,95vw);height:100vh;background:var(--surface);border-left:1.5px solid var(--border);box-shadow:-4px 0 24px rgba(0,0,0,0.12);z-index:700;display:flex;flex-direction:column;transition:transform 0.25s ease;transform:translateX(100%);';
    panel.setAttribute('role','dialog');
    panel.setAttribute('aria-modal','true');
    panel.setAttribute('aria-label','Configurar Colunas do Arquivo Morto');
    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:18px 22px;border-bottom:1px solid var(--border);flex-shrink:0;">
        <div style="font-size:0.95rem;font-weight:800;">⚙ Configurar Colunas do Arquivo Morto</div>
        <button onclick="window.closeArquivoColsPanel()" style="background:none;border:none;cursor:pointer;color:var(--muted);display:flex;align-items:center;padding:4px;" aria-label="Fechar">${ICONS.x}</button>
      </div>
      <div style="flex:1;overflow-y:auto;padding:16px 22px;" id="arquivoColsPanelContent"></div>`;
    const overlay = document.createElement('div');
    overlay.id = 'arquivoColsPanelOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.18);z-index:699;display:none;';
    overlay.onclick = ()=>window.closeArquivoColsPanel();
    document.body.appendChild(overlay);
    document.body.appendChild(panel);
  }
  document.getElementById('arquivoColsPanelOverlay').style.display = 'block';
  setTimeout(()=>{ panel.style.transform='translateX(0)'; window.trapFocus?.(panel); },10);
  await _ensureArquivoCols();
  await _renderArquivoColsInModal();
};

window.closeArquivoColsPanel = ()=>{ window.releaseFocus?.();
  const panel = document.getElementById('arquivoColsPanel');
  const overlay = document.getElementById('arquivoColsPanelOverlay');
  if(panel) panel.style.transform='translateX(100%)';
  if(overlay) overlay.style.display='none';
  setTimeout(()=>window.renderArquivo?.(), 300);
};

// Renderiza o editor completo de colunas do Arquivo
async function _renderArquivoColsInModal(){
  const [snapCols, snapCfg, snapKCols] = await Promise.all([
    get(ref(db,`equipes/${EQUIPE_ID}/config/colunas_arquivo`)),
    get(ref(db,`equipes/${EQUIPE_ID}/config/arquivo_config`)),
    get(ref(db,`equipes/${EQUIPE_ID}/config/colunas`)),
  ]);
  const data   = snapCols.val() || {};
  const cfg    = snapCfg.val()  || {};
  const kCols  = snapKCols.val() || {};
  const sorted = Object.entries(data).sort((a,b)=>(a[1].ordem||0)-(b[1].ordem||0));
  const kColsSorted = Object.entries(kCols).sort((a,b)=>(a[1].ordem||0)-(b[1].ordem||0));
  const el = _getArquivoColsEl();
  if(!el) return;

  // ── Seção de regras de arquivamento automático ─────────────────────────────
  const diasVal    = cfg.diasParaArquivar || 15;
  const colKanban  = cfg.colunaKanban     || 'concluido';
  const colDestino = cfg.colunaDestino    || 'auto';

  el.innerHTML = `
  <div style="background:var(--orange-light);border:1.5px solid var(--orange-border);border-radius:var(--radius);padding:16px 18px;margin-bottom:20px;">
    <div style="font-size:0.82rem;font-weight:800;color:var(--orange);margin-bottom:12px;">⏱ Regras de Arquivamento Automático</div>
    <div style="display:flex;flex-wrap:wrap;gap:14px;align-items:flex-end;">
      <label class="modal-label" style="flex:0 0 auto;">
        Dias no Kanban até arquivar
        <div style="display:flex;align-items:center;gap:8px;margin-top:4px;">
          <input type="number" min="1" max="365" value="${diasVal}" id="arqDias"
            class="filter-select" style="width:80px;height:34px;" aria-label="Número de dias até arquivamento">
          <span style="font-size:0.75rem;color:var(--muted);">dias após mover para:</span>
        </div>
      </label>
      <label class="modal-label" style="flex:1;min-width:160px;">
        Coluna do Kanban monitorada
        <select id="arqColKanban" class="filter-select" style="width:100%;margin-top:4px;" aria-label="Coluna do Kanban monitorada para arquivamento">
          ${kColsSorted.map(([id,c])=>`<option value="${id}" ${id===colKanban?'selected':''}>${escH(c.label||id)}</option>`).join('')}
        </select>
      </label>
      <label class="modal-label" style="flex:1;min-width:160px;">
        Coluna destino no Arquivo
        <select id="arqColDestino" class="filter-select" style="width:100%;margin-top:4px;" aria-label="Coluna destino no Arquivo Morto">
          <option value="auto" ${colDestino==='auto'?'selected':''}>Automático (por mês de criação)</option>
          ${sorted.map(([id,c])=>`<option value="${id}" ${id===colDestino?'selected':''}>${escH(c.label||id)}</option>`).join('')}
        </select>
      </label>
      <button class="btn-sm success" onclick="cfgSaveArquivoConfig()" style="height:34px;white-space:nowrap;">💾 Salvar regras</button>
    </div>
    <div style="font-size:0.7rem;color:var(--muted);margin-top:8px;">
      Cards permanecerão na coluna do Kanban monitorada por <strong id="arqDiasPreview">${diasVal}</strong> dias antes de irem automaticamente para o Arquivo.
    </div>
  </div>
  <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:16px;">
    <button class="btn-sm success" onclick="cfgAddArquivoCol()">+ Nova Coluna</button>
    <button class="btn-sm" onclick="window._toggleArquivoShowOld(this)">${(document.getElementById('arquivoShowOld')?.dataset.show==='1')?'🗃 Ocultar cards antigos (+60 dias)':'🗃 Mostrar cards antigos (+60 dias)'}</button>
  </div>
  `;

  const _monthsCheckboxes = (k, months) => {
    return MONTHS_PT.map((m,i)=>`
      <span style="display:inline-flex;align-items:center;gap:3px;white-space:nowrap;">
        <input type="checkbox" id="acm_${k}_${i}" ${months&&months.includes(i)?'checked':''} aria-label="${m}">
        <label for="acm_${k}_${i}" style="font-size:0.72rem;cursor:pointer;">${m}</label>
      </span>`).join('');
  };

  el.insertAdjacentHTML('beforeend', `
    ${sorted.map(([k,c],i)=>`
    <div style="background:var(--surface);border:1.5px solid var(--border);border-radius:var(--radius);padding:14px 16px;margin-bottom:10px;">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
        <div style="display:flex;gap:4px;">
          ${i>0?`<button class="btn-sm" onclick="cfgMoveArquivoCol('${k}',-1)" style="padding:2px 8px;">↑</button>`:''}
          ${i<sorted.length-1?`<button class="btn-sm" onclick="cfgMoveArquivoCol('${k}',1)" style="padding:2px 8px;">↓</button>`:''}
        </div>
        <input class="filter-select" value="${escH(c.label||k)}" id="acnm_${k}" style="flex:1;min-width:140px;">
        <div style="display:inline-flex;align-items:center;gap:6px;">
          <span id="acdot_${k}" style="width:16px;height:16px;border-radius:50%;background:${c.color||'#94A3B8'};border:1px solid var(--border);flex-shrink:0;"></span>
          <input type="color" value="${c.color||'#94A3B8'}" id="accl_${k}" oninput="document.getElementById('acdot_${k}').style.background=this.value" style="width:36px;height:28px;padding:2px;border-radius:6px;cursor:pointer;">
        </div>
        <button class="btn-sm success" onclick="cfgSaveArquivoCol('${k}',${c.ordem||i})">${ICONS.save} Salvar</button>
        <button class="btn-sm danger" onclick="cfgDelArquivoCol('${k}')">${ICONS.trash}</button>
      </div>
      <div style="border-top:1px solid var(--border);padding-top:10px;">
        <div style="font-size:0.68rem;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px;">
          Meses incluídos nesta coluna ${c.months===null?'<span style="color:var(--orange);font-size:0.65rem;">(Coluna especial — sem filtro por mês)</span>':''}
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;">
          ${_monthsCheckboxes(k, c.months)}
          <label style="display:inline-flex;align-items:center;gap:3px;font-size:0.72rem;cursor:pointer;color:var(--muted);">
            <input type="checkbox" id="acm_${k}_special" ${c.months===null?'checked':''} onchange="
              const special=this.checked;
              document.querySelectorAll('[id^=acm_${k}_]:not([id$=_special])').forEach(cb=>{ cb.disabled=special; if(special) cb.checked=false; });
            "> Especial (sem meses)
          </label>
        </div>
      </div>
    </div>`).join('')}`);

  // Desabilita checkboxes de meses para colunas especiais
  sorted.forEach(([k,c])=>{
    if(c.months===null){
      document.querySelectorAll(`[id^=acm_${k}_]:not([id$=_special])`).forEach(cb=>{cb.disabled=true;});
    }
  });
}

window.cfgSaveArquivoConfig = async function(){
  const dias         = parseInt(document.getElementById('arqDias')?.value)||15;
  const colunaKanban = document.getElementById('arqColKanban')?.value||'concluido';
  const colunaDestino= document.getElementById('arqColDestino')?.value||'auto';
  await set(ref(db,`equipes/${EQUIPE_ID}/config/arquivo_config`),{diasParaArquivar:dias,colunaKanban,colunaDestino});
  // Atualiza state imediatamente sem exigir reload de página
  if(!state._arquivoConfig) state._arquivoConfig = {};
  state._arquivoConfig = {diasParaArquivar:dias, colunaKanban, colunaDestino};
  showToast('✅ Regras salvas',`Cards vão para o Arquivo após ${dias} dias em "${colunaKanban}".`);
  await _renderArquivoColsInModal();
};

window.cfgAddArquivoCol = async function(){
  const nome = prompt('Nome da coluna (ex: MOD 5 ou Especiais):');
  if(!nome || !nome.trim()) return;
  const snap = await get(ref(db,`equipes/${EQUIPE_ID}/config/colunas_arquivo`));
  const existing = snap.val()||{};
  const id = _uniqueId(_slugify(nome), existing);
  if(!id){ showToast('Erro','Não foi possível gerar um identificador a partir desse nome.'); return; }
  const ordem = Object.keys(existing).length;
  await set(ref(db,`equipes/${EQUIPE_ID}/config/colunas_arquivo/${id}`),{label:nome.trim(),color:'#94A3B8',ordem,months:null});
  await _syncMODSFromFirebase();        // ✅ aparece no board sem precisar recarregar
  await _renderArquivoColsInModal();
  showToast('Coluna criada',`"${nome.trim()}" adicionada ao Arquivo Morto.`);
  registrarLog('config','Criou coluna do Arquivo Morto', nome.trim());
};

window.cfgSaveArquivoCol = async function(k, ordem){
  const label = document.getElementById(`acnm_${k}`)?.value?.trim();
  const color = document.getElementById(`accl_${k}`)?.value;
  if(!label){ showToast('Erro','Nome não pode ser vazio.'); return; }
  const isSpecial = document.getElementById(`acm_${k}_special`)?.checked;
  let months = null;
  if(!isSpecial){
    months = [];
    MONTHS_PT.forEach((_,i)=>{ if(document.getElementById(`acm_${k}_${i}`)?.checked) months.push(i); });
    if(!months.length) months = null; // se nenhum mês marcado, trata como especial
  }
  await set(ref(db,`equipes/${EQUIPE_ID}/config/colunas_arquivo/${k}`),{label,color,ordem,months});
  await _syncMODSFromFirebase();        // re-sincroniza board + filtro
  showToast('Salvo',`Coluna "${label}" atualizada.`);
  await _renderArquivoColsInModal();
};

window.cfgMoveArquivoCol = async function(k, dir){
  const snap = await get(ref(db,`equipes/${EQUIPE_ID}/config/colunas_arquivo`));
  const data = snap.val()||{};
  const sorted = Object.entries(data).sort((a,b)=>(a[1].ordem||0)-(b[1].ordem||0));
  const idx = sorted.findIndex(([id])=>id===k);
  const swapIdx = idx+dir;
  if(idx<0 || swapIdx<0 || swapIdx>=sorted.length) return;
  // Mesmo fix de cfgMoveColuna: troca posição e renumera todas (robusto contra ordens duplicadas)
  [sorted[idx], sorted[swapIdx]] = [sorted[swapIdx], sorted[idx]];
  const updates = {};
  sorted.forEach(([id],i)=>{ updates[`${id}/ordem`] = i; });
  await update(ref(db,`equipes/${EQUIPE_ID}/config/colunas_arquivo`), updates);
  await _syncMODSFromFirebase();        // reordena no board sem recarregar
  await _renderArquivoColsInModal();
};

window.cfgDelArquivoCol = async function(k){
  if(!confirm(`Remover coluna "${k}"? Os cards arquivados nela não serão apagados.`)) return;
  await remove(ref(db,`equipes/${EQUIPE_ID}/config/colunas_arquivo/${k}`));
  await _syncMODSFromFirebase();        // some do board sem recarregar
  showToast('Removido',`Coluna "${k}" removida.`);
  registrarLog('config','Removeu coluna do Arquivo Morto', k);
  await _renderArquivoColsInModal();
};

// Registra para uso externo (Arquivo Morto + Configurações)
window.renderCfgArquivoCols = async function(){
  await _ensureArquivoCols();
  await _renderArquivoColsInModal();
};
window.renderCfgArquivoCols = window.renderCfgArquivoCols;


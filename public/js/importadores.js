// ── KRONOS · IMPORTADORES ───────────────────────────────────────────────────
// Importadores: CSV genérico, Trello → Kanban, Avaliações históricas

import { app as state } from './state.js';
import { ICONS }        from './icons.js';
import {
  escH, fmtDur, fmtTime, fmtDate, dKey, dateKey, todayKey
} from './utils.js';
import {
  db, kanbanRef, entriesRef, notifsRef, EQUIPE_ID
} from './firebase-refs.js';
import {
  ref, push, set, update, get, remove, child, onValue
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';
import {
  calcAmount, getEntriesArray, getEntriesForDay
} from './dashboard.js';
import { showToast, setSyncStatus } from './ui.js';

// ── A5: RESOLVEDORES DINÂMICOS POR EQUIPE ────────────────────────────────────
// Os importadores resolvem colaborador, projeto e colunas a partir da config da
// equipe ativa (state.COLLABS / COLLAB_EMAILS / PROJECTS / K_COLS), em vez de
// mapas fixos da Diagramação. O que não casar é ignorado (sem default errado).
function _normTxt(s){ return String(s||'').toLowerCase().trim(); }

function _resolveCollabKey(raw){
  const s = _normTxt(raw);
  if(!s) return null;
  for(const [key,c] of Object.entries(state.COLLABS||{})){
    if(_normTxt(key)===s || _normTxt(c.label)===s) return key;
  }
  for(const [email,key] of Object.entries(state.COLLAB_EMAILS||{})){
    if(_normTxt(email)===s || _normTxt(email.split('@')[0])===s) return key;
  }
  for(const [key,c] of Object.entries(state.COLLABS||{})){
    const first = _normTxt((c.label||key).split(' ')[0]);
    if(first && (s.includes(first) || first.includes(s))) return key;
  }
  return null;
}

function _resolveProjectKey(raw){
  const s = _normTxt(raw);
  if(!s) return null;
  for(const [key,p] of Object.entries(state.PROJECTS||{})){
    if(_normTxt(key)===s || _normTxt(p.label)===s) return key;
  }
  for(const [key,p] of Object.entries(state.PROJECTS||{})){
    if(_normTxt(p.label).includes(s) || s.includes(_normTxt(key))) return key;
  }
  return null;
}

function _kronosCollabOpts(){
  return [{key:'',label:'— Não atribuir —'}].concat(
    Object.entries(state.COLLABS||{})
      .filter(([,c])=>c.active!==false)
      .map(([k,c])=>({key:k,label:c.label||k}))
  );
}

function _kColsTrello(){
  return (state.K_COLS||[]).map(c=>({id:c.id,label:c.label||c.id}));
}

// ── IMPORT CSV ────────────────────────────────────────────────────────────────
// Lê o arquivo detectando o encoding: tenta UTF-8 e cai p/ Latin-1 (ISO-8859-1),
// comum em exports brasileiros do Clockify — evita acentos corrompidos (Ã§/Ã£).
async function _readFileSmart(file){
  const buf = await file.arrayBuffer();
  try { return new TextDecoder('utf-8',{fatal:true}).decode(buf); }
  catch { return new TextDecoder('iso-8859-1').decode(buf); }
}
// Parser de linha CSV respeitando aspas, com delimitador configurável (',' ou ';').
function _splitCSV(line, delim){
  const out=[]; let cur=''; let inQ=false;
  for(let i=0;i<line.length;i++){
    const ch=line[i];
    if(ch==='"'){ if(inQ && line[i+1]==='"'){ cur+='"'; i++; } else inQ=!inQ; }
    else if(ch===delim && !inQ){ out.push(cur); cur=''; }
    else cur+=ch;
  }
  out.push(cur);
  return out.map(v=>v.trim());
}
// Duração "HH:MM" ou "HH:MM:SS" (formato Clockify) → ms.
function _parseDurClockify(s){
  const p=String(s||'').trim().split(':').map(n=>parseInt(n,10));
  if(!p.length || p.some(isNaN)) return 0;
  let h=0,m=0,sec=0;
  if(p.length>=3){ h=p[0]; m=p[1]; sec=p[2]; }
  else if(p.length===2){ h=p[0]; m=p[1]; }
  else { m=p[0]; }
  return ((h*3600)+(m*60)+sec)*1000;
}
// Data "DD/MM/AAAA" (ou "AAAA-MM-DD") → timestamp às 08:00; null se inválida.
function _parseDateBR(s){
  const t=String(s||'').trim();
  if(!t) return null;
  let dd,mm,yyyy;
  if(t.includes('/')){ [dd,mm,yyyy]=t.split('/').map(Number); }
  else { [yyyy,mm,dd]=t.split('-').map(Number); }
  if(!(mm>=1&&mm<=12&&dd>=1&&dd<=31&&yyyy>=2000)) return null;
  return new Date(yyyy,mm-1,dd,8,0,0).getTime();
}

window.handleCSVImport = async(event)=>{
  const file=event.target.files[0];if(!file)return;
  const results=document.getElementById('importResults');
  if(results) results.innerHTML='<div style="color:var(--orange)">Importando...</div>';
  const text=await _readFileSmart(file);
  const lines=text.split(/\r?\n/).filter(l=>l.trim());
  if(!lines.length){ if(results) results.textContent='Arquivo vazio.'; return; }

  // Detecta o delimitador pela 1ª linha (Clockify-BR usa ';')
  const delim = (lines[0].split(';').length > lines[0].split(',').length) ? ';' : ',';
  const headers = _splitCSV(lines[0], delim).map(h=>h.toLowerCase());

  // Clockify-BR (relatório de RESUMO): colaborador;…;tipo;;descricao;duracao;…
  const isClockifyBR = headers.includes('colaborador') && headers.includes('descricao') && headers.includes('duracao');

  let imported=0, skipped=0, unmatched=0;

  if(isClockifyBR){
    const iColab=headers.indexOf('colaborador'), iDesc=headers.indexOf('descricao'),
          iDur=headers.indexOf('duracao'), iTipo=headers.indexOf('tipo'),
          iIni=headers.indexOf('periodo_inicio');
    // O resumo não tem data por registro — empilha sequencialmente a partir do início do período.
    let cursor=null;
    for(let i=1;i<lines.length;i++){
      const vals=_splitCSV(lines[i], delim);
      const tipo=(vals[iTipo]||'').toLowerCase();
      // Só as linhas "Resumo Descrição" (1 por demanda) — evita duplicar com "Detalhamento Descrição"
      if(!/resumo\s+descri/.test(tipo)) continue;
      const task=(vals[iDesc]||'').trim().slice(0,200);
      if(!task) continue;
      const dur=_parseDurClockify(vals[iDur]);
      if(dur<=0){ skipped++; continue; }
      const collabKey=_resolveCollabKey(vals[iColab]||'');
      if(!collabKey){ unmatched++; continue; }
      if(cursor===null) cursor=_parseDateBR(vals[iIni]) || Date.now();
      const sTs=cursor, eTs=cursor+dur; cursor=eTs;
      try{
        await push(entriesRef,{task,project:'',collab:collabKey,obs:'Importado do Clockify',tags:[],startTime:sTs,endTime:eTs,duration:dur,createdAt:Date.now()});
        imported++;
      }catch(e){ skipped++; }
    }
  } else {
    // Formato genérico (Clockify detalhado em inglês): user/project/date/start/end
    for(let i=1;i<lines.length;i++){
      const vals=_splitCSV(lines[i], delim);
      const row={}; headers.forEach((h,idx)=>{ row[h]=(vals[idx]||''); });
      try{
        const collabKey=_resolveCollabKey(row['user']||row['username']||row['member']||'');
        const projKey=_resolveProjectKey(row['project']||'');           // projeto é opcional
        if(!collabKey){ unmatched++; continue; }
        const dateStr=row['start date']||row['date']||'';
        const startStr=row['start time']||row['start']||'00:00:00';
        const endStr=row['end time']||row['end']||'01:00:00';
        const task=(row['description']||row['task']||'Importado do Clockify').slice(0,200);
        if(_parseDateBR(dateStr)===null){ unmatched++; continue; }
        const [dd,mm,yyyy]=(dateStr.includes('/')?dateStr.split('/').map(Number):dateStr.split('-').map(Number).reverse());
        const sTs=new Date(yyyy,mm-1,dd,...startStr.split(':').map(Number)).getTime();
        const eTs=new Date(yyyy,mm-1,dd,...endStr.split(':').map(Number)).getTime();
        if(isNaN(sTs)||isNaN(eTs)){ unmatched++; continue; }
        const dur=Math.max(eTs-sTs,60000);
        await push(entriesRef,{task,project:projKey||'',collab:collabKey,obs:'Importado do Clockify',tags:[],startTime:sTs,endTime:eTs,duration:dur,createdAt:Date.now()});
        imported++;
      }catch(e){ skipped++; }
    }
  }

  if(results) results.innerHTML=`<div style="color:var(--success);font-weight:700">✅ ${imported} registros importados com sucesso!</div>`
    + (skipped?`<div style="color:var(--warn)">${skipped} ignorados (dados inválidos)</div>`:'')
    + (unmatched?`<div style="color:var(--warn)">${unmatched} ignorados (colaborador não reconhecido nesta equipe)</div>`:'');
};

window._setupImportZone = ()=>{
  const iz=document.getElementById('importZone');
  if(!iz||iz._setupDone) return;
  iz._setupDone=true;
  iz.addEventListener('dragover',e=>{e.preventDefault();iz.classList.add('drag');});
  iz.addEventListener('dragleave',()=>iz.classList.remove('drag'));
  iz.addEventListener('drop',e=>{e.preventDefault();iz.classList.remove('drag');const f=e.dataTransfer.files[0];if(f){document.getElementById('importFileInput').files=e.dataTransfer.files;handleCSVImport({target:{files:[f]}});}});
};

// ── IMPORTADOR TRELLO → KANBAN ───────────────────────────────────────────────
let _trelloData    = null;
let _trelloListsMap   = {};   // listId  → { name, cards[], targetCol, skip }
let _trelloMembersMap = {};   // trelloId → kronosKey  ('' = não atribuir)

// A5: colunas de destino e colaboradores vêm da config da equipe ativa
// (_kColsTrello() e _kronosCollabOpts()); o auto-mapeamento usa _resolveCollabKey.

// ── Troca de aba ──────────────────────────────────────────────────────────────
window.switchImportTab = (tab)=>{
  document.getElementById('ipanel-csv').style.display        = tab==='csv'        ? '' : 'none';
  document.getElementById('ipanel-trello').style.display     = tab==='trello'     ? '' : 'none';
  document.getElementById('ipanel-avaliacoes').style.display = tab==='avaliacoes' ? '' : 'none';
  document.getElementById('itab-csv').classList.toggle('active',        tab==='csv');
  document.getElementById('itab-trello').classList.toggle('active',     tab==='trello');
  document.getElementById('itab-avaliacoes').classList.toggle('active', tab==='avaliacoes');
  if(tab==='trello'){ _setupTrelloDropZone(); _trelloInitCleanPanel(); }
};

// ── Setup drag & drop ─────────────────────────────────────────────────────────
window._setupTrelloDropZone = ()=>{
  const dz = document.getElementById('trelloDropZone');
  if(!dz || dz._setupDone) return;
  dz._setupDone = true;
  dz.addEventListener('dragover', e=>{ e.preventDefault(); dz.classList.add('drag'); });
  dz.addEventListener('dragleave', ()=>dz.classList.remove('drag'));
  dz.addEventListener('drop', e=>{
    e.preventDefault(); dz.classList.remove('drag');
    const f = e.dataTransfer.files[0];
    if(f) handleTrelloFile({target:{files:[f]}});
  });
};

// ── Painel de limpeza — só aparece para a gestora ─────────────────────────────
function _trelloInitCleanPanel(){
  const panel = document.getElementById('trelloCleanPanel');
  if(!panel) return;
  panel.style.display = state.isManager ? '' : 'none';
  if(!state.isManager) return;
  // Conta cards com importedFrom:'trello' no Firebase
  const cnt = Object.values(state.kanbanCards||{}).filter(c=>c.importedFrom==='trello').length;
  const el = document.getElementById('trelloCleanCount');
  if(el) el.textContent = cnt > 0
    ? `${cnt} card${cnt!==1?'s':''} com origem Trello encontrado${cnt!==1?'s':''} no Kanban.`
    : 'Nenhum card com origem Trello encontrado no Kanban.';
  const btn = document.getElementById('btnTrelloCleanStep1');
  if(btn) btn.disabled = cnt === 0;
}

// Passo 1: mostrar campo de confirmação
window.trelloCleanStep1 = ()=>{
  document.getElementById('trelloCleanConfirmWrap').style.display = '';
  document.getElementById('btnTrelloCleanStep1').style.display    = 'none';
  document.getElementById('btnTrelloCleanConfirm').style.display  = '';
  document.getElementById('btnTrelloCleanCancel').style.display   = '';
  document.getElementById('trelloCleanConfirmInput').value = '';
  document.getElementById('trelloCleanConfirmInput').focus();
};

// Cancelar limpeza
window.trelloCleanCancel = ()=>{
  document.getElementById('trelloCleanConfirmWrap').style.display = 'none';
  document.getElementById('btnTrelloCleanStep1').style.display    = '';
  document.getElementById('btnTrelloCleanConfirm').style.display  = 'none';
  document.getElementById('btnTrelloCleanCancel').style.display   = 'none';
  document.getElementById('trelloCleanStatus').textContent = '';
};

// Passo 2: executar deleção
window.trelloCleanConfirm = async()=>{
  const typed = (document.getElementById('trelloCleanConfirmInput')?.value||'').trim();
  if(typed !== 'CONFIRMAR'){
    showToast('⚠️ Confirmação incorreta','Digite exatamente: CONFIRMAR');
    return;
  }
  const toDelete = Object.entries(state.kanbanCards||{})
    .filter(([,c])=>c.importedFrom==='trello')
    .map(([k])=>k);
  if(!toDelete.length){ showToast('ℹ️ Nada a deletar','Nenhum card do Trello encontrado.'); return; }

  const statusEl = document.getElementById('trelloCleanStatus');
  document.getElementById('btnTrelloCleanConfirm').disabled = true;
  document.getElementById('btnTrelloCleanCancel').disabled  = true;
  statusEl.textContent = `Deletando 0 de ${toDelete.length}...`;

  let done = 0;
  for(const key of toDelete){
    await remove(child(kanbanRef, key));
    done++;
    statusEl.textContent = `Deletando ${done} de ${toDelete.length}...`;
  }

  showToast('✅ Limpeza concluída', `${done} cards removidos.`);
  statusEl.textContent = `✅ ${done} cards removidos.`;
  document.getElementById('trelloCleanConfirmWrap').style.display = 'none';
  document.getElementById('btnTrelloCleanStep1').style.display    = '';
  document.getElementById('btnTrelloCleanStep1').disabled         = true;
  document.getElementById('btnTrelloCleanConfirm').style.display  = 'none';
  document.getElementById('btnTrelloCleanCancel').style.display   = 'none';
  // Atualiza contagem
  const el = document.getElementById('trelloCleanCount');
  if(el) el.textContent = 'Nenhum card com origem Trello encontrado no Kanban.';
};

// ── Lê o JSON do Trello ───────────────────────────────────────────────────────
window.handleTrelloFile = (event)=>{
  const file = event.target.files[0];
  if(!file) return;
  if(!file.name.endsWith('.json')){
    showToast('⚠️ Formato inválido','Selecione um arquivo .json exportado do Trello.'); return;
  }
  const reader = new FileReader();
  reader.onload = e=>{
    try{
      const data = JSON.parse(e.target.result);
      if(!data.lists || !data.cards) throw new Error('Não parece um export do Trello.');
      _trelloData = data;
      _trelloBuildMap();
      _trelloGoPanel(2);
    } catch(err){
      showToast('❌ Erro ao ler JSON', err.message);
    }
  };
  reader.readAsText(file, 'utf-8');
};

// ── Constrói mapa de listas e membros ─────────────────────────────────────────
function _trelloBuildMap(){
  _trelloListsMap   = {};
  _trelloMembersMap = {};

  // Índice de membros do board: id → { fullName, username }
  const boardMembers = {};
  (_trelloData.members||[]).forEach(m=>{
    boardMembers[m.id] = { fullName: m.fullName, username: m.username };
  });

  // Mapa de cards por lista (só ativos)
  const cardsByList = {};
  (_trelloData.cards||[]).forEach(c=>{
    if(c.closed) return;
    if(!cardsByList[c.idList]) cardsByList[c.idList] = [];
    cardsByList[c.idList].push(c);
  });

  // Coluna-destino padrão = 1ª coluna existente da equipe (antes era 'standby' fixo,
  // que não existe fora da Diagramação → cards importados sumiam do Kanban).
  const defaultCol = (state.K_COLS && state.K_COLS[0]?.id) || 'standby';
  // Listas
  (_trelloData.lists||[]).forEach(l=>{
    _trelloListsMap[l.id] = {
      name: l.name,
      cards: cardsByList[l.id]||[],
      targetCol: defaultCol,
      skip: false
    };
  });

  // Membros únicos que aparecem como criadores nos cards ativos
  const creatorIds = new Set();
  (_trelloData.cards||[]).forEach(c=>{
    if(c.closed) return;
    if(c.idMemberCreator) creatorIds.add(c.idMemberCreator);
  });

  creatorIds.forEach(id=>{
    const m = boardMembers[id]||{};
    const autoKey = _resolveCollabKey(m.username) || _resolveCollabKey(m.fullName) || '';
    _trelloMembersMap[id] = {
      fullName: m.fullName || id,
      username: m.username || '',
      kronosKey: autoKey
    };
  });

  _trelloRenderMap();
}

// ── Renderiza o grid de mapeamento (listas + membros) ─────────────────────────
function _trelloRenderMap(){
  // Listas
  const listsGrid = document.getElementById('trelloListsGrid');
  if(listsGrid){
    listsGrid.innerHTML = Object.entries(_trelloListsMap).map(([id, l])=>`
      <div class="trello-list-row ${l.skip?'skipped':''}">
        <div>
          <div style="font-size:0.83rem;font-weight:700;font-family:var(--mono)">${escH(l.name)}</div>
          <div style="font-size:0.68rem;color:var(--muted)">${l.cards.length} card${l.cards.length!==1?'s':''}</div>
        </div>
        <div style="text-align:center;color:var(--muted);font-size:0.9rem">→</div>
        <select class="filter-select" style="width:100%" onchange="window._trelloSetCol('${id}',this.value)" ${l.skip?'disabled':''}>
          ${_kColsTrello().map(c=>`<option value="${escH(c.id)}" ${l.targetCol===c.id?'selected':''}>${escH(c.label)}</option>`).join('')}
        </select>
        <button class="btn-sm ${l.skip?'':'secondary'}"
          style="${l.skip?'background:var(--danger,#EF4444);color:#fff;border-color:var(--danger)':''}"
          onclick="window._trelloToggleSkip('${id}')">
          ${l.skip?'↩ Incluir':'🚫 Pular'}
        </button>
      </div>
    `).join('');
  }

  // Membros
  const membersGrid = document.getElementById('trelloMembersGrid');
  if(membersGrid){
    const collabOpts = _kronosCollabOpts();
    membersGrid.innerHTML = Object.entries(_trelloMembersMap).map(([id, m])=>`
      <div class="trello-list-row">
        <div>
          <div style="font-size:0.83rem;font-weight:700">${escH(m.fullName)}</div>
          <div style="font-size:0.68rem;color:var(--muted);font-family:var(--mono)">@${escH(m.username)}</div>
        </div>
        <div style="text-align:center;color:var(--muted);font-size:0.9rem">→</div>
        <select class="filter-select" style="width:100%" onchange="window._trelloSetMember('${id}',this.value)">
          ${collabOpts.map(o=>`<option value="${escH(o.key)}" ${m.kronosKey===o.key?'selected':''}>${escH(o.label)}</option>`).join('')}
        </select>
        <div style="width:80px;font-size:0.68rem;font-family:var(--mono);color:${m.kronosKey?'var(--success)':'var(--muted)'}">
          ${m.kronosKey ? '✓ mapeado' : '— vazio'}
        </div>
      </div>
    `).join('');
  }

  _trelloUpdateTotal();
}

window._trelloSetCol    = (id, col)=>{ _trelloListsMap[id].targetCol = col; _trelloUpdateTotal(); };
window._trelloSetMember = (id, key)=>{
  _trelloMembersMap[id].kronosKey = key;
  // Atualiza badge sem re-renderizar tudo
  _trelloRenderMap();
};
window._trelloToggleSkip = (id)=>{ _trelloListsMap[id].skip = !_trelloListsMap[id].skip; _trelloRenderMap(); };

function _trelloUpdateTotal(){
  let total=0, skipped=0;
  Object.values(_trelloListsMap).forEach(l=>{ if(l.skip) skipped+=l.cards.length; else total+=l.cards.length; });
  const el = document.getElementById('trelloTotalCount');
  if(el) el.textContent = `${total} cards serão importados${skipped>0?' · '+skipped+' pulados':''}`;
  const warn = document.getElementById('trelloWarnSkip');
  if(warn) warn.style.display = skipped>0?'block':'none';
}

// ── Importação ────────────────────────────────────────────────────────────────
window.startTrelloImport = async()=>{
  if(!state.currentUser){ showToast('⚠️ Não autenticado','Faça login para importar.'); return; }

  const toImport = [];
  Object.values(_trelloListsMap).forEach(l=>{
    if(l.skip) return;
    l.cards.forEach(c=>toImport.push({card:c, targetCol:l.targetCol}));
  });
  if(!toImport.length){ showToast('⚠️ Vazio','Nenhum card selecionado.'); return; }

  const btn = document.getElementById('btnStartTrelloImport');
  if(btn) btn.disabled = true;
  _trelloGoPanel(3);

  const total = toImport.length;
  let ok=0, err=0;
  document.getElementById('trelloCntTotal').textContent = total;

  for(let i=0; i<toImport.length; i++){
    const {card, targetCol} = toImport[i];
    const pct = Math.round(((i+1)/total)*100);
    document.getElementById('trelloProgressBar').style.width = pct+'%';
    document.getElementById('trelloProgressLabel').textContent = `Importando ${i+1} de ${total}...`;
    document.getElementById('trelloProgressSub').textContent = card.name.slice(0,60);

    try{
      const tags  = (card.labels||[]).map(l=>l.name).filter(Boolean);
      const obs   = (card.desc||'').slice(0,400).trim();
      const linkMatches = (card.desc||'').match(/https?:\/\/[^\s\)\]"<]+/g)||[];
      const links = [...new Set(linkMatches)].slice(0,5);

      // Responsável = criador do card mapeado pelo usuário
      const creatorId  = card.idMemberCreator||'';
      const assignee   = _trelloMembersMap[creatorId]?.kronosKey || '';

      const now = Date.now();
      const cardData = {
        name:         card.name.slice(0,100),
        assignee,
        column:       targetCol,
        module:       'none',
        obs,
        tags,
        links,
        hours:        0,
        workers:      {},
        comments:     {},
        adjustCycles: 0,
        importedFrom: 'trello',
        trelloId:     card.id,
        history: [{action:'Importado do Trello', by: state.currentCollabKey||state.currentUser.uid, ts: now}],
        createdAt: card.dateLastActivity ? new Date(card.dateLastActivity).getTime() : now,
        updatedAt: now,
      };

      await push(kanbanRef, cardData);
      ok++;
      document.getElementById('trelloCntOk').textContent = ok;
      _trelloLog('ok', `✓ [${assignee||'—'}] ${card.name.slice(0,45)}`);

    } catch(e){
      err++;
      document.getElementById('trelloCntErr').textContent = err;
      _trelloLog('err', `✗ ${card.name.slice(0,40)} — ${e.message}`);
    }

    if((i+1)%10===0) await new Promise(r=>setTimeout(r,300));
  }

  document.getElementById('trelloProgressLabel').textContent =
    `Concluído! ${ok} importados${err>0?', '+err+' erros':''}.`;
  document.getElementById('trelloProgressBar').style.background =
    err ? 'var(--warn)' : 'var(--success)';
  document.getElementById('trelloProgressTitle').textContent =
    err ? '⚠️ Importação concluída com erros' : '✅ Importação concluída!';
  const doneRow = document.getElementById('trelloDoneRow');
  if(doneRow) doneRow.style.display='flex';
  const s3 = document.getElementById('tstep3');
  if(s3){ s3.classList.remove('active'); s3.classList.add('done'); }
  showToast('✅ Trello importado!', `${ok} cards adicionados ao Kanban.`);
};

function _trelloLog(type, msg){
  const log = document.getElementById('trelloLogArea');
  if(!log) return;
  const el = document.createElement('div');
  el.className = 'trello-log-'+type;
  el.textContent = msg;
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
}

function _trelloGoPanel(n){
  document.getElementById('tpanel-upload').style.display   = n===1?'':'none';
  document.getElementById('tpanel-map').style.display      = n===2?'':'none';
  document.getElementById('tpanel-progress').style.display = n===3?'':'none';
  ['tstep1','tstep2','tstep3'].forEach((id,i)=>{
    const el=document.getElementById(id);
    if(!el) return;
    el.classList.remove('active','done');
    if(i+1<n)  el.classList.add('done');
    if(i+1===n) el.classList.add('active');
  });
}

window.resetTrelloImport = ()=>{
  _trelloData=null; _trelloListsMap={}; _trelloMembersMap={};
  const fi = document.getElementById('trelloFileInput');
  if(fi) fi.value='';
  _trelloGoPanel(1);
  const doneRow = document.getElementById('trelloDoneRow');
  if(doneRow) doneRow.style.display='none';
  const btn = document.getElementById('btnStartTrelloImport');
  if(btn) btn.disabled=false;
  ['trelloCntTotal','trelloCntOk','trelloCntErr'].forEach(id=>{
    const el=document.getElementById(id); if(el) el.textContent='0';
  });
  const bar=document.getElementById('trelloProgressBar');
  if(bar){ bar.style.width='0%'; bar.style.background=''; }
  const log=document.getElementById('trelloLogArea');
  if(log) log.innerHTML='';
  // Reinicia painel de limpeza
  _trelloInitCleanPanel();
};

// ── IMPORTADOR DE AVALIAÇÕES HISTÓRICAS ──────────────────────────────────────
let _avRegistros  = []; // registros parseados do texto
let _avMatchList  = []; // lista de matches para validação

// Mapa nome legível → id do nível
const _AV_NIVEL_MAP = {
  'sem ajuste':        'sem_ajuste',
  'extremamente leve': 'extremamente_leve',
  'leve':              'leve',
  'médio':             'medio',
  'medio':             'medio',
  'grave':             'grave',
};

function _avNormStr(s){
  return (s||'').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-z0-9\s]/g,'').trim();
}

function _avNivelId(str){
  const k = _avNormStr(str);
  return _AV_NIVEL_MAP[k] || (k ? 'sem_ajuste' : '');
}

// A5: nome do responsável → chave Kronos resolvido na config da equipe ativa
function _avColabKey(nome){ return _resolveCollabKey(nome) || ''; }


// ── Parser de registros ──────────────────────────────────────────────────────
function _avParseTexto(texto){
  const blocos = texto.split(/REGISTRO!/i).map(b=>b.trim()).filter(Boolean);
  return blocos.map(bloco=>{
    const get = (campo)=>{
      const re = new RegExp(`^${campo}\\s*:\\s*(.*)$`,'im');
      const m  = bloco.match(re);
      return (m?.[1]||'').trim();
    };
    return {
      disciplina:    get('Disciplina'),
      responsavel:   get('Responsável') || get('Responsavel'),
      nivelDiag:     get('Nível Ajuste do Responsável') || get('Nivel Ajuste do Responsavel'),
      descDiag:      get('Descrição Responsável') || get('Descricao Responsavel'),
      nivelCur:      get('Nível Ajuste da Curadoria') || get('Nivel Ajuste da Curadoria'),
      descCur:       get('Descrição Curador') || get('Descricao Curador'),
      data:          get('Data registro'),
    };
  }).filter(r=>r.disciplina);
}

// ── Busca card por nome (kanban + arquivo morto) ─────────────────────────────
function _avBuscarCard(nomeBusca, colabKey){
  const normBusca = _avNormStr(nomeBusca);
  const allCards = [
    ...Object.entries(state.kanbanCards||{}).map(([k,c])=>({...c,_key:k,_fonte:'kanban'})),
    ...Object.entries(window._arquivoCards||{}).map(([k,c])=>({...c,_key:k,_fonte:'arquivo'})),
  ];

  // 1. Match exato no nome normalizado
  let found = allCards.find(c=> _avNormStr(c.name) === normBusca);
  if(found) return {card:found, tipo:'exato'};

  // 2. Match com assignee correto + nome contém
  found = allCards.find(c=>
    _avNormStr(c.name).includes(normBusca) &&
    (colabKey ? c.assignee===colabKey : true)
  );
  if(found) return {card:found, tipo:'parcial'};

  // 3. Nome contém (sem filtro de assignee)
  found = allCards.find(c=> _avNormStr(c.name).includes(normBusca));
  if(found) return {card:found, tipo:'parcial'};

  // 4. Busca invertida: nome do card contido na busca
  found = allCards.find(c=> normBusca.includes(_avNormStr(c.name)) && _avNormStr(c.name).length > 5);
  if(found) return {card:found, tipo:'parcial'};

  return {card:null, tipo:'nenhum'};
}

// ── Passo 1: Analisar ────────────────────────────────────────────────────────
window.avAnalisar = ()=>{
  if(!state.isManager){ showToast('Sem permissão','Exclusivo da gestora.'); return; }
  const texto = document.getElementById('avTextoInput')?.value||'';
  if(!texto.trim()){ showToast('⚠️ Vazio','Cole os registros antes de analisar.'); return; }

  _avRegistros = _avParseTexto(texto);
  if(!_avRegistros.length){ showToast('⚠️ Nenhum registro','Verifique o formato — cada bloco deve começar com REGISTRO!'); return; }

  document.getElementById('avInputCount').textContent = `${_avRegistros.length} registro${_avRegistros.length!==1?'s':''} encontrado${_avRegistros.length!==1?'s':''}`;

  // Monta lista de matches
  _avMatchList = _avRegistros.map(r=>{
    const colabKey = _avColabKey(r.responsavel);
    const {card, tipo} = _avBuscarCard(r.disciplina, colabKey);
    return {reg:r, card, tipo, colabKey, selecionado: tipo==='exato'};
  });

  _avRenderValidacao();
  _avGoPanel(2);
};

// ── Renderiza tabela de validação ────────────────────────────────────────────
function _avRenderValidacao(){
  const list = document.getElementById('avValidacaoList');
  if(!list) return;

  const cores = {exato:'#22C55E', parcial:'#F59E0B', nenhum:'#EF4444'};
  const icons = {exato:ICONS.check, parcial:ICONS.warning, nenhum:ICONS.x};
  const labels = {exato:'Match exato', parcial:'Match parcial', nenhum:'Não encontrado'};

  list.innerHTML = _avMatchList.map((m,i)=>{
    const c = m.card;
    const colLabel = state.COLLABS[m.colabKey]?.label || m.reg.responsavel || '?';
    const cardColabLabel = c ? (state.COLLABS[c.assignee]?.label || c.assignee || '?') : '—';
    const nivelDiagLabel = m.reg.nivelDiag || '(sem avaliação)';
    const nivelCurLabel  = m.reg.nivelCur  || '(sem avaliação)';
    const cardInfo = c
      ? `<span style="font-weight:700;">"${escH((c.name||'').slice(0,50))}"</span> — ${cardColabLabel} — <span style="font-size:0.65rem;color:var(--muted);">${c._fonte==='arquivo'?'📦 Arquivo':'📋 Kanban'}</span>`
      : '<span style="color:var(--muted);font-style:italic;">Nenhum card encontrado</span>';

    const canSelect = m.tipo !== 'nenhum';
    const checked   = m.selecionado ? 'checked' : '';

    return `<div style="background:var(--surface);border:1.5px solid ${m.selecionado&&canSelect?cores[m.tipo]:'var(--border)'};border-radius:10px;padding:10px 14px;transition:border-color 0.2s;">
      <div style="display:flex;align-items:flex-start;gap:10px;">
        <input type="checkbox" ${checked} ${!canSelect?'disabled':''} style="margin-top:3px;width:15px;height:15px;accent-color:var(--orange);flex-shrink:0;"
          onchange="_avToggle(${i},this.checked)">
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;flex-wrap:wrap;">
            <span style="font-size:0.9rem;">${icons[m.tipo]}</span>
            <span style="font-size:0.78rem;font-weight:800;overflow:hidden;text-overflow:ellipsis;">${escH(m.reg.disciplina)}</span>
            <span style="font-size:0.68rem;color:var(--muted);">— ${colLabel}</span>
            <span style="font-size:0.65rem;font-weight:700;color:${cores[m.tipo]};background:${cores[m.tipo]}18;border:1px solid ${cores[m.tipo]}44;border-radius:4px;padding:1px 6px;margin-left:auto;">${labels[m.tipo]}</span>
          </div>
          <div style="font-size:0.72rem;color:var(--muted);margin-bottom:4px;">→ ${cardInfo}</div>
          <div style="display:flex;gap:12px;flex-wrap:wrap;font-size:0.68rem;font-family:var(--mono);color:var(--muted);">
            <span>Diag: <strong style="color:var(--text)">${escH(nivelDiagLabel)}</strong></span>
            <span>Cur: <strong style="color:var(--text)">${escH(nivelCurLabel)}</strong></span>
            ${m.reg.descDiag?`<span title="${escH(m.reg.descDiag)}">Obs diag: "${escH(m.reg.descDiag.slice(0,30))}${m.reg.descDiag.length>30?'…':''}"</span>`:''}
          </div>
        </div>
      </div>
    </div>`;
  }).join('');

  _avAtualizarContador();
}

window._avToggle = (i, checked)=>{
  _avMatchList[i].selecionado = checked;
  _avAtualizarContador();
  // Atualiza borda do item
  const items = document.getElementById('avValidacaoList').children;
  if(items[i]){
    const m = _avMatchList[i];
    const cores = {exato:'#22C55E', parcial:'#F59E0B', nenhum:'#EF4444'};
    items[i].style.borderColor = checked ? cores[m.tipo] : 'var(--border)';
  }
};

window.avSelecionarExatos = ()=>{
  _avMatchList.forEach((m,i)=>{ if(m.tipo==='exato') m.selecionado=true; });
  _avRenderValidacao();
};

function _avAtualizarContador(){
  const sel = _avMatchList.filter(m=>m.selecionado).length;
  const total = _avMatchList.length;
  const el = document.getElementById('avValidacaoCount');
  if(el) el.textContent = `${sel} de ${total} selecionados para importar`;
}

// ── Passo 3: Importar ────────────────────────────────────────────────────────
window.avImportar = async()=>{
  if(!state.isManager){ showToast('Sem permissão','Exclusivo da gestora.'); return; }
  const paraImportar = _avMatchList.filter(m=>m.selecionado && m.card);
  if(!paraImportar.length){ showToast('⚠️ Nada selecionado','Selecione ao menos um registro com card encontrado.'); return; }

  document.getElementById('btnAvImportar').disabled = true;
  _avGoPanel(3);

  const total = paraImportar.length;
  let ok=0, err=0;
  document.getElementById('avCntTotal').textContent = total;

  for(let i=0; i<paraImportar.length; i++){
    const {reg, card} = paraImportar[i];
    const pct = Math.round(((i+1)/total)*100);
    document.getElementById('avProgressBar').style.width = pct+'%';
    document.getElementById('avProgressLabel').textContent = `Importando ${i+1} de ${total}...`;

    try{
      const now = Date.now();
      const fields = {};
      const nivelDiagId = _avNivelId(reg.nivelDiag);
      const nivelCurId  = _avNivelId(reg.nivelCur);
      if(nivelDiagId) fields.ajuste_diagramacao     = nivelDiagId;
      if(reg.descDiag.trim()) fields.ajuste_diagramacao_obs = reg.descDiag.trim();
      if(nivelCurId)  fields.ajuste_curadoria        = nivelCurId;
      if(reg.descCur.trim())  fields.ajuste_curadoria_obs  = reg.descCur.trim();
      fields.ajuste_avaliado_em = now;
      fields.updatedAt          = now;

      // Determina se é kanban ou arquivo morto
      const dbPath = card._fonte==='arquivo' ? `arquivo/${card._key}` : `kanban/${card._key}`;
      await update(ref(db, dbPath), fields);

      // Atualiza cache local
      if(card._fonte==='arquivo' && window._arquivoCards?.[card._key]){
        Object.assign(window._arquivoCards[card._key], fields);
      } else if(state.kanbanCards[card._key]){
        Object.assign(state.kanbanCards[card._key], fields);
      }

      ok++;
      document.getElementById('avCntOk').textContent = ok;
      _avLog('ok', `✓ ${reg.disciplina.slice(0,45)}`);
    } catch(e){
      err++;
      document.getElementById('avCntErr').textContent = err;
      _avLog('err', `✗ ${reg.disciplina.slice(0,40)} — ${e.message}`);
    }
  }

  document.getElementById('avProgressLabel').textContent = `Concluído! ${ok} importados${err>0?', '+err+' erros':''}. `;
  document.getElementById('avProgressBar').style.background = err ? 'var(--warn)' : 'var(--success)';
  document.getElementById('avProgressTitle').textContent = err ? '⚠️ Importação com erros' : '✅ Avaliações importadas!';
  const doneRow = document.getElementById('avDoneRow');
  if(doneRow) doneRow.style.display = 'flex';
  showToast('✅ Avaliações importadas!', `${ok} cards atualizados.`);
};

function _avLog(type, msg){
  const log = document.getElementById('avLogArea');
  if(!log) return;
  const el = document.createElement('div');
  el.className = type==='ok'?'trello-log-ok':'trello-log-err';
  el.textContent = msg;
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
}

function _avGoPanel(n){
  document.getElementById('avpanel-input').style.display    = n===1 ? '' : 'none';
  document.getElementById('avpanel-validar').style.display  = n===2 ? '' : 'none';
  document.getElementById('avpanel-progress').style.display = n===3 ? '' : 'none';
  ['avstep1','avstep2','avstep3'].forEach((id,i)=>{
    const el = document.getElementById(id); if(!el) return;
    el.classList.remove('active','done');
    if(i+1<n)  el.classList.add('done');
    if(i+1===n) el.classList.add('active');
  });
}

window.avGoInput  = ()=>{ _avGoPanel(1); };
window.avReset    = ()=>{
  _avRegistros=[]; _avMatchList=[];
  const ta = document.getElementById('avTextoInput');
  if(ta) ta.value='';
  const cnt = document.getElementById('avInputCount');
  if(cnt) cnt.textContent='';
  const doneRow = document.getElementById('avDoneRow');
  if(doneRow) doneRow.style.display='none';
  document.getElementById('avCntTotal').textContent='0';
  document.getElementById('avCntOk').textContent='0';
  document.getElementById('avCntErr').textContent='0';
  document.getElementById('avProgressBar').style.width='0%';
  document.getElementById('avProgressBar').style.background='';
  document.getElementById('avLogArea').innerHTML='';
  document.getElementById('btnAvImportar').disabled=false;
  _avGoPanel(1);
};
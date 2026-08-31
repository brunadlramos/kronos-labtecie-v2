#!/usr/bin/env node
/*
 * ARQUIVAMENTO DOS CONCLUÍDOS — EQUIPE DIAGRAMAÇÃO (exclusivo).
 *
 * Move cards da coluna "Concluído" do Kanban para o Arquivo Morto, colocando cada
 * um no MÓDULO TRIMESTRAL do mês em que foi FINALIZADO (movido p/ Concluído):
 *   Jan/Fev/Mar → MOD1 · Abr/Mai/Jun → MOD2 · Jul/Ago/Set → MOD3 · Out/Nov/Dez → MOD4
 *
 * Regra de corte (definida pela gestora):
 *   - Finalizado ATÉ 10/07/2026 (inclusive)  → ARQUIVA (no módulo do mês).
 *   - Finalizado A PARTIR de 11/07/2026       → MANTÉM em "Concluído".
 *
 * Cards do Trello entram pela MESMA regra de mês (não vão p/ a coluna "TRELLO").
 *
 * Data de finalização = concludedAt; se faltar, a data do evento "Concluído" no
 * histórico; em último caso, updatedAt.
 *
 * SEGURANÇA: só escreve no projeto kronoslabtecie e só no caminho da diagramação.
 * Antes de qualquer escrita, grava um backup fresco de kanban+arquivo.
 *
 * Uso:
 *   node arquivar-concluidos.js            # DRY-RUN (não escreve nada)
 *   node arquivar-concluidos.js --commit   # grava de verdade (após backup)
 */
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const COMMIT = process.argv.includes('--commit');
const TEAM = 'diagramacao';
const KANBAN_PATH  = `/equipes/${TEAM}/kanban`;
const ARQUIVO_PATH = `/equipes/${TEAM}/arquivo`;

// Corte: finalizado até o fim do dia 10/07/2026 (horário local) arquiva.
const CUTOFF = new Date('2026-07-10T23:59:59.999').getTime();

const QUARTER = { 0:'MOD1',1:'MOD1',2:'MOD1', 3:'MOD2',4:'MOD2',5:'MOD2', 6:'MOD3',7:'MOD3',8:'MOD3', 9:'MOD4',10:'MOD4',11:'MOD4' };
const MONTH_PT = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];

function finalizacaoTs(c){
  if (c.concludedAt) return { ts: c.concludedAt, src: 'concludedAt' };
  if (Array.isArray(c.history)) {
    const hs = c.history.filter(h => h && /conclu/i.test(h.action||''));
    if (hs.length) return { ts: hs[hs.length-1].ts, src: 'history' };
  }
  return { ts: c.updatedAt || c.createdAt || Date.now(), src: 'updatedAt' };
}

const saPath = path.join(DIR, 'serviceAccount.json');
if (!fs.existsSync(saPath)) {
  console.error('❌ Falta migracao/serviceAccount.json (chave do projeto kronoslabtecie).');
  console.error('   Console Firebase → Configurações → Contas de serviço → Gerar nova chave.');
  process.exit(1);
}
const admin = require('firebase-admin');
const sa = require(saPath);
if (sa.project_id !== 'kronoslabtecie') {
  console.error(`❌ serviceAccount aponta para "${sa.project_id}", não kronoslabtecie. Abortando.`);
  process.exit(1);
}
admin.initializeApp({
  credential: admin.credential.cert(sa),
  databaseURL: `https://${sa.project_id}-default-rtdb.firebaseio.com`,
});
const dbadm = admin.database();

(async () => {
  const kanban  = (await dbadm.ref(KANBAN_PATH).get()).val()  || {};
  const arquivo = (await dbadm.ref(ARQUIVO_PATH).get()).val() || {};

  const concl = Object.entries(kanban).filter(([,c]) => c.column === 'concluido' && !c.archived);

  const toArchive = [];   // {key, card, ts, mod}
  const toKeep = [];      // finalizado após o corte
  for (const [key, card] of concl) {
    const { ts } = finalizacaoTs(card);
    if (ts > CUTOFF) { toKeep.push({ key, card, ts }); continue; }
    const mod = QUARTER[new Date(ts).getMonth()];
    toArchive.push({ key, card, ts, mod });
  }

  // ── Relatório ──
  const byMod = {}, byMonth = {};
  toArchive.forEach(x => {
    byMod[x.mod] = (byMod[x.mod]||0)+1;
    const mk = MONTH_PT[new Date(x.ts).getMonth()] + '/' + new Date(x.ts).getFullYear();
    byMonth[mk] = (byMonth[mk]||0)+1;
  });
  console.log('════════ ARQUIVAMENTO — DIAGRAMAÇÃO ════════');
  console.log('Concluídos no board  :', concl.length);
  console.log('→ ARQUIVAR (≤10/07)  :', toArchive.length, '  por módulo:', JSON.stringify(byMod));
  console.log('   por mês de finaliz.:', JSON.stringify(byMonth));
  console.log('→ MANTER (>10/07)    :', toKeep.length,
    toKeep.length ? '  ('+toKeep.map(x=>new Date(x.ts).toLocaleDateString('pt-BR')).join(', ')+')' : '');
  console.log('Arquivo morto atual  :', Object.keys(arquivo).length, 'cards (não serão tocados)');
  console.log('');

  if (!COMMIT) {
    console.log('DRY-RUN: nada foi escrito. Revise acima e rode com --commit para gravar.');
    // amostra
    console.log('\nAmostra (10 primeiros a arquivar):');
    toArchive.slice(0,10).forEach(x =>
      console.log(`  [${x.mod}] ${new Date(x.ts).toLocaleDateString('pt-BR')} — ${(x.card.name||'').slice(0,50)}`));
    process.exit(0);
  }

  // ── Backup fresco ANTES de escrever ──
  const stamp = new Date().toISOString().replace(/[:.]/g,'-').slice(0,19);
  const backupFile = path.join(DIR, `backup-diagramacao-pre-arquivamento-${stamp}.json`);
  fs.writeFileSync(backupFile, JSON.stringify({ kanban, arquivo }, null, 2));
  console.log('🛟 Backup salvo:', path.basename(backupFile));

  // ── Escrita atômica: adiciona ao arquivo + remove do kanban ──
  const updates = {};
  const now = Date.now();
  for (const x of toArchive) {
    const data = {
      ...x.card,
      archived: true,
      archiveYear: new Date(x.ts).getFullYear(),
      module: x.mod,
      archivedAt: x.card.archivedAt || x.ts,   // "Arquivado em" = data de finalização
      migradoArquivamentoEm: now,
    };
    updates[`${ARQUIVO_PATH}/${x.key}`] = data;
    updates[`${KANBAN_PATH}/${x.key}`]  = null;   // remove do board
  }

  await dbadm.ref().update(updates);
  console.log(`✅ Arquivados ${toArchive.length} cards. Board mantém ${toKeep.length} concluído(s) recentes.`);

  // ── Verificação pós-escrita ──
  const kanban2  = (await dbadm.ref(KANBAN_PATH).get()).val()  || {};
  const arquivo2 = (await dbadm.ref(ARQUIVO_PATH).get()).val() || {};
  const conclDepois = Object.values(kanban2).filter(c => c.column==='concluido' && !c.archived).length;
  console.log('VERIFICAÇÃO → concluído agora:', conclDepois, '| arquivo agora:', Object.keys(arquivo2).length,
    `(era ${Object.keys(arquivo).length}, +${Object.keys(arquivo2).length - Object.keys(arquivo).length})`);
  process.exit(0);
})().catch(err => { console.error('❌ Falha:', err); process.exit(1); });

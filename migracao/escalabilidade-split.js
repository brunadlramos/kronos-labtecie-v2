#!/usr/bin/env node
/*
 * ESCALABILIDADE #2 + #3 — split do arquivo morto + pastas por ano.
 * READ-ONLY sobre o backup: lê o estado atual do V2 e gera dois arquivos de import:
 *   import/kanban-active.json  → só os cards ATIVOS (board), sem archived
 *   import/arquivo-final.json  → todos os arquivados + os 3 do nó arquivo,
 *                                com archiveYear + module normalizado (#3)
 * NÃO escreve no banco. Uso: node escalabilidade-split.js
 */
const fs = require('fs'), path = require('path');
const DIR = __dirname, OUT = path.join(DIR, 'import');
fs.mkdirSync(OUT, { recursive: true });

const SRC = path.join(DIR, '..', 'backups', 'rtdb-backup-2026-07-11-pre-escalabilidade.json');
const d = JSON.parse(fs.readFileSync(SRC, 'utf8')).equipes.diagramacao;
const kanban = d.kanban || {}, arquivoExist = d.arquivo || {};

// module normalizado (base, sem ano). Ano vai no campo archiveYear (#3).
function baseModule(card) {
  if (card.importedFrom === 'trello') return 'TRELLO';
  if (typeof card.module === 'string' && /^MOD\d$/.test(card.module)) return card.module;
  return 'arquivo_geral';           // 'none'/undefined → catch-all por ano
}
function yearOf(card) {
  const ts = card.createdAt || card.archivedAt || Date.now();
  return new Date(ts).getFullYear();
}
function normArchived(card) {
  const c = { ...card };
  c.archived = true;
  c.archiveYear = yearOf(card);
  c.module = baseModule(card);
  // os 3 do nó arquivo (V1) não têm archivedAt → usa createdAt p/ filtros/sort
  if (!c.archivedAt) c.archivedAt = card.createdAt || Date.now();
  return c;
}

const kanbanActive = {}, arquivoFinal = {};
let movedTrello = 0, movedGeral = 0, movedMod = 0, active = 0, lixeira = 0;

for (const [k, c] of Object.entries(kanban)) {
  if (c.column === 'lixeira') { lixeira++; kanbanActive[k] = c; continue; } // trash fica no kanban (efêmero)
  if (c.archived) {
    arquivoFinal[k] = normArchived(c);
    const b = arquivoFinal[k].module;
    if (b === 'TRELLO') movedTrello++; else if (b === 'arquivo_geral') movedGeral++; else movedMod++;
  } else { kanbanActive[k] = c; active++; }
}
// os 3 já existentes no nó arquivo
for (const [k, c] of Object.entries(arquivoExist)) arquivoFinal[k] = normArchived(c);

fs.writeFileSync(path.join(OUT, 'kanban-active.json'), JSON.stringify(kanbanActive, null, 2));
fs.writeFileSync(path.join(OUT, 'arquivo-final.json'), JSON.stringify(arquivoFinal, null, 2));

// distribuição por ano
const byYear = {};
for (const c of Object.values(arquivoFinal)) byYear[c.archiveYear] = (byYear[c.archiveYear] || 0) + 1;

console.log('── ESCALABILIDADE split ──');
console.log('kanban origem      :', Object.keys(kanban).length, '(ativos', active, '+ arquivados', movedTrello+movedGeral+movedMod, '+ lixeira', lixeira + ')');
console.log('arquivo já existia :', Object.keys(arquivoExist).length);
console.log('');
console.log('→ kanban-active.json:', Object.keys(kanbanActive).length, '(board — só ativos' + (lixeira?' + '+lixeira+' lixeira':'') + ')');
console.log('→ arquivo-final.json:', Object.keys(arquivoFinal).length, '(TRELLO', movedTrello, '| arquivo_geral', movedGeral, '| MODn', movedMod, '| +3 nó arquivo)');
console.log('  por ano:', JSON.stringify(byYear));
console.log('');
const total = Object.keys(kanbanActive).length + Object.keys(arquivoFinal).length;
const orig = Object.keys(kanban).length + Object.keys(arquivoExist).length;
console.log('CONSERVAÇÃO: origem', orig, '→ destino', total, total === orig ? '✅ OK (nenhum card perdido)' : '❌ DIVERGÊNCIA!');
// sanity: todo arquivado tem year+module válidos
const bad = Object.values(arquivoFinal).filter(c => !c.archiveYear || !c.module);
console.log('cards sem year/module:', bad.length, bad.length ? '❌' : '✅');

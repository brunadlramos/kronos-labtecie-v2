#!/usr/bin/env node
/*
 * FASE 1 — transforma o histórico de tempo (entries) do V1 para o formato do V2.
 *
 * Lê (read-only, nada é escrito no V1):
 *   ./v1-entries.json   -> export de /entries do V1  (kronos-labtecie)
 *   ./v2-usuarios.json  -> export de /equipes/diagramacao/config/usuarios do V2 (kronoslabtecie)
 *
 * Gera:
 *   ./v2-entries-import.json  -> pronto para importar em /equipes/diagramacao/entries
 *   (relatório de contagem no terminal)
 *
 * Uso:
 *   node transform-entries.js 2026-04            # só abril/2026
 *   node transform-entries.js 2026-04 2026-05    # abril e maio
 *   node transform-entries.js                    # TODOS os meses
 *
 * Nada é enviado ao banco aqui — isso é só a transformação. O envio é o import-entries.js.
 */
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const MONTHS = process.argv.slice(2); // ["YYYY-MM", ...]  vazio = todos
const BRT_OFFSET_MIN = -180; // America/Sao_Paulo (UTC-3), sem horário de verão

// Chaves curtas do V1 (fonte: COLLABS no index.js do V1)
const V1_KEYS = ['lucas', 'carlos', 'erick', 'roberto', 'kesia', 'bruna'];

function die(msg) { console.error('\n❌ ' + msg + '\n'); process.exit(1); }
function load(f) {
  const p = path.join(DIR, f);
  if (!fs.existsSync(p)) die(`Falta o arquivo ${f} na pasta migracao/. Rode o export primeiro.`);
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  return raw === null ? {} : raw;
}
function monthKey(ms) {
  const d = new Date(Number(ms) + BRT_OFFSET_MIN * 60000);
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
}

// ── 1. Mapa de identidade: short (V1) -> nome_sobrenome (V2) ────────────────
const v2users = load('v2-usuarios.json');
const map = {};           // shortKey -> v2Key
const byFirst = {};       // firstToken -> [v2Key,...] (detecta ambiguidade)
for (const u of Object.values(v2users)) {
  if (!u || !u.key) continue;
  const first = String(u.key).split('_')[0].toLowerCase();
  (byFirst[first] = byFirst[first] || []).push(u.key);
}
for (const sk of V1_KEYS) {
  const hits = byFirst[sk] || [];
  if (hits.length === 1) map[sk] = hits[0];
  else if (hits.length > 1) die(`Ambíguo: "${sk}" casa com ${hits.join(', ')} no V2. Ajuste manualmente o mapa.`);
  // 0 hits: fica sem mapa; tratado abaixo só se aparecer nos dados
}

console.log('── Mapa de identidade (V1 → V2) ──');
for (const sk of V1_KEYS) console.log('  ' + sk.padEnd(9) + ' → ' + (map[sk] || '⚠️  não encontrado no config do V2'));

// ── 2. Transformar entries ─────────────────────────────────────────────────
const v1 = load('v1-entries.json');
const out = {};
const unmapped = new Set();
const perCollab = {}, perMonth = {};
let total = 0, kept = 0;

for (const [id, e] of Object.entries(v1)) {
  if (!e || typeof e !== 'object') continue;
  total++;
  const mk = e.startTime ? monthKey(e.startTime) : 'sem-data';
  if (MONTHS.length && !MONTHS.includes(mk)) continue;

  const collab = map[e.collab];
  if (!collab) { unmapped.add(e.collab); continue; }

  out[id] = Object.assign({}, e, { collab }); // preserva o ID (idempotente)
  kept++;
  perCollab[collab] = (perCollab[collab] || 0) + 1;
  perMonth[mk] = (perMonth[mk] || 0) + 1;
}

// ── 3. Relatório + guarda de segurança ─────────────────────────────────────
console.log('\n── Meses no export do V1 ──');
Object.keys(perMonth).sort().forEach(m => console.log('  ' + m + ': ' + perMonth[m]));
console.log('\n── Por colaborador (após filtro) ──');
Object.keys(perCollab).sort().forEach(c => console.log('  ' + c.padEnd(18) + perCollab[c]));
console.log(`\nTotal no V1: ${total} | selecionadas: ${kept}` + (MONTHS.length ? ` (meses ${MONTHS.join(', ')})` : ' (todos os meses)'));

if (unmapped.size) {
  die(`Collab sem tradução: ${[...unmapped].join(', ')}. Crie o usuário no V2 ou ajuste o mapa antes de importar. NADA foi gravado.`);
}

fs.writeFileSync(path.join(DIR, 'v2-entries-import.json'), JSON.stringify(out, null, 2));
console.log(`\n✅ Gerado v2-entries-import.json com ${kept} entries. Revise e rode import-entries.js.`);

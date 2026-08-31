#!/usr/bin/env node
/*
 * MIGRAÇÃO COMPLETA V1 → V2 (Diagramação). READ-ONLY: lê v1-full + v2-usuarios,
 * gera arquivos de import em migracao/import/ (não escreve no banco).
 * Tradução de identidade curto/UID → nome_sobrenome; e-mails preservados.
 * Uso: node transform-all.js
 */
const fs = require('fs'), path = require('path');
const DIR = __dirname, OUT = path.join(DIR, 'import');
fs.mkdirSync(OUT, { recursive: true });

const v1 = JSON.parse(fs.readFileSync(path.join(DIR, 'v1-full-2026-07-11.json'), 'utf8'));
const v2users = JSON.parse(fs.readFileSync(path.join(DIR, 'v2-usuarios.json'), 'utf8'));

// ── Mapa de identidade ──────────────────────────────────────────────────────
const byFirst = {}, v2keys = new Set();
for (const u of Object.values(v2users)) {
  if (!u || !u.key) continue;
  v2keys.add(u.key);
  const first = String(u.key).split('_')[0].toLowerCase();
  (byFirst[first] = byFirst[first] || []).push(u.key);
}
const map = {};
for (const f in byFirst) if (byFirst[f].length === 1) map[f] = byFirst[f][0];
const collabMap = v1.collabMap || {}; // UID -> Nome

const unmapped = new Set();
function tr(id) {
  if (id == null) return id;
  const s = String(id);
  if (s.includes('@')) return s;                       // e-mail: preserva
  const low = s.toLowerCase();
  if (map[low]) return map[low];                        // curto -> key
  if (v2keys.has(s)) return s;                          // já é key do V2
  if (collabMap[s]) { const nm = String(collabMap[s]).toLowerCase(); if (map[nm]) return map[nm]; } // UID -> nome -> key
  unmapped.add(s);
  return s;
}
// remapeia as CHAVES de um objeto {identidade: valor}
function trKeys(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[tr(k)] = v;
  return out;
}

// ── Card do kanban/arquivo ──────────────────────────────────────────────────
function trCard(card) {
  const c = { ...card };
  if (c.assignee !== undefined) c.assignee = tr(c.assignee);
  if (c.workers) c.workers = trKeys(c.workers);
  if (c.comments) { const cm = {}; for (const [k, v] of Object.entries(c.comments)) cm[k] = { ...v, by: tr(v.by) }; c.comments = cm; }
  if (c.history) {
    if (Array.isArray(c.history)) c.history = c.history.map(h => ({ ...h, by: tr(h.by) }));
    else { const hh = {}; for (const [k, v] of Object.entries(c.history)) hh[k] = { ...v, by: tr(v.by) }; c.history = hh; }
  }
  // modifiedBy é e-mail no V1 → tr() preserva
  if (c.modifiedBy !== undefined) c.modifiedBy = tr(c.modifiedBy);
  return c;
}

const report = {};
const write = (name, obj) => { fs.writeFileSync(path.join(OUT, name + '.json'), JSON.stringify(obj, null, 2)); report[name] = obj && typeof obj === 'object' ? (Array.isArray(obj) ? obj.length : Object.keys(obj).length) : 1; };

// ── entries ─────────────────────────────────────────────────────────────────
{ const out = {}; for (const [id, e] of Object.entries(v1.entries || {})) out[id] = { ...e, collab: tr(e.collab) }; write('entries', out); }

// ── kanban / arquivo ──────────────────────────────────────────────────────────
{ const out = {}; for (const [id, c] of Object.entries(v1.kanban || {})) out[id] = trCard(c); write('kanban', out); }
{ const out = {}; for (const [id, c] of Object.entries(v1.arquivo || {})) out[id] = trCard(c); write('arquivo', out); }

// ── avatars (chaves curtas -> key) ────────────────────────────────────────────
{ write('avatars', trKeys(v1.avatars || {})); }

// ── notifs (to/from) ──────────────────────────────────────────────────────────
{ const out = {}; for (const [id, n] of Object.entries(v1.notifs || {})) out[id] = { ...n, to: tr(n.to), from: tr(n.from) }; write('notifs', out); }

// ── approvalRequests (requestedBy + payload.collab) ──────────────────────────
{ const out = {}; for (const [id, r] of Object.entries(v1.approvalRequests || {})) { const rr = { ...r, requestedBy: tr(r.requestedBy) }; if (rr.payload && rr.payload.collab) rr.payload = { ...rr.payload, collab: tr(rr.payload.collab) }; out[id] = rr; } write('approvalRequests', out); }

// ── desafio (by) ──────────────────────────────────────────────────────────────
{ const d = v1.desafio; write('desafio', d && d.by ? { ...d, by: tr(d.by) } : d); }

// ── sem identidade: cópia direta ──────────────────────────────────────────────
write('customTags', v1.customTags || []);
write('customProjects', v1.customProjects || []);
write('holidays', v1.holidays || {});

// ── config/colunas do Kanban (recriar a partir dos IDs usados no V1) ─────────
const LABELS = { em_curadoria:'Em Curadoria', recuradoria:'Recuradoria', liberado_curadoria:'Liberado p/ Curadoria', liberacao:'Liberação', finalizacao:'Finalização', standby:'Stand-by', concluido:'Concluído', a_fazer:'A Fazer', em_andamento:'Em Andamento' };
const ORDER = ['a_fazer','em_curadoria','recuradoria','liberado_curadoria','liberacao','finalizacao','standby','concluido'];
const CORES = ['#F59E0B','#8B5CF6','#EC4899','#3B82F6','#06B6D4','#10B981','#6B7280','#22C55E'];
const usados = new Set(); for (const c of Object.values(v1.kanban||{})) if (c.column && c.column!=='lixeira') usados.add(c.column);
for (const c of Object.values(v1.arquivo||{})) if (c.column && c.column!=='lixeira') usados.add(c.column);
const colOrder = ORDER.filter(id=>usados.has(id)).concat([...usados].filter(id=>!ORDER.includes(id)));
const colunas = {}; colOrder.forEach((id,i)=>{ colunas[id] = { label: LABELS[id] || id, ordem: i, color: CORES[i % CORES.length] }; });
write('colunas', colunas);

// ── Relatório ─────────────────────────────────────────────────────────────────
console.log('── Mapa curto → V2 ──'); for (const f in map) console.log('  ' + f.padEnd(9) + ' → ' + map[f]);
console.log('\n── Contagens geradas em migracao/import/ ──'); for (const k in report) console.log('  ' + k.padEnd(18) + report[k]);
console.log('\n── Colunas do Kanban recriadas (ordem) ──'); colOrder.forEach((id,i)=>console.log('  '+i+'. '+id+'  → "'+(LABELS[id]||id)+'"'));
if (unmapped.size) console.log('\n⚠️  Identidades NÃO traduzidas (verifique):', [...unmapped].join(', '));
else console.log('\n✅ Todas as identidades traduzidas.');

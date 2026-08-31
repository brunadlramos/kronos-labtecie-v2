#!/usr/bin/env node
/*
 * FASE 1 — limpeza ÚNICA das entries de teste do V2, feita ANTES do primeiro import.
 * Faz backup do nó atual em ./v2-entries-backup-<ts>.json e só então remove.
 *
 * Uso:
 *   node clean-test.js            # dry-run: baixa e mostra o que existe hoje
 *   node clean-test.js --commit   # backup + remove /equipes/diagramacao/entries
 */
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const COMMIT = process.argv.includes('--commit');
const TEAM_PATH = '/equipes/diagramacao/entries';

const saPath = path.join(DIR, 'serviceAccount.json');
if (!fs.existsSync(saPath)) { console.error('❌ Falta serviceAccount.json do kronoslabtecie.'); process.exit(1); }

const admin = require('firebase-admin');
const sa = require(saPath);
if (sa.project_id !== 'kronoslabtecie') { console.error(`❌ serviceAccount é de "${sa.project_id}". Abortando.`); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(sa), databaseURL: `https://${sa.project_id}-default-rtdb.firebaseio.com` });

const ref = admin.database().ref(TEAM_PATH);
ref.once('value').then(snap => {
  const cur = snap.val() || {};
  const n = Object.keys(cur).length;
  const backup = path.join(DIR, `v2-entries-backup-${Date.now()}.json`);
  fs.writeFileSync(backup, JSON.stringify(cur, null, 2));
  console.log(`Backup de ${n} entries salvo em ${path.basename(backup)}.`);
  if (!COMMIT) { console.log('DRY-RUN: rode com --commit para remover.'); process.exit(0); }
  return ref.remove().then(() => { console.log(`✅ ${TEAM_PATH} limpo (${n} removidas).`); process.exit(0); });
}).catch(err => { console.error('❌', err.message); process.exit(1); });

#!/usr/bin/env node
/*
 * FASE 1 — importa v2-entries-import.json para o V2 (kronoslabtecie).
 *
 * Usa update() ADITIVO por ID: reimportar o mesmo mês não duplica (o ID do V1 é
 * preservado) e não apaga meses já importados. Por isso a limpeza do teste é feita
 * UMA VEZ com clean-test.js ANTES do primeiro import — nunca com set() aqui.
 *
 * Pré-requisitos:
 *   - migracao/serviceAccount.json  (chave privada do projeto kronoslabtecie:
 *      Console Firebase → Configurações → Contas de serviço → Gerar nova chave)
 *   - npm i firebase-admin   (dentro de migracao/)
 *
 * Uso:
 *   node import-entries.js            # dry-run: só mostra o que faria
 *   node import-entries.js --commit   # grava de verdade
 */
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const COMMIT = process.argv.includes('--commit');
const TEAM_PATH = '/equipes/diagramacao/entries';

const dataPath = path.join(DIR, 'v2-entries-import.json');
if (!fs.existsSync(dataPath)) { console.error('❌ Rode transform-entries.js primeiro.'); process.exit(1); }
const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
const n = Object.keys(data).length;

if (!COMMIT) {
  console.log(`DRY-RUN: importaria ${n} entries em ${TEAM_PATH} (update aditivo).`);
  console.log('Confirme o v2-entries-import.json e rode com --commit para gravar.');
  process.exit(0);
}

const saPath = path.join(DIR, 'serviceAccount.json');
if (!fs.existsSync(saPath)) { console.error('❌ Falta serviceAccount.json do kronoslabtecie.'); process.exit(1); }

const admin = require('firebase-admin');
const sa = require(saPath);
admin.initializeApp({
  credential: admin.credential.cert(sa),
  databaseURL: `https://${sa.project_id}-default-rtdb.firebaseio.com`,
});

// trava de segurança: só grava no projeto certo
if (sa.project_id !== 'kronoslabtecie') {
  console.error(`❌ serviceAccount aponta para "${sa.project_id}", não kronoslabtecie. Abortando.`);
  process.exit(1);
}

admin.database().ref(TEAM_PATH).update(data)
  .then(() => { console.log(`✅ Importadas ${n} entries em ${TEAM_PATH}.`); process.exit(0); })
  .catch(err => { console.error('❌ Falha no import:', err.message); process.exit(1); });

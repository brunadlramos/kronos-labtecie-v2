// ─────────────────────────────────────────────────────────────────────────────
// SUÍTE DE REGRAS — Kronos Labtecie v2 · Onda 1
//
// Portão de testes das Security Rules do Realtime Database. As regras são a
// ÚNICA fronteira de segurança deste sistema (não há backend), e até agora não
// tinham teste nenhum.
//
// Organização (PLANO_CORRECAO_SEGURANCA.md, Fase 1):
//   • ATAQUE       — o que NÃO pode ser permitido. Antes da Fase 2 estes testes
//                    FALHAM de propósito: a falha é a prova de que o achado é
//                    real. Depois da correção, todos passam.
//   • NAO-REGRESSAO — fluxo legítimo que precisa continuar funcionando. Estes
//                    passam desde já, e é aqui que se evita derrubar a operação
//                    da equipe ao apertar as regras (decisões D5 e D6).
//
// Rodar:  npm test        (ver tests/README.md — precisa do emulador de pé)
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
import { after, before, beforeEach, describe, it } from 'node:test';
import {
  assertFails, assertSucceeds, initializeTestEnvironment,
} from '@firebase/rules-unit-testing';

const HOST = process.env.RTDB_EMULATOR_HOST || '127.0.0.1';
const PORT = Number(process.env.RTDB_EMULATOR_PORT || 9000);

let env;

// ── Atores ───────────────────────────────────────────────────────────────────
// Atenção à distinção que as regras fazem: /usuarios é indexado por UID, e
// equipes/<eq>/config/usuarios TAMBÉM é por UID, guardando a `key` do
// colaborador num campo. Vários achados vivem justamente nessa costura.
const ANA   = 'uid_ana';      // colaborador, equipe diagramacao, key 'ana'
const BIA   = 'uid_bia';      // colaborador, mesma equipe, key 'bia'
const GEST  = 'uid_gestora';  // gestora da diagramacao, key 'gestora'
const COORD = 'uid_coord';    // coordenador da coordenacao 'ensino'
const ADMIN = 'uid_admin';    // admin global
const CFG   = 'uid_cfg';       // colaborador no global, gestora SO em config/usuarios (promovida pelo coordenador)
const TMP   = 'uid_tmp';       // colaborador com gestorTemp === true em config/usuarios
const NOVO  = 'uid_novo';     // conta que ainda não tem perfil em /usuarios
const RH    = 'uid_rh';       // RH global (equipeId '-'): somente leitura
const RHEQ  = 'uid_rh_eq';    // RH com equipe REAL atribuída (A6: continua somente leitura)

const EQ = 'diagramacao';

function seed() {
  const colab = (key, nome) => ({
    key, nome, email: `${key}@fatecie.edu.br`, papel: 'colaborador',
    cor: '#94A3B8', ativo: true, iniciais: nome.slice(0, 2).toUpperCase(),
  });
  return {
    coordenacoes: {
      ensino: { nome: 'Ensino', ordem: 1, equipes: { [EQ]: 'Diagramação', revisao: 'Revisão' } },
      outra:  { nome: 'Outra',  ordem: 2, equipes: { audiovisual: 'Audiovisual' } },
    },
    usuarios: {
      [ANA]:   { nome: 'Ana',      email: 'ana@fatecie.edu.br',      papel: 'colaborador', equipeId: EQ },
      [BIA]:   { nome: 'Bia',      email: 'bia@fatecie.edu.br',      papel: 'colaborador', equipeId: EQ },
      [GEST]:  { nome: 'Gestora',  email: 'gestora@fatecie.edu.br',  papel: 'gestora',     equipeId: EQ },
      [COORD]: { nome: 'Coord',    email: 'coord@fatecie.edu.br',    papel: 'coordenador', equipeId: EQ, coordenacaoId: 'ensino' },
      [CFG]:   { nome: 'Cfg',      email: 'cfg@fatecie.edu.br',      papel: 'colaborador', equipeId: EQ },
      [TMP]:   { nome: 'Tmp',      email: 'tmp@fatecie.edu.br',      papel: 'colaborador', equipeId: EQ },
      [ADMIN]: { nome: 'Admin',    email: 'admin@fatecie.edu.br',    papel: 'admin',       equipeId: EQ },
      [RH]:    { nome: 'Rh',       email: 'rh@fatecie.edu.br',       papel: 'rh',          equipeId: '-' },
      [RHEQ]:  { nome: 'RhEq',     email: 'rheq@fatecie.edu.br',     papel: 'rh',          equipeId: EQ },
    },
    equipes: {
      audiovisual: { config: { metas: { horasDia: 8 } } },   // equipe de OUTRA coordenação
      [EQ]: {
        config: {
          usuarios: {
            [ANA]:  colab('ana', 'Ana'),
            [BIA]:  colab('bia', 'Bia'),
            [GEST]: { ...colab('gestora', 'Gestora'), papel: 'gestora' },
            [CFG]:  { ...colab('cfg', 'Cfg'), papel: 'gestora' },
            [TMP]:  { ...colab('tmp', 'Tmp'), gestorTemp: true },
          },
          metas: { horasDia: 9, threshold: 90, janelaEdicao: 7 },
        },
        // registro de ponto: um de cada colaborador
        entries: {
          e_ana: { task: 'Diagramar aula 1', project: 'p1', collab: 'ana', obs: '',
                   startTime: 1750000000000, endTime: 1750003600000, duration: 3600000,
                   createdAt: 1750000000000 },
          e_bia: { task: 'Revisar aula 2',   project: 'p1', collab: 'bia', obs: '',
                   startTime: 1750000000000, endTime: 1750003600000, duration: 3600000,
                   createdAt: 1750000000000 },
        },
        // um card SEM avaliação e um card JÁ avaliado (o caso da decisão D6)
        kanban: {
          k_livre: { name: 'Card sem nota', column: 'fazendo', assignee: 'ana',
                     history: { 0: { action: 'Criado', by: 'ana', ts: 1750000000000 } },
                     workers: { ana: 60 }, updatedAt: 1750000000000 },
          k_nota:  { name: 'Card avaliado', column: 'concluido', assignee: 'ana',
                     ajuste_diagramacao: 'excelente', ajuste_diagramacao_obs: 'ótimo',
                     ajuste_avaliado_em: 1750000000000,
                     history: { 0: { action: 'Criado', by: 'ana', ts: 1750000000000 } },
                     updatedAt: 1750000000000 },
        },
        arquivo: {
          a_nota: { name: 'Arquivado avaliado', module: 'MOD1', assignee: 'bia',
                    ajuste_diagramacao: 'bom', archivedAt: 1750000000000 },
        },
        mural: {
          m_ana: { text: 'post da Ana', collab: 'ana', ts: 1750000000000 },
          m_bia: { text: 'post da Bia', collab: 'bia', ts: 1750000000000 },
        },
        logs: { l1: { ts: 1750000000000, cat: 'criar', who: 'ana', action: 'Criou card' } },
        notifs: { n1: { to: 'ana', title: 'Oi', msg: 'tudo bem', from: 'gestora', ts: 1750000000000, read: false } },
        approvalRequests: {
          r_bia: { type: 'edit', entryKey: 'e_bia', payload: { collab: 'bia', task: 'x' }, requestedBy: 'bia',
                   requestedByEmail: 'bia@fatecie.edu.br', requestedAt: 1750000000000, status: 'pending' },
        },
        folgas: { '2026-09-01': { bia: { label: 'Atestado', type: 'atestado' } } },
      },
    },
    pwdReset: {},
    error_logs: {},
  };
}

// atalhos de contexto
const db  = (uid) => env.authenticatedContext(uid).database();
const ref = (uid, p) => db(uid).ref(p);

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-kronos',
    database: {
      host: HOST, port: PORT,
      rules: readFileSync(new URL('../database.rules.json', import.meta.url), 'utf8'),
    },
  });
});

// Cada teste comeca do mesmo estado. Sem isto a suite fica dependente de ordem:
// o teste de clearMural, por exemplo, apaga posts que outro teste espera achar.
beforeEach(async () => {
  await env.clearDatabase();
  await env.withSecurityRulesDisabled(async (ctx) => {
    await ctx.database().ref().set(seed());
  });
});

after(async () => { if (env) await env.cleanup(); });

// ═════════════════════════════════════════════════════════════════════════════
// B1 · Escalada de privilégio na criação de usuário            (CRÍTICA)
// ═════════════════════════════════════════════════════════════════════════════
describe('B1 · criação de usuário com papel arbitrário', () => {
  it('ATAQUE: gestora NÃO pode criar usuário com papel admin', async () => {
    await assertFails(ref(GEST, `usuarios/${NOVO}`).set({
      nome: 'Fantasma', email: 'f@fatecie.edu.br', papel: 'admin', equipeId: EQ,
    }));
  });

  it('ATAQUE: coordenador NÃO pode criar usuário com papel admin', async () => {
    await assertFails(ref(COORD, `usuarios/${NOVO}`).set({
      nome: 'Fantasma', email: 'f@fatecie.edu.br', papel: 'admin', equipeId: EQ,
    }));
  });

  it('ATAQUE: gestora NÃO pode criar usuário com papel rh', async () => {
    await assertFails(ref(GEST, `usuarios/${NOVO}`).set({
      nome: 'Fantasma', email: 'f@fatecie.edu.br', papel: 'rh', equipeId: EQ,
    }));
  });

  it('ATAQUE: papel fora da lista de permissão é recusado até para admin', async () => {
    await assertFails(ref(ADMIN, `usuarios/${NOVO}`).set({
      nome: 'X', email: 'x@fatecie.edu.br', papel: 'superadmin', equipeId: EQ,
    }));
  });

  it('NAO-REGRESSAO: gestora cria colaborador na própria equipe', async () => {
    await assertSucceeds(ref(GEST, 'usuarios/uid_novo_colab').set({
      nome: 'Novo', email: 'novo@fatecie.edu.br', papel: 'colaborador', equipeId: EQ,
    }));
  });

  it('NAO-REGRESSAO: colaborador edita o próprio nome sem mexer em papel/equipe', async () => {
    await assertSucceeds(ref(ANA, `usuarios/${ANA}`).update({ nome: 'Ana Maria' }));
  });

  it('ATAQUE: gestora NÃO pode gravar papel admin direto no filho (update)', async () => {
    await assertFails(ref(GEST, `usuarios/${NOVO}`).update({ papel: 'admin', equipeId: EQ }));
  });

  it('NAO-REGRESSAO: coordenador cria colaborador em equipe da sua coordenação', async () => {
    await assertSucceeds(ref(COORD, 'usuarios/uid_novo_colab').set({
      nome: 'Novo', email: 'novo@fatecie.edu.br', papel: 'colaborador', equipeId: EQ,
    }));
  });

  it('NAO-REGRESSAO: admin cria gestora (papel da lista)', async () => {
    await assertSucceeds(ref(ADMIN, 'usuarios/uid_nova_gestora').set({
      nome: 'G', email: 'g@fatecie.edu.br', papel: 'gestora', equipeId: EQ,
    }));
  });

  it('ATAQUE: gestora NÃO pode criar usuário com papel gestora', async () => {
    await assertFails(ref(GEST, `usuarios/${NOVO}`).set({
      nome: 'Fantasma', email: 'f@fatecie.edu.br', papel: 'gestora', equipeId: EQ,
    }));
  });

  it('ATAQUE: coordenador NÃO pode criar usuário com papel coordenador', async () => {
    await assertFails(ref(COORD, `usuarios/${NOVO}`).set({
      nome: 'Fantasma', email: 'f@fatecie.edu.br', papel: 'coordenador', equipeId: EQ,
    }));
  });

  it('ATAQUE: colaborador NÃO promove a si mesmo (confirmado em emulador antes)', async () => {
    await assertFails(ref(ANA, `usuarios/${ANA}/papel`).set('admin'));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// C4 · entries: sobrescrita confere o dono novo, não o atual   (CRÍTICA)
// ═════════════════════════════════════════════════════════════════════════════
describe('C4 · sobrescrita de registro de ponto alheio', () => {
  it('ATAQUE: Ana NÃO pode gravar por cima do registro da Bia pondo a própria collab', async () => {
    await assertFails(ref(ANA, `equipes/${EQ}/entries/e_bia`).set({
      task: 'sequestrado', project: 'p1', collab: 'ana', obs: '',
      startTime: 1750000000000, endTime: 1750003600000, duration: 3600000,
      createdAt: 1750000000000,
    }));
  });

  it('ATAQUE: Ana NÃO pode trocar só o campo collab de um registro alheio', async () => {
    await assertFails(ref(ANA, `equipes/${EQ}/entries/e_bia`).update({ collab: 'ana' }));
  });

  it('ATAQUE: Ana NÃO pode apagar o registro da Bia', async () => {
    await assertFails(ref(ANA, `equipes/${EQ}/entries/e_bia`).remove());
  });

  it('NAO-REGRESSAO: Ana cria o próprio registro', async () => {
    await assertSucceeds(ref(ANA, `equipes/${EQ}/entries/e_ana_novo`).set({
      task: 'Nova tarefa', project: 'p1', collab: 'ana', obs: '',
      startTime: 1750007200000, endTime: 1750010800000, duration: 3600000,
      createdAt: 1750007200000,
    }));
  });

  it('NAO-REGRESSAO: Ana edita o próprio registro', async () => {
    await assertSucceeds(ref(ANA, `equipes/${EQ}/entries/e_ana`).update({ task: 'Editado' }));
  });

  // Apaga 'e_ana', que vem semeado. Antes apontava para 'e_ana_novo', criado por
  // OUTRO teste -- com o re-seed por teste (beforeEach) ele nao existe mais, e
  // apagar no vazio e negado porque data.child('collab') vira null.
  it('NAO-REGRESSAO: Ana apaga o próprio registro', async () => {
    await assertSucceeds(ref(ANA, `equipes/${EQ}/entries/e_ana`).remove());
  });

  it('NAO-REGRESSAO: gestora corrige o registro de um colaborador', async () => {
    await assertSucceeds(ref(GEST, `equipes/${EQ}/entries/e_bia`).update({ task: 'Corrigido pela gestão' }));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// C1/C3 · kanban, arquivo e mural: escrita no nó pai           (CRÍTICA)
// ═════════════════════════════════════════════════════════════════════════════
describe('C1 · kanban: nó coletivo e campos de avaliação', () => {
  it('ATAQUE: colaborador NÃO pode apagar o quadro inteiro', async () => {
    await assertFails(ref(ANA, `equipes/${EQ}/kanban`).set(null));
  });

  it('ATAQUE: colaborador NÃO pode gravar a própria avaliação', async () => {
    await assertFails(ref(ANA, `equipes/${EQ}/kanban/k_livre`).update({
      ajuste_diagramacao: 'excelente', ajuste_avaliado_em: 1750100000000,
    }));
  });

  it('ATAQUE: colaborador NÃO pode alterar avaliação existente', async () => {
    await assertFails(ref(ANA, `equipes/${EQ}/kanban/k_nota`).update({
      ajuste_diagramacao: 'ruim'  /* valor DIFERENTE do semeado: igual seria o caso D6 (inalterado) */,
    }));
  });

  it('ATAQUE: colaborador NÃO pode APAGAR avaliação existente', async () => {
    await assertFails(ref(ANA, `equipes/${EQ}/kanban/k_nota`).update({
      ajuste_diagramacao: null, ajuste_diagramacao_obs: null,
    }));
  });

  it('ATAQUE: colaborador NÃO pode criar card já com avaliação (D7)', async () => {
    await assertFails(ref(ANA, `equipes/${EQ}/kanban/k_forjado`).set({
      name: 'Card forjado', column: 'fazendo', assignee: 'ana',
      ajuste_diagramacao: 'excelente', updatedAt: 1750100000000,
    }));
  });

  it('NAO-REGRESSAO: colaborador cria card sem avaliação', async () => {
    await assertSucceeds(ref(ANA, `equipes/${EQ}/kanban/k_novo`).set({
      name: 'Card novo', column: 'fazer', assignee: 'ana',
      history: { 0: { action: 'Criado', by: 'ana', ts: 1750100000000 } },
      updatedAt: 1750100000000,
    }));
  });

  it('NAO-REGRESSAO: colaborador move card SEM avaliação (grava o card inteiro)', async () => {
    await assertSucceeds(ref(ANA, `equipes/${EQ}/kanban/k_livre`).set({
      name: 'Card sem nota', column: 'revisao', assignee: 'ana',
      history: { 0: { action: 'Criado', by: 'ana', ts: 1750000000000 },
                 1: { action: 'Movido para revisao', by: 'ana', ts: 1750100000000 } },
      workers: { ana: 60 }, updatedAt: 1750100000000,
    }));
  });

  // Este é o teste da decisão D6: sem tolerância a valor inalterado, mover um
  // card já avaliado falharia para o colaborador e derrubaria a operação.
  it('NAO-REGRESSAO (D6): colaborador move card JÁ AVALIADO preservando a nota', async () => {
    await assertSucceeds(ref(ANA, `equipes/${EQ}/kanban/k_nota`).set({
      name: 'Card avaliado', column: 'liberacao', assignee: 'ana',
      ajuste_diagramacao: 'excelente', ajuste_diagramacao_obs: 'ótimo',
      ajuste_avaliado_em: 1750000000000,
      history: { 0: { action: 'Criado', by: 'ana', ts: 1750000000000 },
                 1: { action: 'Movido para liberacao', by: 'ana', ts: 1750100000000 } },
      updatedAt: 1750100000000,
    }));
  });

  it('NAO-REGRESSAO: colaborador remove card avaliado do kanban (arquivar na lixeira)', async () => {
    await assertSucceeds(ref(ANA, `equipes/${EQ}/kanban/k_nota`).remove());
  });

  it('NAO-REGRESSAO: colaborador lança horas em workers com a própria chave', async () => {
    await assertSucceeds(ref(ANA, `equipes/${EQ}/kanban/k_livre/workers/ana`).set(120));
  });

  it('NAO-REGRESSAO: gestora avalia um card', async () => {
    await assertSucceeds(ref(GEST, `equipes/${EQ}/kanban/k_livre`).update({
      ajuste_diagramacao: 'bom', ajuste_avaliado_em: 1750100000000,
    }));
  });

  it('NAO-REGRESSAO: gestora apaga uma avaliação', async () => {
    await assertSucceeds(ref(GEST, `equipes/${EQ}/kanban/k_livre`).update({
      ajuste_diagramacao: null, ajuste_diagramacao_obs: null,
    }));
  });
});

describe('C1 · mural: posse do post', () => {
  it('ATAQUE: colaborador NÃO pode apagar o mural inteiro', async () => {
    await assertFails(ref(ANA, `equipes/${EQ}/mural`).set(null));
  });

  it('ATAQUE: Ana NÃO pode apagar o post da Bia', async () => {
    await assertFails(ref(ANA, `equipes/${EQ}/mural/m_bia`).remove());
  });

  it('ATAQUE: Ana NÃO pode publicar post assinado como a Bia', async () => {
    await assertFails(ref(ANA, `equipes/${EQ}/mural/m_forjado`).set({
      text: 'não fui eu', collab: 'bia', ts: 1750100000000,
    }));
  });

  it('NAO-REGRESSAO: Ana publica o próprio post', async () => {
    await assertSucceeds(ref(ANA, `equipes/${EQ}/mural/m_ana2`).set({
      text: 'meu post', collab: 'ana', ts: 1750100000000,
    }));
  });

  // Apaga 'm_ana' (semeado): m_ana2 so existe dentro de outro teste, e o beforeEach re-semeia.
  it('NAO-REGRESSAO: Ana apaga o próprio post', async () => {
    await assertSucceeds(ref(ANA, `equipes/${EQ}/mural/m_ana`).remove());
  });

  it('NAO-REGRESSAO: gestora apaga post de colaborador', async () => {
    await assertSucceeds(ref(GEST, `equipes/${EQ}/mural/m_bia`).remove());
  });

  it('NAO-REGRESSAO: gestora limpa o mural inteiro (clearMural)', async () => {
    await assertSucceeds(ref(GEST, `equipes/${EQ}/mural`).set(null));
  });
});

describe('C1 · arquivo: nó coletivo e avaliação', () => {
  it('ATAQUE: colaborador NÃO pode apagar o arquivo inteiro', async () => {
    await assertFails(ref(ANA, `equipes/${EQ}/arquivo`).set(null));
  });

  it('ATAQUE: colaborador NÃO pode alterar avaliação de card arquivado', async () => {
    await assertFails(ref(ANA, `equipes/${EQ}/arquivo/a_nota`).update({
      ajuste_diagramacao: 'excelente',
    }));
  });

  // Decisão D7: em arquivo o card NASCE por movimento, trazendo a nota consigo.
  it('NAO-REGRESSAO (D7): colaborador arquiva card que já tem nota', async () => {
    await assertSucceeds(ref(ANA, `equipes/${EQ}/arquivo/a_movido`).set({
      name: 'Card avaliado', module: 'MOD1', assignee: 'ana',
      ajuste_diagramacao: 'excelente', archivedAt: 1750100000000,
    }));
  });

  it('NAO-REGRESSAO: gestora desarquiva (apaga do arquivo)', async () => {
    await assertSucceeds(ref(GEST, `equipes/${EQ}/arquivo/a_movido`).remove());
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// E7 · forma de assignee / history / workers  (camada 3 da decisão D5)
// ═════════════════════════════════════════════════════════════════════════════
describe('E7 · forma dos campos que alimentam o render do Kanban', () => {
  it('ATAQUE: assignee com HTML é recusado', async () => {
    await assertFails(ref(ANA, `equipes/${EQ}/kanban/k_livre/assignee`)
      .set('<img src=x onerror=alert(1)>'));
  });

  it('ATAQUE: history[].by com HTML é recusado', async () => {
    await assertFails(ref(ANA, `equipes/${EQ}/kanban/k_livre/history/0/by`)
      .set('<img src=x onerror=alert(1)>'));
  });

  it('ATAQUE: chave de workers com HTML é recusada', async () => {
    await assertFails(ref(ANA, `equipes/${EQ}/kanban/k_livre/workers`)
      .update({ '<script>x</script>': 10 }));
  });

  it('NAO-REGRESSAO: assignee com chave válida é aceito', async () => {
    await assertSucceeds(ref(ANA, `equipes/${EQ}/kanban/k_livre/assignee`).set('bia'));
  });

  it('NAO-REGRESSAO: assignee vazio (card sem responsável) é aceito', async () => {
    await assertSucceeds(ref(ANA, `equipes/${EQ}/kanban/k_livre/assignee`).set(''));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// E7 · formato da CHAVE (vetor onclick="...('${key}')" no render)
// ═════════════════════════════════════════════════════════════════════════════
describe('E7 · formato das chaves de card, comentário e post', () => {
  const MAL = "x');alert(1);"; // sem '/', que o RTDB usa como separador de caminho
  const PUSH = '-NaBc123_x';
  const card = { name: 'C', column: 'fazer', assignee: 'ana', updatedAt: 1750100000000 };

  it('ATAQUE: chave de card com JS é recusada em kanban', async () => {
    await assertFails(ref(ANA, `equipes/${EQ}/kanban/${MAL}`).set(card));
  });

  it('ATAQUE: chave de card com JS é recusada em arquivo', async () => {
    await assertFails(ref(ANA, `equipes/${EQ}/arquivo/${MAL}`).set(card));
  });

  it('ATAQUE: chave de comentário com JS é recusada', async () => {
    await assertFails(ref(ANA, `equipes/${EQ}/kanban/k_livre/comments`).update({
      [MAL]: { text: 'x', by: 'ana', ts: 1750100000000 },
    }));
  });

  it('ATAQUE: chave de post do mural com JS é recusada', async () => {
    await assertFails(ref(ANA, `equipes/${EQ}/mural/${MAL}`).set({
      text: 'x', collab: 'ana', ts: 1750100000000,
    }));
  });

  it('ATAQUE: chave de card com mais de 64 caracteres é recusada', async () => {
    await assertFails(ref(ANA, `equipes/${EQ}/kanban/${'a'.repeat(65)}`).set(card));
  });

  it('NAO-REGRESSAO: chave estilo push() é aceita em kanban, arquivo e mural', async () => {
    await assertSucceeds(ref(ANA, `equipes/${EQ}/kanban/${PUSH}`).set(card));
    await assertSucceeds(ref(ANA, `equipes/${EQ}/arquivo/${PUSH}`).set(card));
    await assertSucceeds(ref(ANA, `equipes/${EQ}/mural/${PUSH}`).set({ text: 'x', collab: 'ana', ts: 1750100000000 }));
  });

  it('NAO-REGRESSAO: comentário com chave c<Date.now()> é aceito', async () => {
    await assertSucceeds(ref(ANA, `equipes/${EQ}/kanban/k_livre/comments/c1750100000000`).set({
      text: 'ok', by: 'ana', ts: 1750100000000,
    }));
  });

  it('NAO-REGRESSAO: gestora reorganiza arquivo por update multi-path (`${k}/module`)', async () => {
    await assertSucceeds(ref(GEST, `equipes/${EQ}/arquivo`).update({
      'a_nota/module': 'MOD2', 'a_nota/reorganizadoEm': 1750100000000,
    }));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// F1 · gestão = a mesma de `entries` (papel de config da equipe e gestorTemp)
// ═════════════════════════════════════════════════════════════════════════════
describe('F1 · gestora só de config/usuarios e gestorTemp', () => {
  for (const [nome, uid] of [['gestora só de config', CFG], ['gestorTemp', TMP]]) {
    it(`NAO-REGRESSAO: ${nome} avalia card no kanban`, async () => {
      await assertSucceeds(ref(uid, `equipes/${EQ}/kanban/k_livre`).update({
        ajuste_diagramacao: 'bom', ajuste_avaliado_em: 1750100000000,
      }));
    });

    it(`NAO-REGRESSAO: ${nome} restaura card com avaliação no kanban`, async () => {
      await assertSucceeds(ref(uid, `equipes/${EQ}/kanban/k_restaurado`).set({
        name: 'Restaurado', column: 'concluido', assignee: 'ana',
        ajuste_diagramacao: 'bom', updatedAt: 1750100000000,
      }));
    });

    it(`NAO-REGRESSAO: ${nome} altera avaliação de card arquivado`, async () => {
      await assertSucceeds(ref(uid, `equipes/${EQ}/arquivo/a_nota`).update({ ajuste_diagramacao: 'ruim' }));
    });

    it(`NAO-REGRESSAO: ${nome} limpa o mural inteiro`, async () => {
      await assertSucceeds(ref(uid, `equipes/${EQ}/mural`).set(null));
    });
  }

  it('NAO-REGRESSAO: gestora só de config apaga post de colaborador', async () => {
    await assertSucceeds(ref(CFG, `equipes/${EQ}/mural/m_bia`).remove());
  });

  it('ATAQUE: colaborador sem papel de gestão NÃO altera ajuste_curadoria', async () => {
    await assertFails(ref(ANA, `equipes/${EQ}/kanban/k_livre`).update({ ajuste_curadoria: 'bom' }));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Invariantes que JÁ funcionam — guarda contra regressão da onda
// ═════════════════════════════════════════════════════════════════════════════
describe('Invariantes já corretas (não podem regredir)', () => {
  it('isolamento entre equipes: colaborador não lê outra equipe', async () => {
    await assertFails(ref(ANA, 'equipes/revisao/entries').once('value'));
  });

  it('acesso não autenticado é negado', async () => {
    const anon = env.unauthenticatedContext().database();
    await assertFails(anon.ref('coordenacoes').once('value'));
    await assertFails(anon.ref(`equipes/${EQ}`).once('value'));
  });

  it('nó não previsto não aceita escrita (default fechado)', async () => {
    await assertFails(ref(ANA, `equipes/${EQ}/foobar`).set({ x: 1 }));
    await assertFails(ref(ANA, 'equipes/equipe_nova').set({ x: 1 }));
  });

  it('limite de tamanho resiste a escrita de campo isolado', async () => {
    await assertFails(ref(ANA, `equipes/${EQ}/entries/e_ana/task`).set('x'.repeat(5000)));
  });

  it('activeTimers e avatars amarram a chave ao próprio usuário', async () => {
    await assertFails(ref(ANA, `equipes/${EQ}/activeTimers/bia`).set({ startTime: 1 }));
    await assertFails(ref(ANA, `equipes/${EQ}/avatars/bia`).update({ emoji: '😀' }));
    await assertSucceeds(ref(ANA, `equipes/${EQ}/avatars/ana`).update({ emoji: '😀' }));
  });

  it('log é append-only para colaborador', async () => {
    await assertSucceeds(ref(ANA, `equipes/${EQ}/logs/l_novo`)
      .set({ ts: 1750100000000, cat: 'criar', action: 'Criou algo' }));
    await assertFails(ref(ANA, `equipes/${EQ}/logs/l1`).update({ action: 'adulterado' }));
    await assertFails(ref(ANA, `equipes/${EQ}/logs/l1`).remove());
  });

  it('pwdReset amarrado ao próprio UID', async () => {
    await assertSucceeds(ref(ANA, `pwdReset/${ANA}`).set(1750100000000));
    await assertFails(ref(ANA, `pwdReset/${BIA}`).set(1750100000000));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ONDA 2 · perfil, coordenações, pwdReset, gestorTemp
// ═════════════════════════════════════════════════════════════════════════════
describe('A1 · coordenacaoId congelado fora do admin', () => {
  it('ATAQUE: coordenador NÃO troca a própria coordenacaoId', async () => {
    await assertFails(ref(COORD, `usuarios/${COORD}`).update({ coordenacaoId: 'outra' }));
  });

  it('ATAQUE: colaborador NÃO se atribui coordenacaoId', async () => {
    await assertFails(ref(ANA, `usuarios/${ANA}`).update({ coordenacaoId: 'ensino' }));
  });

  it('ATAQUE: gestora NÃO cria colaborador já com coordenacaoId', async () => {
    await assertFails(ref(GEST, 'usuarios/uid_novo_colab').set({
      nome: 'N', email: 'n@fatecie.edu.br', papel: 'colaborador', equipeId: EQ, coordenacaoId: 'outra',
    }));
  });

  it('NAO-REGRESSAO: coordenador regrava o próprio perfil inalterado e muda o nome', async () => {
    await assertSucceeds(ref(COORD, `usuarios/${COORD}`).set({
      nome: 'Coord Novo', email: 'coord@fatecie.edu.br', papel: 'coordenador', equipeId: EQ, coordenacaoId: 'ensino',
    }));
  });

  it('NAO-REGRESSAO: admin muda a coordenacaoId do coordenador', async () => {
    await assertSucceeds(ref(ADMIN, `usuarios/${COORD}`).update({ coordenacaoId: 'outra' }));
  });

  it('NAO-REGRESSAO: admin cria coordenador com coordenacaoId (cfgCriarCoordenador)', async () => {
    await assertSucceeds(ref(ADMIN, 'usuarios/uid_novo_coord').set({
      nome: 'C', email: 'c@fatecie.edu.br', papel: 'coordenador', equipeId: EQ, coordenacaoId: 'ensino', equipes: [EQ, 'revisao'],
    }));
  });
});

describe('A5 · leitura de /coordenacoes só para quem precisa', () => {
  it('ATAQUE: colaborador NÃO lê /coordenacoes', async () => {
    await assertFails(ref(ANA, 'coordenacoes').once('value'));
  });

  for (const [nome, uid] of [['gestora', GEST], ['coordenador', COORD], ['admin', ADMIN], ['rh', RH]]) {
    it(`NAO-REGRESSAO: ${nome} lê /coordenacoes (loadCoordenacoes)`, async () => {
      await assertSucceeds(ref(uid, 'coordenacoes').once('value'));
    });
  }
});

describe('B5 · pwdReset: só valor plausível', () => {
  it('ATAQUE: valor absurdo (futuro distante) é recusado', async () => {
    await assertFails(ref(ANA, `pwdReset/${ANA}`).set(99999999999999));
  });

  it('ATAQUE: valor ínfimo é recusado', async () => {
    await assertFails(ref(ANA, `pwdReset/${ANA}`).set(1));
  });

  it('NAO-REGRESSAO: Date.now() do cliente é aceito', async () => {
    await assertSucceeds(ref(ANA, `pwdReset/${ANA}`).set(Date.now()));
  });
  // Limite aceito: o próprio usuário ainda grava o marcador (a correção real = Cloud Function).
});

describe('B6 · gestorTemp: boolean e só a gestão concede', () => {
  const cu = (u) => `equipes/${EQ}/config/usuarios/${u}/gestorTemp`;

  it('ATAQUE: quem tem gestorTemp NÃO concede a outro', async () => {
    await assertFails(ref(TMP, cu(ANA)).set(true));
  });

  it('ATAQUE: quem tem gestorTemp NÃO concede em set do nó inteiro', async () => {
    await assertFails(ref(TMP, `equipes/${EQ}/config/usuarios/${BIA}`).update({ gestorTemp: true }));
  });

  it('ATAQUE: gestorTemp não-boolean é recusado até para a gestora', async () => {
    await assertFails(ref(GEST, cu(ANA)).set('sim'));
    await assertFails(ref(GEST, cu(ANA)).set(1));
  });

  for (const [nome, uid] of [['gestora', GEST], ['coordenador', COORD], ['admin', ADMIN]]) {
    it(`NAO-REGRESSAO: ${nome} concede gestorTemp`, async () => {
      await assertSucceeds(ref(uid, cu(ANA)).set(true));
    });
  }

  it('NAO-REGRESSAO: gestora salva a linha (saveColab grava gestorTemp:false)', async () => {
    await assertSucceeds(ref(GEST, `equipes/${EQ}/config/usuarios/${ANA}`).update({
      nome: 'Ana', papel: 'colaborador', cor: '#94A3B8', ativo: true, gestorTemp: false,
    }));
  });

  it('NAO-REGRESSAO: quem tem gestorTemp salva linha sem mudar o gestorTemp, e revoga', async () => {
    await assertSucceeds(ref(TMP, `equipes/${EQ}/config/usuarios/${TMP}`).update({ gestorTemp: true, cor: '#111111' }));
    await assertSucceeds(ref(TMP, cu(TMP)).set(false));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ONDA 2 · alcance de leitura/escrita: A3, A2, A6
// ═════════════════════════════════════════════════════════════════════════════
describe('A3 · sem fail-open com /coordenacoes vazio', () => {
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => { await ctx.database().ref('coordenacoes').remove(); });
  });

  it('ATAQUE: coordenador NÃO lê equipe alheia sem /coordenacoes', async () => {
    await assertFails(ref(COORD, 'equipes/audiovisual/config').once('value'));
  });

  it('ATAQUE: coordenador NÃO escreve holidays/folgas/capDia/indicadores em equipe alheia', async () => {
    await assertFails(ref(COORD, 'equipes/audiovisual/holidays/2026-01-01').set({ label: 'x' }));
    await assertFails(ref(COORD, 'equipes/audiovisual/folgas/2026-01-01/x').set({ label: 'x' }));
    await assertFails(ref(COORD, 'equipes/audiovisual/capDia/2026-01-01/x').set(true));
    await assertFails(ref(COORD, 'equipes/audiovisual/indicadoresManuais/i1').set({ name: 'x' }));
    await assertFails(ref(COORD, 'equipes/audiovisual/config/metas').set({ horasDia: 1 }));
  });

  it('NAO-REGRESSAO: coordenador continua lendo a própria equipe (equipeId)', async () => {
    await assertSucceeds(ref(COORD, `equipes/${EQ}/config`).once('value'));
  });
});

describe('A3 · com /coordenacoes, coordenador alcança só a sua coordenação', () => {
  it('NAO-REGRESSAO: coordenador lê/escreve equipe da sua coordenação', async () => {
    await assertSucceeds(ref(COORD, 'equipes/revisao/config').once('value'));
    await assertSucceeds(ref(COORD, 'equipes/revisao/holidays/2026-01-01').set({ label: 'x' }));
  });

  it('ATAQUE: coordenador NÃO lê equipe de outra coordenação', async () => {
    await assertFails(ref(COORD, 'equipes/audiovisual/config').once('value'));
  });
});

describe('A2 · log de auditoria fora da cascata de leitura', () => {
  it('ATAQUE: colaborador, gestora e coordenador NÃO leem o log', async () => {
    for (const u of [ANA, GEST, COORD, RH]) await assertFails(ref(u, `equipes/${EQ}/logs`).once('value'));
  });

  it('ATAQUE: colaborador NÃO lê a equipe inteira (cascata do pai)', async () => {
    await assertFails(ref(ANA, `equipes/${EQ}`).once('value'));
  });

  it('NAO-REGRESSAO: admin lê o log', async () => {
    await assertSucceeds(ref(ADMIN, `equipes/${EQ}/logs`).once('value'));
  });

  for (const nó of ['config', 'entries', 'approvalRequests', 'kanban', 'arquivo', 'mural', 'notifs', 'activeTimers',
    'avatars', 'desafio', 'holidays', 'folgas', 'customTags', 'removedDefaultTags', 'customProjects', 'users',
    'indicadoresManuais', 'capDia']) {
    it(`NAO-REGRESSAO: membro, coordenador e rh leem ${nó}`, async () => {
      for (const u of [ANA, GEST, COORD, RH]) await assertSucceeds(ref(u, `equipes/${EQ}/${nó}`).once('value'));
    });
  }

  it('NAO-REGRESSAO: consultas do app (notifs por to, entries por collab, approvals por requestedBy)', async () => {
    await assertSucceeds(ref(ANA, `equipes/${EQ}/notifs`).orderByChild('to').equalTo('ana').limitToLast(50).once('value'));
    await assertSucceeds(ref(ANA, `equipes/${EQ}/entries`).orderByChild('collab').equalTo('ana').once('value'));
    await assertSucceeds(ref(ANA, `equipes/${EQ}/approvalRequests`).orderByChild('requestedBy').equalTo('ana').once('value'));
    await assertSucceeds(ref(ANA, `equipes/${EQ}/mural`).orderByChild('ts').limitToLast(20).once('value'));
  });
});

describe('A6 · rh é somente leitura por regra (mesmo com equipe real)', () => {
  const card = { name: 'C', column: 'fazer', assignee: 'ana', updatedAt: 1750100000000 };

  it('ATAQUE: rh com equipe real NÃO escreve kanban/arquivo/notifs/approvalRequests', async () => {
    await assertFails(ref(RHEQ, `equipes/${EQ}/kanban/k_rh`).set(card));
    await assertFails(ref(RHEQ, `equipes/${EQ}/kanban/k_livre`).update({ column: 'revisao' }));
    await assertFails(ref(RHEQ, `equipes/${EQ}/arquivo/a_rh`).set(card));
    await assertFails(ref(RHEQ, `equipes/${EQ}/notifs/n_rh`).set({ to: 'ana', title: 'x', msg: 'y' }));
    await assertFails(ref(RHEQ, `equipes/${EQ}/approvalRequests/r_rh`).set({ type: 'edit', status: 'pending' }));
  });

  it('NAO-REGRESSAO: rh com equipe real lê e registra login no log', async () => {
    await assertSucceeds(ref(RHEQ, `equipes/${EQ}/kanban`).once('value'));
    await assertSucceeds(ref(RHEQ, `equipes/${EQ}/logs/l_rh`).set({ ts: 1750100000000, cat: 'login', action: 'Entrou no sistema' }));
  });

  it('NAO-REGRESSAO: colaborador continua escrevendo kanban', async () => {
    await assertSucceeds(ref(ANA, `equipes/${EQ}/kanban/k_novo2`).set(card));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ONDA 2 · autoria e forma: C2 approvalRequests, C6 notifs, C5 entries
// ═════════════════════════════════════════════════════════════════════════════
describe('C2 · approvalRequests amarrado ao autor', () => {
  const ar = (u, id, v) => ref(u, `equipes/${EQ}/approvalRequests/${id}`).set(v);
  const base = { requestedByEmail: 'ana@fatecie.edu.br', requestedAt: 1750100000000, status: 'pending' };

  it('ATAQUE: Ana NÃO cria pedido em nome da Bia', async () => {
    await assertFails(ar(ANA, 'r1', { ...base, type: 'edit', entryKey: 'e_ana', payload: { collab: 'ana' }, requestedBy: 'bia' }));
  });

  it('ATAQUE: Ana NÃO pede exclusão do registro da Bia', async () => {
    await assertFails(ar(ANA, 'r1', { ...base, type: 'delete', entryKey: 'e_bia', payload: { collab: 'bia' }, requestedBy: 'ana' }));
  });

  it('ATAQUE: Ana NÃO põe payload.collab de outra pessoa (ausência no nome da Bia)', async () => {
    await assertFails(ar(ANA, 'r1', { ...base, type: 'folga', payload: { tipo: 'atestado', isos: ['2026-09-02'], collab: 'bia' }, requestedBy: 'ana' }));
  });

  it('ATAQUE: pedido sem requestedBy é recusado', async () => {
    await assertFails(ar(ANA, 'r1', { ...base, type: 'new', entryKey: null, payload: { collab: 'ana' } }));
  });

  it('NAO-REGRESSAO: Ana pede edição do próprio registro', async () => {
    await assertSucceeds(ar(ANA, 'r1', { ...base, type: 'edit', entryKey: 'e_ana', payload: { collab: 'ana', task: 'x' }, requestedBy: 'ana' }));
  });

  it('NAO-REGRESSAO: Ana pede novo registro (entryKey null) e exclusão do próprio', async () => {
    await assertSucceeds(ar(ANA, 'r1', { ...base, type: 'new', entryKey: null, payload: { collab: 'ana', task: 'x' }, requestedBy: 'ana' }));
    await assertSucceeds(ar(ANA, 'r2', { ...base, type: 'delete', entryKey: 'e_ana', payload: { collab: 'ana', task: 'x' }, requestedBy: 'ana' }));
  });

  it('NAO-REGRESSAO: Ana solicita ausência (folga) em nome próprio', async () => {
    await assertSucceeds(ar(ANA, 'r1', { ...base, type: 'folga', payload: { tipo: 'atestado', label: 'x', isos: ['2026-09-02'], collab: 'ana' }, requestedBy: 'ana' }));
  });

  it('NAO-REGRESSAO: gestora recusa/aprova (remove o pedido) e admin cria', async () => {
    await assertSucceeds(ref(GEST, `equipes/${EQ}/approvalRequests/r_bia`).remove());
  });
});

describe('C6 · notifs.from amarrado ao autor', () => {
  const nf = (u, id, v) => ref(u, `equipes/${EQ}/notifs/${id}`).set(v);
  const n = { to: 'bia', title: 'Oi', msg: 'x', ts: 1750100000000, read: false };

  it('ATAQUE: Ana NÃO assina notificação como a gestora', async () => {
    await assertFails(nf(ANA, 'n2', { ...n, from: 'gestora' }));
  });

  it('ATAQUE: Ana NÃO reescreve from/to da notificação que recebeu', async () => {
    const base = { to: 'ana', title: 'Oi', msg: 'tudo bem', ts: 1750000000000, read: true };
    await assertFails(nf(ANA, 'n1', { ...base, from: 'admin' }));
    await assertFails(nf(ANA, 'n1', { ...base, from: 'gestora', to: 'bia' }));
  });

  it('NAO-REGRESSAO: Ana notifica a Bia assinando como ela mesma (ou sem from)', async () => {
    await assertSucceeds(nf(ANA, 'n2', { ...n, from: 'ana' }));
    await assertSucceeds(nf(ANA, 'n3', n));
  });

  it('NAO-REGRESSAO: gestora notifica; admin (sem chave) notifica', async () => {
    await assertSucceeds(nf(GEST, 'n2', { ...n, from: 'gestora' }));
    await assertSucceeds(nf(ADMIN, 'n3', { ...n, from: 'sistema' }));
  });

  it('NAO-REGRESSAO: Ana marca como lida (regrava a notificação inteira, com _key)', async () => {
    await assertSucceeds(nf(ANA, 'n1', { to: 'ana', title: 'Oi', msg: 'tudo bem', from: 'gestora', ts: 1750000000000, read: true, _key: 'n1' }));
  });
});

describe('C5 · entries: tipos e faixas, sem allowlist de nomes', () => {
  const e = { task: 'T', project: 'p1', collab: 'ana', obs: '', startTime: 1750007200000, endTime: 1750010800000,
              duration: 3600000, createdAt: 1750007200000 };
  const put = (v, id = 'e_novo') => ref(ANA, `equipes/${EQ}/entries/${id}`).set({ ...e, ...v });

  for (const [nome, v] of [
    ['duration string', { duration: '9999' }],
    ['duration negativa', { duration: -1 }],
    ['duration absurda', { duration: 1e12 }],
    ['peso string', { peso: '5' }],
    ['peso absurdo', { peso: 1000 }],
    ['peso negativo', { peso: -2 }],
    ['startTime string', { startTime: 'ontem' }],
    ['endTime absurdo', { endTime: 9e15 }],
    ['needsReview não-boolean', { needsReview: 'sim' }],
    ['importedFrom não-string', { importedFrom: 123 }],
    ['periods com duration absurda', { periods: [{ startTime: 1750007200000, endTime: 1750010800000, duration: 1e12 }] }],
  ]) {
    it(`ATAQUE: ${nome} é recusado`, async () => { await assertFails(put(v)); });
  }

  it('ATAQUE: Ana NÃO infla a duration do próprio registro existente', async () => {
    await assertFails(ref(ANA, `equipes/${EQ}/entries/e_ana`).update({ duration: 1e12 }));
  });

  it('NAO-REGRESSAO: registro completo com campos opcionais reais (peso, periods, tags, clockify)', async () => {
    await assertSucceeds(put({ peso: 7.2, tags: ['a'], needsReview: true, importedFrom: 'clockify_csv',
      createdBy: 'ana@fatecie.edu.br', kanbanCardKey: '-Nabc',
      periods: [{ startTime: 1750007200000, endTime: 1750010800000, duration: 3600000 }] }));
  });

  it('NAO-REGRESSAO: campo novo desconhecido continua aceito (sem allowlist)', async () => {
    await assertSucceeds(put({ campoNovoDoFuturo: 'x' }));
  });

  it('NAO-REGRESSAO: duration no maior valor real do snapshot (104220000) e peso 0', async () => {
    await assertSucceeds(put({ duration: 104220000, peso: 0 }));
  });

  it('NAO-REGRESSAO: reinício de timer regrava o registro com periods e duration somada', async () => {
    await assertSucceeds(ref(ANA, `equipes/${EQ}/entries/e_ana`).set({
      ...e, createdAt: 1750000000000, periods: [
        { startTime: 1750000000000, endTime: 1750003600000, duration: 3600000 },
        { startTime: 1750007200000, endTime: 1750010800000, duration: 3600000 }],
      duration: 7200000, endTime: 1750010800000, modifiedAt: 1750011000000, modifiedBy: 'ana@fatecie.edu.br',
    }));
  });
});

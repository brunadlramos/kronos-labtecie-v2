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
const NOVO  = 'uid_novo';     // conta que ainda não tem perfil em /usuarios

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
      [ADMIN]: { nome: 'Admin',    email: 'admin@fatecie.edu.br',    papel: 'admin',       equipeId: EQ },
    },
    equipes: {
      [EQ]: {
        config: {
          usuarios: {
            [ANA]:  colab('ana', 'Ana'),
            [BIA]:  colab('bia', 'Bia'),
            [GEST]: { ...colab('gestora', 'Gestora'), papel: 'gestora' },
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
        approvalRequests: {},
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
      ajuste_diagramacao: 'excelente',
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

  it('NAO-REGRESSAO: Ana apaga o próprio post', async () => {
    await assertSucceeds(ref(ANA, `equipes/${EQ}/mural/m_ana2`).remove());
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

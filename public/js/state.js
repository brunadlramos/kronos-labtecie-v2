// ── KRONOS · ESTADO COMPARTILHADO ────────────────────────────────────────────
// Objeto central de estado — todos os módulos importam como `state` e mutam
// suas propriedades. Como é um objeto (referência), mutações são visíveis
// em todos os módulos instantaneamente.
//
// MIGRATION COMPLETE: index_v2.js usa state.* para todas as variáveis globais

export const app = {

  // ── Equipe ────────────────────────────────────────────────────────────────
  EQUIPE_ID:        'diagramacao',
  EQUIPE_NOME:      'Equipe',
  EQUIPE_LABELS: {
    revisao:     'Revisão',
    diagramacao: 'Diagramação',
    audiovisual: 'Audiovisual',
    insercao:    'Inserção',
  },
  // Coordenações (departamentos) que agrupam equipes — carregadas de /coordenacoes.
  // Vazio = bootstrap legado (as 4 equipes acima formam a coordenação implícita).
  COORDENACOES:     {},            // {coordId: {nome, ordem, equipes:{equipeId:label}}}
  EQUIPE_COORD:     {},            // {equipeId: coordId} — a qual coordenação cada equipe pertence
  coordenacaoAtiva: null,          // departamento selecionado (admin) / coordenação do coordenador

  // ── Config da equipe (carregada do Firebase) ──────────────────────────────
  PROJECTS:         {},
  COLLABS:          {},
  COLLAB_EMAILS:    {},
  MANAGER_EMAILS:   [],
  AUDITOR_EMAILS:   [],
  MANAGER_PROFILES: {},
  KANBAN_ROLES:     { curadoras:[], recuradoria:[], gestora:[] },
  K_COLS:           [],
  DAILY_GOAL_MS:    9 * 3600000,   // 9h padrão
  PERF_THRESHOLD:   0.9,           // 90%
  EDIT_WINDOW_DAYS: 5,
  avaliacaoAtiva:   true,          // sistema de avaliação por estrelas ligado p/ esta equipe (A7)
  COLLAB_HOURS:     {},            // {collabKey: {horasDia, horasSemana}}
  _cfgMetasDias:    null,          // {seg:9, ter:9, ...}

  // ── Autenticação ──────────────────────────────────────────────────────────
  currentUser:      null,
  isManager:        false,
  isAuditor:        false,
  userPapel:        null,          // 'admin' | 'gestora' | 'colaborador' | 'auditor'
  userEquipes:      [],
  equipeAtiva:      null,
  currentCollabKey: null,

  // ── Dados Firebase (listeners) ────────────────────────────────────────────
  allEntries:       {},
  allApprovals:     {},
  activeTimers:     {},
  kanbanCards:      {},
  arquivoCards:     {},
  allHolidays:      {},
  customTags:       [],
  customProjects:   [],
  muralPosts:       {},
  allAvatars:       {},
  usersConfig:      {},            // {collabKey: {active: bool}}
  indicadoresManuais: {},          // demandas adicionadas manualmente (só Indicadores)
  capDia:           {},            // {dk: {collabKey: true}} — dias "fechados em 100%" pela gestora

  // ── Memoização de entries ─────────────────────────────────────────────────
  _entriesVersion:      0,
  _entriesArrayCache:   null,
  _entriesArrayVersion: -1,

  // ── Estado do timer ───────────────────────────────────────────────────────
  isRunning:   false,
  startTime:   null,
  elapsed:     0,
  intervalId:  null,
  editingId:   null,

  // ── Navegação / UI ────────────────────────────────────────────────────────
  viewDate:   new Date(),
  weekOffset: 0,
  projDate:   new Date(),
  dashDay:    (() => { const d=new Date(); d.setHours(0,0,0,0); return d; })(),
  charts:     {},

  // ── Handles de setInterval/setTimeout ────────────────────────────────────
  noActivityTimer:   null,
  _onlineAutoRefresh: null,

  // ── Kanban UI ─────────────────────────────────────────────────────────────
  kColState:          {},
  currentKanbanDetailId: null,

  // ── Demandas paginação ────────────────────────────────────────────────────
  _demandasPage:     1,
  _demandasPageSize: 50,
  _demandasSelected: new Set(),

  // ── Timer (adicionadas na migração de estado) ─────────────────────────────
  timerOperationInProgress: false,

  // ── Kanban extra ──────────────────────────────────────────────────────────
  _ajusteSavingKeys:    null,  // Set — inicializado abaixo
  kTimerState:          null,
  kTimerInterval:       null,
  editingKanbanId:      null,

  // ── Histórico e gráficos ──────────────────────────────────────────────────
  mdWeekOffset:  0,
  mdCharts:      {},
  chartsWeekOffset: 0,
  hist4Year:     new Date().getFullYear(),
  hist4Month:    new Date().getMonth(),
  relWeekOffset: 0,

};

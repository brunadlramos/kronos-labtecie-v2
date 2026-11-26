# PLANO DE CORREÇÃO DE SEGURANÇA — Kronos Labtecie v2

> **Documento-mestre vivo.** Marque os checkboxes conforme avança: o plano conta a
> verdade do estado, não a memória. Decisão superada é marcada como superada, nunca
> apagada.
>
> Rege este trabalho: `PLAYBOOK_ENGENHARIA.md` (como executar) e
> `PLAYBOOK_SEGURANCA.md` (o que proteger).
> Fonte dos achados: `docs/security-audit/relatorio-auditoria-seguranca.pdf` (v2, 32 achados).
> Plano anterior, que este documento **absorve e não substitui**: `MELHORIAS.md`.

**Onda 1 — os 4 críticos.** Escopo travado (mandamento 4): ideia nova no meio da onda
vai para o backlog da onda seguinte, nunca se injeta nesta.

| | |
|---|---|
| Branch | `seguranca/onda-1-criticos` |
| Escopo | **B1**, **C1/C3**, **C4** (regras) + **E7** (frontend) |
| Autoridade de deploy | Preparo → diff revisado pelo dono → **dono dá o OK** → eu deployo, uma onda por vez |
| Fora desta onda | P2 e P3 do relatório (A1, A2, A6, C2, C5, C6, D1, E8, E9, B4, B5, F1, F2, F3) |

---

## 0. Estado atual — o que já mudou

- [x] Auditoria concluída (32 achados, 20 pontos fortes, 3 remediados)
- [x] Branch `seguranca/onda-1-criticos` criada
- [x] Regras atuais preservadas em `docs/security-audit/database.rules.ANTES.json`
- [x] Revisão adversarial pré-código executada (ver §2, decisão **D5**)
- [ ] **Nada foi alterado em `database.rules.json`, `firebase.json` ou `public/`**
- [ ] **Nada foi deployado. O Firebase de produção está intocado.**

Editar arquivo no disco não muda nada em produção. As regras passam a valer só em
`firebase deploy --only database`; o frontend, só em `firebase deploy --only hosting`.

---

## 1. Modelo de ameaça

**Ativos reais.** Registro de ponto de 38 colaboradores identificados; avaliação de
desempenho por estrelas (base de decisão sobre pessoas); atestado médico por pessoa e
data (dado de saúde, LGPD); e-mail institucional; trilha de auditoria; a estrutura de
papéis que governa tudo isso.

**Pior caso real.** Não há custódia de dinheiro nem de chave privada — então não é
catastrófico no sentido do playbook. Mas é **grave**: comprometimento total do banco
por escalada de privilégio (B1), com leitura e escrita de dado pessoal sensível de
gente que não consentiu, e adulteração silenciosa da base que fundamenta avaliação de
desempenho. Calibro o esforço por aí: rigor de dado pessoal + integridade de aferição,
sem paranoia de custódia financeira.

**O atacante.** Uma conta autenticada legítima — colaborador ou gestora da própria
equipe. Não é um invasor externo: o acesso não autenticado está corretamente negado em
todas as 24 regras (ponto forte verificado). O atacante lê todo o JS servido, o
Network, o `localStorage` e o console — o frontend é público por construção.

**A fronteira.** Aplicando a **Regra nº 1 do playbook de segurança** a esta stack: não
há backend, então `database.rules.json` **é** o backend. Toda correção desta onda vive
nas regras. O frontend é conveniência; nenhuma correção pode depender só dele.

---

## 2. Decisões-chave

Decididas uma vez, registradas com o porquê, encerram re-litígio.

### D1 — Portão de testes antes do trabalho arriscado
**Escolha:** emulador oficial do Realtime Database + `@firebase/rules-unit-testing`,
montado **antes** de tocar nas regras.
**Por quê:** mandamento 5 do playbook. As regras são a única fronteira e hoje não têm
teste nenhum; sem rede, uma regressão reintroduz qualquer um dos 32 achados no próximo
deploy. É também a recomendação P3 do próprio relatório.
**Custo aceito:** exige JDK instalado (não há nenhum na máquina) — ver Fase 0.

### D2 — Produção nunca é cobaia
**Escolha:** todo desenvolvimento e teste contra o **emulador local**. O ensaio geral
antes do deploy roda contra uma **cópia** (projeto `kronos-fdb75`, alias `antigo`),
não contra `kronoslabtecie`.
**Por quê:** mandamento 3. Regra de RTDB deployada é instantânea e global — não existe
canário nem rollout gradual. Testar em produção é arriscar a operação da equipe.
**Pendência:** confirmar com o dono que `kronos-fdb75` está livre para servir de cópia.

### D3 — Fail-closed por padrão
**Escolha:** onde a regra hoje libera por falta de dado, passa a negar.
**Por quê:** mandamento 9. Um deploy que esqueça de configurar algo deve nascer
seguro, não aberto. Nesta onda isso aparece em: `kanban`, `arquivo` e `mural` perdem o
`.write` no nó coletivo (o cliente nunca escreve lá — é de graça); e o `.validate` de
papel passa a ser lista de permissão explícita, não lista de bloqueio.

### D4 — Backup e restauração são pré-requisito, não etapa 2
**Escolha:** snapshot fresco do RTDB **e** uma restauração de fato testada antes de
qualquer deploy de regra.
**Por quê:** mandamento 7, e o próprio `backups/README.md` do projeto registra a
pendência: *"Nenhuma restauração foi testada até hoje. Backup que nunca foi restaurado
é torcida, não backup."* As correções C4 e C1 são sobre integridade de dado. Isso
promove o item 4 do `MELHORIAS.md` de "semana 2" para pré-requisito.

### D5 — Kanban é colaborativo: a correção de C1 muda de forma
**⚠️ Esta decisão SUPERA a recomendação de C1/C3 escrita no relatório.**

**O que a revisão adversarial pré-código encontrou:** das 15 escritas do cliente no nó
`kanban`, **12 não têm nenhum gate de papel — de propósito**. Mover card
(`kanban.js:270`, `:532`), lançar horas (`:700`), concluir (`:734`), criar (`:1090`),
apagar card (`:1929`), arquivar na lixeira (`:2555`), finalizar timer
(`timer.js:170`). Só três são de gestão: `toggleUrgente` (`:747`), `clearLixeira`
(`:2602`) e `unarchiveKanbanCard` (`:2617`).

**Consequência:** "posse por card", como o relatório recomendou, **quebraria a operação
da equipe**. Um quadro Kanban é colaborativo por projeto; qualquer um move qualquer
card, e isso é o comportamento correto.

**Escolha:** a correção nesse nó é em três camadas, nenhuma delas posse por card:
1. **`.validate` por campo** — `ajuste_*` (a avaliação) só gravável por
   gestora / `gestorTemp` / admin. É isso que resolve o problema real (o avaliado
   editando a própria nota).
2. **Nó coletivo sem `.write`** — mata `set(kanbanRef, null)` e o apagamento em massa.
3. **`.validate` de forma** em `assignee`, `assignees`, `history[].by` e nas chaves de
   `workers` — fecha o vetor de **E7** na origem, além do `escH` no frontend.

No **`mural`** a posse *é* significativa e será aplicada (autor ou gestora), com o nó
coletivo liberado só para gestão — porque `clearMural` (`demandas.js:633`) é uma
operação legítima dela. No **`arquivo`**, escrita por item para a equipe e nó coletivo
fechado.

### D6 — `.validate` tem de tolerar valor inalterado
**Escolha:** todo `.validate` de campo restrito segue o padrão
`<gestão> || newData.val() === data.val()`.
**Por quê:** o cliente grava o **card inteiro** (`set(child(kanbanRef,key), {...card})`)
em toda movimentação. Sem a tolerância a valor inalterado, mover um card já avaliado
falharia para o colaborador — quebra imediata da operação. O projeto já usa esse padrão
em `database.rules.json:48`.

### D7 — Avaliação: bloquear criação com nota, mas só no `kanban`
**Escolha:** em `kanban/$cardId`, na **criação** (`!data.exists()`), os campos
`ajuste_*` têm de estar **ausentes**. Em `arquivo/$cardId`, na criação eles são
**permitidos**.
**Por quê:** sem a cláusula de criação, um colaborador criaria um card já com nota. Mas
em `arquivo` o card **nasce por movimento** (`moveCardToArquivo`), trazendo a nota
consigo — proibir ali quebraria o arquivamento. Verifiquei que o único caminho que cria
card em `kanban` com nota é a restauração (`moveCardToKanban`, chamado só de
`unarchiveKanbanCard:2633`, que é gated para gestora) — logo a cláusula `<gestão>` já
cobre. Nos dois nós, **alterar** nota existente exige gestão.

### D8 — E7 escapa no consumo, não na origem
**Escolha:** aplicar `escH` nos 6 pontos de interpolação, não dentro do objeto de
*fallback*.
**Por quê:** pré-escapar no fallback (como `kanban.js:880` faz) é mais robusto contra
consumo novo, mas `label` também é usado em contexto **não-HTML** — ordenação por
`localeCompare` (`:1680`) e exportação para planilha (`:1759`). Pré-escapar corromperia
esses usos. Escapar no consumo é cirúrgico e não pode corromper nada.

### D9 — Autoridade de deploy
**Escolha:** eu preparo e valido; o dono revisa o diff; com o OK dele, eu rodo o deploy
daquela onda. Uma onda por vez.
**Por quê:** decisão do dono (registrada em 08/09/2026). Deploy de regra é
outward-facing e instantâneo — trade-off de risco é decisão do dono, nunca do executor
(princípio nº 0).

---

## 3. Fases

Cada fase entrega estado utilizável: parar em qualquer ponto não deixa nada pela metade.

### Fase 0 — Rede de proteção · *nada toca produção*

- [x] **0.1** JDK instalado — OpenJDK 21.0.12.1 em
      `C:\Program Files\Microsoft\jdk-21.0.12.101-hotspot` — 08/09
- [x] **0.2** Dependências instaladas em `tests/` (484 pacotes; firebase-tools 15.29.0) — 08/09
- [ ] **0.3** `npx firebase-tools login` — autenticação do dono
- [ ] **0.4** Snapshot fresco de produção:
      `npx firebase-tools database:get / --project kronoslabtecie > backups/rtdb-backup-<AAAA-MM-DD>-pre-onda1.json`
- [ ] **0.5** Registrar a contagem de nós do snapshot (para conferir depois — mandamento 7)
- [ ] **0.6** **Restaurar o snapshot no projeto `kronos-fdb75`** e confirmar que o app
      sobe contra ele. Fecha a pendência aberta do `backups/README.md` e do item 4 do
      `MELHORIAS.md`
- [ ] **0.7** Confirmar com o dono que `kronos-fdb75` pode servir de cópia (decisão **D2**)

**Pronto quando:** existe um backup fresco, ele foi restaurado com sucesso numa cópia, e
o emulador roda.
**Reversibilidade:** total — nada foi alterado.

### Fase 1 — Portão de testes · *vermelho primeiro*

- [ ] **1.1** `npm init -y` + `npm i -D @firebase/rules-unit-testing` num
      `tests/` local (sem instalação global)
- [ ] **1.2** Escrever a suíte contra `database.rules.json` **atual**, com um caso por
      invariante desta onda. Os testes de ataque devem **falhar agora** (provando que o
      achado é real) e passar depois da correção:
  - **B1** · gestora cria `/usuarios/<novo>` com `papel:'admin'` → hoje PERMITIDO, deve virar NEGADO
  - **B1** · coordenador, o mesmo → hoje PERMITIDO, deve virar NEGADO
  - **C4** · colaborador sobrescreve `entries/<de um colega>` pondo a própria `collab` → hoje PERMITIDO, deve virar NEGADO
  - **C4** · o mesmo via `update` só do campo `collab` → hoje PERMITIDO, deve virar NEGADO
  - **C1** · colaborador faz `set(kanban, null)` → hoje PERMITIDO, deve virar NEGADO
  - **C1** · colaborador grava `ajuste_diagramacao` num card → hoje PERMITIDO, deve virar NEGADO
  - **C1** · colaborador **apaga** `ajuste_diagramacao` de um card → hoje PERMITIDO, deve virar NEGADO
  - **C1** · colaborador cria card já com `ajuste_diagramacao` → hoje PERMITIDO, deve virar NEGADO (**D7**)
  - **C1** · colaborador apaga post de outra pessoa no `mural` → hoje PERMITIDO, deve virar NEGADO
  - **C1** · colaborador faz `set(mural, null)` → hoje PERMITIDO, deve virar NEGADO
  - **E7** · colaborador grava `assignee` com `<img src=x onerror=...>` → hoje PERMITIDO, deve virar NEGADO
- [ ] **1.3** Escrever os testes de **não-regressão** dos fluxos legítimos, que precisam
      continuar PERMITIDOS (é aqui que se evita derrubar a equipe — **D5**, **D6**):
  - colaborador cria, move, conclui e apaga o **próprio** card
  - colaborador move card **que já tem avaliação** (o caso do **D6**)
  - colaborador lança horas (`workers[minha_key]`)
  - colaborador arquiva card na lixeira (card com nota vai para `arquivo` — **D7**)
  - colaborador cria e apaga o **próprio** post no mural
  - gestora avalia, limpa a lixeira, desarquiva e limpa o mural
  - gestora cria `colaborador` na própria equipe
  - colaborador cria, edita e apaga o **próprio** registro de ponto
- [x] **1.4** Baseline medido no emulador — **47 testes: 28 passam, 19 falham**.
      Todas as 19 falhas são de ATAQUE (vulnerabilidade confirmada); **zero**
      falha de não-regressão. Saída em
      `docs/security-audit/suite-baseline-antes-onda1.txt` — 08/09

**Pronto quando:** a suíte prova, sozinha, que os 4 críticos existem — e que os fluxos
legítimos funcionam. Esta é a **invariante central da onda**: *nenhuma conta de
colaborador altera dado que não é seu, nem privilégio de ninguém.*
**Reversibilidade:** total — só arquivos novos em `tests/`.

### Fase 2 — Regras: B1 + C4 + C1/C3 · *deploy 1*

Um grupo por commit (mandamento 4).

- [ ] **2.1** **B1** — `.validate` de `usuarios/$uid` por lista de papéis + `.validate`
      no filho `papel`. Base: o patch já escrito no `MELHORIAS.md` item 1, que é mais
      restritivo que o do relatório (gestora e coordenador criam só `colaborador`) —
      **adoto o do `MELHORIAS.md`**. → commit
- [ ] **2.2** **C4** — `entries/$entryId`: separar criação, sobrescrita e exclusão;
      a sobrescrita passa a exigir `data.child('collab')` **e**
      `newData.child('collab')`. → commit
- [ ] **2.3** **C1/C3** — `kanban`, `arquivo` e `mural` conforme **D5**, **D6** e
      **D7**. → commit
- [ ] **2.4** Suíte inteira verde: os 11 ataques NEGADOS, os 8 fluxos legítimos PERMITIDOS
- [ ] **2.5** **Ensaio geral** (mandamento 10): deployar as regras em `kronos-fdb75`
      (a cópia) e exercitar o app real contra ela — timer, kanban, mural, aprovações,
      avaliação
- [ ] **2.6** Apresentar `git diff database.rules.json` ao dono → **aguardar OK** (**D9**)
- [ ] **2.7** `npx firebase-tools deploy --only database --project kronoslabtecie`
- [ ] **2.8** Smoke test em produção: login de colaborador (timer + kanban) e de gestora
      (avaliação + aprovação)

**Pronto quando:** suíte verde, ensaio geral sem falha, deploy feito e smoke test passa.
**Reversibilidade:** restaurar as regras anteriores pelo histórico do Console Firebase,
ou redeployar `docs/security-audit/database.rules.ANTES.json`.

### Fase 3 — Frontend: E7 · *deploy 2*

- [ ] **3.1** `escH` nos 6 pontos (**D8**): `kanban.js:1135`, `:1143`, `:1609`,
      `:1631`, `:2441`, `:2469` → commit
- [ ] **3.2** Verificar que `label` continua correto onde **não** é HTML
      (`:1680` ordenação, `:1759` planilha)
- [ ] **3.3** Teste manual: card com `assignee` malicioso renderiza como texto inerte
      (usar a cópia, não produção)
- [ ] **3.4** Apresentar diff ao dono → **aguardar OK**
- [ ] **3.5** `npx firebase-tools deploy --only hosting --project kronoslabtecie`
- [ ] **3.6** Smoke test; se falhar, `npx firebase-tools hosting:rollback`

**Pronto quando:** deploy feito, o card malicioso não executa, nada visual regrediu.
**Reversibilidade:** `hosting:rollback` (imediata).

### Fase 4 — Auditoria pós-fase + red team autorizado

Mandamento 6 e a seção "Pós-lançamento" do playbook de segurança.

- [ ] **4.1** Rodar o checklist de segurança pós-alteração do playbook sobre o diff da onda
- [ ] **4.2** Exercício de red team **contra a cópia**: tentar de novo, à mão, os 11
      ataques da Fase 1 — mais IDOR trocando id, burla via `curl`/devtools, e forçar
      erro para ver o que a mensagem vaza
- [ ] **4.3** Conferir a contagem de nós do snapshot pós-deploy contra a de **0.5**
- [ ] **4.4** Atualizar o relatório: os 4 críticos passam para a seção "Achados já
      remediados", com a evidência (regenerar o PDF)
- [ ] **4.5** Marcar os itens 1 e 2 do `MELHORIAS.md` como aplicados, com data
- [ ] **4.6** Escrever `DEPLOY.md` — runbook do zero, escrito enquanto se faz
      (mandamento 10): subir, smoke test, restaurar backup, rollback de regra e de hosting

**Pronto quando:** nenhum dos 11 ataques passa na cópia, o PDF está atualizado e o
runbook existe.

---

## 4. Riscos e mitigação

| Risco | Probabilidade | Mitigação |
|---|---|---|
| Regra nova nega escrita legítima e derruba a operação da equipe | **Alta** — é o risco principal | Os 8 testes de não-regressão da Fase 1.3, mais o ensaio geral 2.5 contra a cópia. Foi exatamente esse risco que produziu **D5** e **D6** |
| Deploy de regra é instantâneo e global, sem canário | Certa | Ensaio geral na cópia antes; regras anteriores guardadas; rollback pelo histórico do Console |
| `.validate` de campo quebra a gravação do card inteiro | Alta se ignorado | **D6** — tolerância a valor inalterado, com teste dedicado (Fase 1.3) |
| Proibir `ajuste_*` na criação quebra o arquivamento | Média | **D7** — a cláusula vale só em `kanban`; `arquivo` aceita na criação. Coberto por teste |
| Backup nunca foi restaurado; restauração pode não funcionar | **Média — desconhecida hoje** | **D4** — restaurar de fato na Fase 0.6, antes de qualquer deploy |
| `kronos-fdb75` pode estar em uso por algo real | Desconhecida | Confirmar com o dono (0.7) antes de escrever nele |
| Escopo inflar no meio da onda | Média | Escopo travado; P2/P3 vão para a onda 2 |
| Correção de frontend dar falsa sensação de segurança | Média | Regra nº 1 do playbook: E7 também é fechado na regra (**D5**, camada 3), não só no `escH` |

---

## 5. Definição de pronto — Onda 1

1. Suíte de regras verde: **11 ataques negados**, **8 fluxos legítimos permitidos**
2. **Invariante central provada por teste:** nenhuma conta de colaborador altera dado
   que não é seu, nem privilégio de ninguém
3. Ensaio geral na cópia sem falha, e smoke test em produção passando
4. Red team não passa em nenhum dos 11 ataques
5. Relatório e `MELHORIAS.md` atualizados; `DEPLOY.md` escrito
6. Contagem de nós do banco igual antes e depois

---

## 6. Backlog — Onda 2 (fora do escopo desta)

Da ordem P2/P3 do relatório, sem re-litígio agora:

- **A1** `coordenacaoId` não congelado — 1 cláusula, mesma linha do B1
- **A2** cascata de `.read` no log — exige mover dado e mudar cliente
- **A6** RH somente-leitura por sentinela; `'rh'` fora da regra 151
- **C2** `approvalRequests` sem `.validate` · **C5** allowlist de campos em `entries`
- **C6** `notifs.from` não amarrado · **E8** `customProjects` fora do saneamento
- **E9** `_clean` só remove `<>` — trocar por `escH` em contexto de atributo
- **D1/B5** senha padrão `0123456` + gate de senha no navegador
- **B4/B6** `gestorTemp` sem `.validate` e sem prazo
- **F1** enumeração no reset · **F2** mensagem do SDK · **F3** HSTS
- **Higiene do playbook:** 74 `console.error`/`console.warn` no código servido;
  confirmar `try/catch` em ~3 usos de `localStorage` (`kanban.js:307`, `:556-557`)
- **Testes das 4 funções de cálculo** (item 3 do `MELHORIAS.md` — protege o número que
  o sistema existe para produzir)

---

## 7. Registro de execução

| Data | Fase | O que foi feito | Resultado |
|---|---|---|---|
| 08/09/2026 | — | Plano criado; revisão adversarial pré-código; decisões D1–D9 registradas | OK |
| 08/09/2026 | 1 | Portão de testes escrito: 21 ataques + 20 não-regressão, isolados por teste | Escrito, não rodado |
| 08/09/2026 | 0.2 | `tests/` instalado (corrigido peer conflict: rules-unit-testing 5 + firebase 12) | OK |
| 08/09/2026 | 0.1 | JDK 21.0.12.1 instalado pelo dono | OK |
| 08/09/2026 | 1.4 | **Baseline no emulador: 28 passam, 19 ataques falham, 0 regressão.** Dois ataques já eram bloqueados (autopromoção; apagar ponto alheio) | OK — Fase 1 concluída |
| — | 0.3–0.7 | Backup de produção e cópia — dependem de `firebase login` do dono | Pendente |

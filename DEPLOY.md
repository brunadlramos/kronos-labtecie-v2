# DEPLOY.md — runbook de deploy do Kronos

Projeto de produção: `kronoslabtecie`. Cópia candidata de ensaio: `kronos-fdb75` (**NÃO CONFIRMADA** como cópia — ver seção 7).
Este documento é um roteiro: **nenhum comando daqui foi executado ainda.** Origem das decisões: `PLANO_CORRECAO_SEGURANCA.md` (D1–D9, Fases 0, 2, 3, 4).

Legenda: **[DONO]** = passo que exige `firebase login` ou decisão do Allan/Bruna. O assistente prepara e valida; não faz login nem deploy.

## 0. Regras de ouro

1. **Produção nunca é cobaia (D2).** Todo ensaio é feito na cópia primeiro.
2. **Uma onda por vez (D9):** deploy 1 = regras; deploy 2 = frontend (E7). Nunca juntos.
3. **Autoridade (D9):** o assistente prepara e valida → Allan revisa o diff → Bruna decide → só então deploy.
4. **npm/node/firebase-tools nunca no PC com carteiras cripto.** Rodam em Docker ou máquina dedicada. `npx` só com **versão fixada** (`npx firebase-tools@<versão> ...`) e **só depois da aprovação do dono**. Nos comandos abaixo, `FB` = `npx firebase-tools@<versão fixada>`.
5. **Backup antes, contagem depois (D4).** Restauração só vale se foi testada de verdade na cópia.
6. **Antes de qualquer `deploy --only hosting`:** comparar `main` com produção por hash de cada arquivo (seção 5.1). O deploy de 07/10, feito de uma `main` defasada, apagou ~300 linhas que só existiam em produção.
7. **Backups são dado pessoal e de saúde (LGPD):** pasta `backups/` fora do git e **nunca** em pasta sincronizada na nuvem.
8. Testes de regras rodam **só em Docker** (`docker-compose.testes.yml`), nunca no host.

## 1. Pré-requisitos

- [ ] Quem executa: o dono (Allan) **[DONO]**, ou o assistente com o dono presente para o login.
- [ ] Onde roda: container Docker / máquina dedicada, nunca o PC com carteiras. (`Dockerfile.testes` existe para os testes; se serve para firebase-tools **não foi verificado**.)
- [ ] `FB login` **[DONO]**; conferir a conta com acesso a `kronoslabtecie` e à cópia.
- [ ] Versão do firebase-tools fixada e aprovada pelo dono: `________`
- [ ] Working tree limpo, na branch que será publicada; `git log -1` anotado: `________`
- [ ] Pasta `backups/` existe e **não** está em pasta sincronizada.
- [ ] Suíte de regras verde em Docker (esperado após a Fase 2: 47/47; antes da Fase 2, baseline: 28 passam e 19 ataques falham):
  ```bash
  docker compose -f docker-compose.testes.yml up -d --build
  docker compose -f docker-compose.testes.yml exec -T dev npm ci      # 1ª vez
  docker compose -f docker-compose.testes.yml exec -T dev npm run test:ci
  ```
- [ ] Decisão de Bruna registrada para esta onda (data/mensagem): `________`

## 2. Backup + contagem de nós

**[DONO]** (exige login). Repetir antes de cada deploy; `<motivo>` = `regras` ou `hosting`.

```bash
mkdir -p backups
FB database:get / --project kronoslabtecie > backups/rtdb-backup-<AAAA-MM-DD>-pre-<motivo>.json
```

- [ ] Arquivo gerado, tamanho > 0, JSON válido (abre sem erro).
- [ ] Registrar a **contagem de nós** do snapshot (ex.: nº de chaves por nó de 1º nível — `usuarios`, `coordenacoes`, `equipes/*/entries`, `kanban`, `arquivo`, etc. — e total de folhas). Valores: `________`
- [ ] Guardar a contagem no Registro (seção 6) **antes** do deploy. É a referência do pós-deploy.

## 3. Ensaio na cópia

Pré-condição: o dono confirmar o que é `kronos-fdb75` e que pode ser cópia (plano 0.7; seção 7).

- [ ] **Restaurar o backup na cópia** **[DONO]** e confirmar que o app sobe contra ela. Comando de restauração: **não definido/testado neste repo** — escolher e registrar aqui após o primeiro teste real (ex.: import pelo Console ou `database:set`; confirmar antes qual).
  Comando usado: `________`
- [ ] Contagem de nós da cópia restaurada = contagem do snapshot (seção 2). Se diferir, **parar**: a restauração não é confiável.
- [ ] Deploy 1 ensaiado na cópia: `FB deploy --only database --project kronos-fdb75` **[DONO]**.
- [ ] Exercitar o app real contra a cópia: timer, kanban, mural, aprovações, avaliação (plano 2.5).
- [ ] (Deploy 2) card com `assignee` malicioso renderiza como texto inerte, na cópia (plano 3.3).

## 4. Deploy 1 — regras (`database.rules.json`)

Pré: seção 2 feita hoje; seção 3 sem falha.

- [ ] `git diff` das regras apresentado ao Allan → OK registrado (plano 2.6).
- [ ] Bruna decidiu.
- [ ] **[DONO]** `FB deploy --only database --project kronoslabtecie`
- [ ] **Smoke test em produção** (plano 2.8):
  - [ ] Colaborador: login, timer inicia/para, mover card no Kanban (inclusive card já avaliado), lançar horas.
  - [ ] Gestora: login, avaliar card, aprovar solicitação.
  - [ ] Equipe vê só a própria equipe; nada de "permission denied" no uso normal.
- [ ] Contagem de nós pós-deploy (seção 6).

**Rollback das regras** (reversível, rápido):
- Opção A: Console Firebase → Realtime Database → Regras → histórico → publicar a versão anterior **[DONO]**.
- Opção B: reimplantar `docs/security-audit/database.rules.ANTES.json` (copiar para `database.rules.json` e `FB deploy --only database --project kronoslabtecie`) **[DONO]**. **Atenção: esse arquivo existe só no PC do Allan, não está no repo.** Sem ele, só a opção A.
- Rollback de regras não restaura dados; se dado foi corrompido, restaurar do backup da seção 2 (procedimento testado na seção 3).

## 5. Deploy 2 — hosting (frontend E7)

Só depois do deploy 1 estável.

### 5.1 Comparação por hash (main × produção)

- [ ] Branch a publicar contém o que está em produção: calcular o hash (ex.: SHA-256) de cada arquivo de `public/` na branch **e** de cada arquivo servido por `kronoslabtecie.web.app`; listar as diferenças.
- [ ] Toda diferença é **esperada** (só as mudanças E7: `escH` nos pontos do plano 3.1) — nada "só em produção" sendo sobrescrito. Se houver arquivo/linha só em produção: **parar** e trazê-lo para a branch antes (como no restore `c6e1890`).
- [ ] Lista de arquivos diferentes anexada ao Registro.
- [ ] Hash de arquivos locais e baixados em Docker/máquina dedicada, não no PC com carteiras.

### 5.2 Deploy

- [ ] Backup (seção 2, `<motivo>`=hosting) e `git diff` revisado pelo Allan → OK; Bruna decidiu.
- [ ] Anotar a versão atual do Hosting no Console (para rollback): `________`
- [ ] **[DONO]** `FB deploy --only hosting --project kronoslabtecie`
- [ ] Cache: o HTML carrega `index_v2.js?v=<timestamp>` (js/css `no-cache`, html `no-store` em `firebase.json`). Conferir que o `?v=` foi atualizado, senão o navegador pode servir JS antigo.
- [ ] **Smoke test** (plano 3.6), com janela anônima / hard refresh:
  - [ ] Login, timer, kanban e mural abrem; sem erro no console do navegador.
  - [ ] Card com `assignee` malicioso (na cópia/teste) aparece como texto, não executa.
  - [ ] Nada visual regrediu; ordenação (`:1680`) e planilha (`:1759`) com `label` correto.

**Rollback do hosting** (imediato): **[DONO]** `FB hosting:rollback --project kronoslabtecie`. Reconferir o smoke test depois.

## 6. Pós-deploy

- [ ] Novo backup (`...-pos-<motivo>.json`) e contagem de nós **comparada** com a da seção 2 (plano 4.3). Diferenças só explicáveis por uso normal entre os dois momentos; qualquer queda inexplicada → rollback + investigar.
- [ ] Registrar em `PLANO_CORRECAO_SEGURANCA.md`, seção 7: data, o que foi publicado, commit, contagens, resultado do smoke test.
- [ ] Red team contra a cópia (plano 4.2) e atualização do relatório (4.4–4.5), se ainda pendentes.

| Data | Deploy | Commit | Contagem antes | Contagem depois | Smoke | Quem |
|---|---|---|---|---|---|---|
| | | | | | | |

## 7. O que ainda NÃO foi verificado

- **Regras publicadas em produção × repo:** nunca comparadas (a baseline de 20/08 comparou `public/` por hash, não as regras). Exportar as regras do Console e fazer diff com `database.rules.json` **antes** do deploy 1; isso também diz o que o rollback A restauraria.
- **O que é `kronos-fdb75`:** V1, cópia ou outro projeto? Não confirmado. Sem isso, o ensaio da seção 3 não pode começar (plano 0.7).
- **Restauração de backup:** nunca testada na cópia (plano 0.6).
- **Plano Firebase (Spark × Blaze):** não verificado; pode afetar cota/backups automáticos.
- **Comando de restauração** e **se o container tem firebase-tools:** a definir (seções 1 e 3).
- **`database.rules.ANTES.json`:** só no PC do Allan; não versionado.

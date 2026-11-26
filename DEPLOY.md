# DEPLOY.md — runbook de deploy do Kronos

Projeto de produção: `kronoslabtecie`. Cópia candidata de ensaio: `kronos-fdb75` (**NÃO CONFIRMADA** como cópia — ver seção 7).
Este documento é um roteiro: **nenhum comando daqui foi executado ainda.** Origem das decisões: `PLANO_CORRECAO_SEGURANCA.md` (D1–D9, Fases 0, 2, 3, 4).

Legenda: **[DONO]** = passo que exige `firebase login` ou decisão do Allan/Bruna. O assistente prepara e valida; não faz login nem deploy.

## 0. Regras de ouro

1. **Produção nunca é cobaia (D2).** Todo ensaio é feito na cópia primeiro.
2. **Uma onda por vez (D9):** deploy 1 = regras; deploy 2 = frontend (E7). Nunca juntos.
3. **Autoridade (D9):** o assistente prepara e valida → Allan revisa o diff → Bruna decide → só então deploy.
4. **npm/node/firebase-tools nunca rodam no host** (PC com carteiras cripto). **Proibido `npx firebase-tools...` no host**, com ou sem versão. Todo comando firebase usa `FB`, definido como:
   ```bash
   FB="docker compose -f docker-compose.testes.yml exec -T dev npx --no firebase"
   ```
   O firebase-tools já é devDependency de `tests/package.json` e fica no container (`npm ci` na 1ª vez, seção 1). `--no` impede o npx de baixar qualquer pacote. Em todo comando abaixo, `$FB <args>` = esse prefixo + args.
5. **Backup antes, contagem depois (D4).** Restauração só vale se foi testada de verdade na cópia.
6. **Antes de qualquer `deploy --only hosting`:** comparar `main` com produção por hash de cada arquivo (seção 5.1). O deploy de 07/10, feito de uma `main` defasada, apagou ~300 linhas que só existiam em produção.
7. **Backups são dado pessoal e de saúde (LGPD):** `backups/` fora do git e **nunca** em pasta sincronizada na nuvem (seção 2 manda conferir).
8. Testes de regras rodam **só em Docker** (`docker-compose.testes.yml`), nunca no host.
9. **Todo comando firebase leva `--project` explícito** (`kronoslabtecie` ou `kronos-fdb75`). Sem `--project`, não rodar.

## 1. Pré-requisitos

- [ ] Quem executa: o dono (Allan) **[DONO]**, ou o assistente com o dono presente para o login.
- [ ] Container de pé: `docker compose -f docker-compose.testes.yml up -d --build` e, na 1ª vez, `docker compose -f docker-compose.testes.yml exec -T dev npm ci`. Confirmar que `$FB --version` responde **dentro do container** (não verificado se a imagem `Dockerfile.testes` o permite).
- [ ] **Login [DONO]:** feito **dentro do container**, em sessão interativa (`exec` **sem** `-T`): `docker compose -f docker-compose.testes.yml exec dev npx --no firebase login --no-localhost`. Nunca `firebase login` no host. Conferir a conta com acesso a `kronoslabtecie` e à cópia. A sessão pode se perder se o container for recriado (só `.cache` é volume nomeado): refazer o login quando acontecer.
- [ ] Working tree limpo, na branch que será publicada; `git log -1` anotado: `________`
- [ ] Suíte de regras verde (esperado: 0 falhas, total muda a cada onda; baseline antes da Fase 2: 28 passam, 19 ataques falham):
  ```bash
  docker compose -f docker-compose.testes.yml exec -T dev npm run test:ci
  ```
- [ ] Decisão de Bruna registrada para esta onda (data/mensagem): `________`
- [ ] Conta e registro de **teste identificados** (ex.: usuário "TESTE-DEPLOY") disponíveis para os smoke tests em produção (seções 4 e 5).

## 2. Backup + contagem de nós

**[DONO]** (exige login). Repetir antes de cada deploy; `<motivo>` = `regras` ou `hosting`.

- [ ] **Conferir a pasta antes:** o repo (e portanto `backups/`, montado em `/work` no container) **não** está dentro de OneDrive/Google Drive/Dropbox ou outra pasta sincronizada. Verificar nas configurações do OneDrive/Drive se a pasta do repo (e Desktop/Documentos) está sincronizada. Se estiver, **parar** e usar outra pasta fora da sincronização.
- [ ] Backup:
  ```bash
  mkdir -p backups
  $FB database:get / --project kronoslabtecie > backups/rtdb-backup-<AAAA-MM-DD>-pre-<motivo>.json
  ```
- [ ] Arquivo gerado, tamanho > 0, JSON válido.
- [ ] Registrar a **contagem de nós** (nº de chaves por nó de 1º nível — `usuarios`, `coordenacoes`, `equipes/*/entries`, `kanban`, `arquivo` — e total de folhas). **O método/comando dessa contagem ainda não está definido** (seção 7); definir e registrar antes do 1º uso: `________`. Valores: `________`
- [ ] Guardar a contagem no Registro (seção 6) **antes** do deploy.

## 3. Ensaio na cópia (`kronos-fdb75`)

**Sem a pré-condição (a), a seção 3 inteira NÃO é executada** (inclui 3.1, 3.2 e o ensaio de hosting da 5.0).

### Pré-condições da restauração (todas, nesta ordem, antes de qualquer comando)

- [ ] **(a)** Confirmação **ESCRITA** do dono de que `kronos-fdb75` é **descartável** e **não é o V1 real** (guardar a mensagem/data): `________`
- [ ] **(b)** Backup prévio de `kronos-fdb75` salvo: `$FB database:get / --project kronos-fdb75 > backups/rtdb-backup-<AAAA-MM-DD>-kronos-fdb75-antes-ensaio.json`
- [ ] **(c)** `--project kronos-fdb75` explícito em **todo** comando desta seção; nenhum comando sem `--project`.
- [ ] **(d)** **Nunca restaurar sem (a).** Se (a), (b) ou (c) falhar, parar.

### 3.1 Restaurar e conferir

- [ ] Restaurar o backup de produção em `kronos-fdb75` **[DONO]**. O comando de restauração **não está definido nem testado**: escolher e registrar aqui após o primeiro teste real (ex.: import pelo Console ou `database:set`; confirmar qual antes). Comando: `________` (com `--project kronos-fdb75`)
- [ ] Contagem de nós da cópia = contagem do snapshot (seção 2). Se diferir, **parar**: a restauração não é confiável.
- [ ] App sobe apontando para a cópia.

### 3.2 Ensaio das regras

- [ ] `$FB deploy --only database --project kronos-fdb75` **[DONO]**.
- [ ] Exercitar o app real contra a cópia: timer, kanban, mural, aprovações, avaliação (plano 2.5).

## 4. Deploy 1 — regras (`database.rules.json`)

Pré: seção 2 feita hoje; seção 3 **executada e sem falha** (sem ensaio na cópia não há deploy).

- [ ] `git diff` das regras apresentado ao Allan → OK registrado (plano 2.6).
- [ ] Bruna decidiu.
- [ ] **[DONO]** `$FB deploy --only database --project kronoslabtecie`
- [ ] **Smoke test em produção** (plano 2.8). **Ele grava dado real:** usar a conta de teste e registros de teste identificados (ex.: prefixo "TESTE-DEPLOY") e **apagá-los depois**; não usar conta/card de pessoa real.
  - [ ] Colaborador (teste): login, timer inicia/para, mover card (inclusive já avaliado), lançar horas.
  - [ ] Gestora: login, avaliar card de teste, aprovar solicitação de teste.
  - [ ] Equipe vê só a própria equipe; sem "permission denied" no uso normal.
  - [ ] Registros de teste apagados.
- [ ] Contagem de nós pós-deploy (seção 6).

**Quem decide o rollback do deploy 1:** o **dono (Allan)**, **imediatamente** ao primeiro smoke test que falhar — sem esperar reunião nem segunda tentativa.

**Rollback das regras** (reversível, rápido):
- Opção A: Console Firebase → Realtime Database → Regras → histórico → publicar a versão anterior **[DONO]**.
- Opção B **[DONO]**: copiar `docs/security-audit/database.rules.ANTES.json` sobre `database.rules.json` e `$FB deploy --only database --project kronoslabtecie`. **Esse arquivo existe só no PC do Allan, não está no repo.** **Logo depois do deploy, reverter o arquivo no git:** `git checkout -- database.rules.json`, **somente no worktree de deploy, nunca na árvore de trabalho do dono**; senão a próxima publicação sai com as regras antigas. Conferir `git status` limpo.
- Rollback de regras não restaura dados; se dado foi corrompido, restaurar do backup da seção 2 (procedimento testado na seção 3).

## 5. Deploy 2 — hosting (frontend E7)

Só depois do deploy 1 estável.

### 5.0 Ensaio do hosting na cópia

Vale a pré-condição (a) da seção 3.

- [ ] Confirmar que o projeto `kronos-fdb75` **tem Hosting configurado/ativo** (Console → Hosting). Se **não** tiver: o ensaio de hosting **não é feito** e vira lacuna declarada na seção 7; avisar o dono antes de seguir para 5.1.
- [ ] `$FB deploy --only hosting --project kronos-fdb75` **[DONO]**
- [ ] Abrir a URL da cópia: login, timer, kanban, mural sem erro no console.
- [ ] **Card malicioso:** na cópia, card com `assignee` = `<img src=x onerror=...>` renderiza como texto inerte (plano 3.3).
- [ ] Atenção: o `public/` pode apontar para o Firebase de **produção** (config do app). Confirmar para qual banco a cópia de hosting está apontando antes de gravar qualquer dado nela. (Não verificado.)

### 5.1 Comparação por hash (main × produção)

**O comando de hash por arquivo ainda não está definido** (seção 7). Definir e registrar: `________`

- [ ] Calcular o hash (ex.: SHA-256) de cada arquivo de `public/` na branch **e** de cada arquivo servido por `kronoslabtecie.web.app`; listar diferenças. Executar em Docker/máquina dedicada, não no PC com carteiras.
- [ ] Toda diferença é **esperada** (E7 (`kanban.js`, `importadores.js`) e UI do B1 (`usuarios.js`)) — nada "só em produção" sendo sobrescrito. Se houver: **parar** e trazer para a branch antes (como no restore `c6e1890`).
- [ ] Lista de arquivos diferentes anexada ao Registro.

### 5.2 Deploy

- [ ] Backup (seção 2, `<motivo>`=hosting); `git diff` revisado pelo Allan → OK; Bruna decidiu.
- [ ] Anotar a versão atual do Hosting no Console (para rollback): `________`
- [ ] **[DONO]** `$FB deploy --only hosting --project kronoslabtecie`
- [ ] Cache: o HTML carrega `index_v2.js?v=<timestamp>` (js/css `no-cache`, html `no-store` em `firebase.json`). Conferir que o `?v=` foi atualizado.
- [ ] **Smoke test** (plano 3.6), janela anônima / hard refresh, **com conta e registros de teste** (grava dado real; apagar depois):
  - [ ] Login, timer, kanban e mural abrem; sem erro no console.
  - [ ] Ordenação (`:1680`) e planilha (`:1759`) com `label` correto; nada visual regrediu.
  - [ ] Registros de teste apagados.

**Rollback do hosting** (imediato; decide o dono ao primeiro smoke que falhar): **[DONO]** `$FB hosting:rollback --project kronoslabtecie`. Repetir o smoke test depois.

## 6. Pós-deploy

- [ ] Novo backup (`...-pos-<motivo>.json`) e contagem de nós **comparada** com a da seção 2 (plano 4.3). Diferenças só explicáveis por uso normal entre os dois momentos; qualquer queda inexplicada → rollback + investigar.
- [ ] Registrar em `PLANO_CORRECAO_SEGURANCA.md`, seção 7: data, o que foi publicado, commit, contagens, resultado do smoke test.
- [ ] Red team contra a cópia (plano 4.2) e atualização do relatório (4.4–4.5), se ainda pendentes.
- [ ] **Encerrar a sessão [DONO]:** `docker compose -f docker-compose.testes.yml exec dev npx --no firebase logout` e depois `docker compose -f docker-compose.testes.yml down` (o container guarda o login de produção e enxerga `backups/`; não deixar de pé).

| Data | Deploy | Commit | Contagem antes | Contagem depois | Smoke | Quem |
|---|---|---|---|---|---|---|
| | | | | | | |

## 7. O que ainda NÃO foi verificado / não definido

- **Regras publicadas em produção × repo:** nunca comparadas (a baseline de 20/08 comparou `public/`, não as regras). Exportar do Console e fazer diff com `database.rules.json` **antes** do deploy 1; isso diz também o que o rollback A restauraria.
- **O que é `kronos-fdb75`:** V1, cópia ou outro projeto? Sem confirmação escrita do dono, a seção 3 não roda.
- **Restauração de backup:** nunca testada na cópia (plano 0.6); comando de restauração indefinido.
- **Plano Firebase (Spark × Blaze):** não verificado; pode afetar cota/backups automáticos.
- **Comando de hash por arquivo (main × produção):** não definido.
- **Validação de contagem de nós:** não definida (o que contar e como).
- **Hosting da cópia:** não se sabe se `kronos-fdb75` tem Hosting; se não tiver, o ensaio de hosting (5.0) é lacuna.
- **firebase-tools no container:** presença na imagem/versão e persistência do login não verificadas.
- **`database.rules.ANTES.json`:** só no PC do Allan; não versionado.
- **Pasta do repo sincronizada na nuvem?** Não verificado (seção 2).

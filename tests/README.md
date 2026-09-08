# Portão de testes das Security Rules

Suíte que exercita `database.rules.json` no emulador oficial do Realtime Database.
As regras são a **única** fronteira de segurança do Kronos (não há backend), e até
esta onda não tinham teste nenhum.

Rege este diretório: `PLANO_CORRECAO_SEGURANCA.md` (Fase 1) e
`PLAYBOOK_ENGENHARIA.md` (mandamento 5 — testes primeiro).

## Pré-requisito: JDK

O emulador do Realtime Database roda em Java. Não há JDK nesta máquina
(`JAVA_HOME` vazio). Instale uma vez, como administrador:

```
winget install Microsoft.OpenJDK.21
```

Depois feche e reabra o terminal e confirme: `java -version`.

## Instalar e rodar

```bash
cd tests
npm install                # local, sem -g

# opção A — emulador em um terminal, teste em outro
npm run emu                # deixa rodando
npm test                   # noutro terminal

# opção B — sobe, roda e derruba num comando (bom para CI)
npm run test:ci
```

O emulador **não** toca em nenhum projeto real: sobe em `127.0.0.1:9000` com o
`projectId` descartável `kronos-rules-test`. As regras vêm de
`../database.rules.json`, então o que é testado é exatamente o que vai a produção.

## Como ler o resultado

Os testes têm dois prefixos, e a diferença importa:

| Prefixo | O que é | Antes da Fase 2 | Depois da Fase 2 |
|---|---|---|---|
| `ATAQUE:` | O que **não pode** ser permitido | **FALHA** — e a falha é a prova de que o achado é real | passa |
| `NAO-REGRESSAO:` | Fluxo legítimo que precisa continuar funcionando | passa | passa |

Ou seja: **antes de corrigir as regras, a suíte fica vermelha de propósito.** São
19 testes de ataque (B1, C4, C1/C3, E7) que hoje passam no banco e não deveriam.
Se algum `ATAQUE:` passar antes da correção, o achado correspondente não existe
mais e vale reconferir; se algum `NAO-REGRESSAO:` falhar depois da correção,
apertamos demais a regra e vamos derrubar a operação da equipe.

## Os dois testes que mais importam

Não são os de ataque — são estes, que existem para impedir que a correção quebre
o app (decisões **D5**, **D6** e **D7** do plano):

- **`NAO-REGRESSAO (D6): colaborador move card JÁ AVALIADO preservando a nota`**
  O cliente grava o **card inteiro** (`set(child(kanbanRef,key), {...card})`) em toda
  movimentação. Se o `.validate` de `ajuste_*` não tolerar valor inalterado, mover um
  card já avaliado passa a falhar para o colaborador — quebra imediata do Kanban.

- **`NAO-REGRESSAO (D7): colaborador arquiva card que já tem nota`**
  Em `arquivo` o card **nasce por movimento**, trazendo a nota consigo. Proibir
  `ajuste_*` na criação ali quebraria o arquivamento — por isso a proibição de
  criação vale só em `kanban`.

## Cobertura

**Ataques (devem ser negados):** 19 — escalada a admin por gestora e por coordenador,
papel fora da lista de permissão, sobrescrita e exclusão de registro de ponto alheio,
apagamento do quadro/mural/arquivo inteiro, gravar/alterar/apagar avaliação e criar
card já avaliado, apagar e forjar post alheio no mural, e HTML em `assignee`,
`history[].by` e chave de `workers`.

**Não-regressão (devem ser permitidos):** 20 — criar/mover/concluir card, mover card
já avaliado, lançar horas, arquivar card com nota, criar/apagar o próprio post,
gestora avaliando, limpando mural e desarquivando, gestora criando colaborador,
colaborador criando/editando/apagando o próprio ponto, e as invariantes que já
funcionam hoje (isolamento entre equipes, acesso anônimo negado, nó não previsto
fechado, teto de tamanho em escrita de campo isolado, `activeTimers`/`avatars`
amarrados ao dono, log append-only, `pwdReset` por UID).

## Quando um achado novo aparecer

Todo achado do relatório que for corrigido entra aqui como caso de regressão **no
mesmo commit da correção**. É o que impede a reintrodução no deploy seguinte — a
recomendação P3 do relatório, e o motivo de esta suíte existir.

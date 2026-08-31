# backups/ — não versionado, de propósito

Esta pasta é o padrão da casa: **antes de qualquer script que escreve no banco,
tira-se um snapshot do Realtime Database aqui.** O conteúdo, porém, nunca vai
para o git.

## Por quê

Um snapshot do RTDB é a base inteira do Kronos: e-mail institucional, nome,
registro de ponto, avaliação e UID de colaborador identificado — dado pessoal
sob a LGPD, de gente que não consentiu em ter isso replicado em cada clone do
repositório. O mesmo vale para os exports do Clockify e para o backup do
Firebase Auth, que carrega hash e salt de senha.

Por isso o `.gitignore` da raiz cobre `backups/`, `*.csv` e `auth-backup-*.json`.
Se precisar versionar algum arquivo desta pasta, ele tem de ser anonimizado
primeiro — e a exceção entra explicitamente no `.gitignore`.

Em 31/08/2026 o histórico do repositório foi reescrito para apagar seis dumps
e um export do Clockify que tinham sido versionados por engano. Não repetir.

## Como tirar um snapshot antes de mexer no banco

```bash
firebase database:get / --project kronoslabtecie \
  > backups/rtdb-backup-$(date +%Y-%m-%d)-pre-<motivo>.json
```

A convenção de nome é `rtdb-backup-<AAAA-MM-DD>-pre-<motivo>.json`, para dar
para saber, meses depois, o que o snapshot antecede.

## Pendência aberta 🔴

**Nenhuma restauração foi testada até hoje.** Backup que nunca foi restaurado é
torcida, não backup. Antes de confiar nesta pasta como plano de recuperação,
restaurar um snapshot num projeto Firebase descartável e conferir se o app sobe.

## Onde ficam os snapshots de verdade

Na máquina da gestão do projeto, fora de pasta sincronizada com nuvem pública.
Quem precisar de uma cópia deve pedir — não existe cópia no repositório.

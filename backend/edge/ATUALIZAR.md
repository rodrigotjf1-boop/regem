# Regem Edge — como funciona a atualização

> Documento **informativo**: explica a **lógica** de como o servidor edge (o
> backend do Regem no PC da loja) recebe atualizações. Não é um checklist rígido —
> é o mapa mental para entender o mecanismo.

## A ideia central: nuvem e edge são separados

- **Nuvem** (`api`/`app.dmsregem.com`): atualiza **sozinha** a cada `git push` na
  `main` (EasyPanel auto-deploy). Não tem nada a ver com o PC da loja.
- **Edge** (PC da loja): é uma **cópia empacotada** do backend rodando localmente.
  Ele **não puxa código da nuvem** — só atualiza quando você **publica um pacote
  novo**. Mesmo código-fonte, distribuído à parte.

> Ou seja: **mudar a nuvem NÃO atualiza o edge.** São dois artefatos.

## Como o edge decide se atualiza: por VERSÃO (não por diff)

O edge nunca compara arquivos. Ele compara **números de versão**:

```
edge  →  GET {nuvem}/edge/update-check?versao=<APP_VERSION do edge>
nuvem →  atualizar = ( EDGE_LATEST_VERSION  >  versao do edge )
```

- A **versão instalada** fica em `APP_VERSION` no `.env.local` do PC da loja.
- A **"última versão" de referência** é a variável **`EDGE_LATEST_VERSION`** que
  **você define manualmente** no serviço `regem-api` (nuvem). A nuvem **não** tem
  um número que sobe sozinho — você **declara** qual é a última.
- Comparação **numérica por segmento**: `1.4.10` é maior que `1.4.2`.

> Se `EDGE_LATEST_VERSION` nunca for setada, **nenhum edge atualiza** — mesmo que a
> nuvem mude. É o que "liga" o update para as lojas.

## As variáveis (no `regem-api` → Environment)

| Variável | O que é |
|---|---|
| `EDGE_LATEST_VERSION` | a última versão de edge publicada (ex.: `1.4.0`) — é o gatilho |
| `EDGE_UPDATE_URL` | URL HTTPS pública do `.zip` do pacote |
| `EDGE_UPDATE_SHA256` | impressão digital do `.zip` (a loja recusa se não bater) |
| `EDGE_UPDATE_NOTAS` | texto "o que mudou" (opcional; aparece pro lojista) |

E no **PC da loja**: `APP_VERSION` (no `.env.local`) = a versão instalada.

## Publicar uma versão (resumo)

1. Na sua máquina, na pasta `backend`: `.\edge\publicar.ps1 -Versao 1.4.0`
   → gera o `regem-edge-1.4.0.zip` e imprime o **SHA-256**.
2. Sobe esse `.zip` num **HTTPS público** (ex.: um bucket público do Supabase
   Storage). O bucket você cria **uma vez**; nas próximas versões, só sobe o novo
   `.zip`.
3. No `regem-api` (EasyPanel → Environment), atualiza `EDGE_LATEST_VERSION`,
   `EDGE_UPDATE_URL` e `EDGE_UPDATE_SHA256` → **Deploy**.

> Isso só é necessário **quando há um edge instalado que você quer atualizar**.

## Aplicar na loja (resumo)

- **Automático (só avisa):** o servidor verifica se há versão nova **ao abrir a
  loja** (nos 10 primeiros min e ~30 min depois; sem horário cadastrado, ~04:00).
  Ele **notifica**, mas **não instala sozinho**.
- **Manual (instala):** app → **Servidor local** (`/servidor`) → **Verificar
  atualização** → **Instalar atualização**. Isso dispara o `atualizar.ps1`, que
  baixa, confere o SHA, faz **backup**, troca os arquivos, roda as **migrations
  locais** (no edge são automáticas), sobe os serviços e faz **health-check** —
  com **rollback** automático se algo falhar.
- ⚠️ A instalação **reinicia os serviços por 1–2 min** (KDS/PDV/ponto ficam fora).
  Faça com a **loja fechada**.

## Detalhes que valem lembrar

- **Migrations:** no **edge** rodam sozinhas no update; na **nuvem** são **manuais**
  (aplicar o `.sql` no Supabase → SQL Editor).
- **Bootstrap:** a propagação automática dos scripts do `edge/` (ex.: o worker de
  impressão) vale para updates **futuros**. Um edge instalado **antes** dessa
  melhoria precisa de **1 reinstalação** para pegá-la; depois disso, propaga sozinho.
- **Possível evolução:** dá para o `push` na `main` **publicar o pacote de edge
  automaticamente** (CI gera o `.zip`, hospeda e seta as variáveis), mantendo a
  **instalação manual** na loja. Hoje a publicação é manual de propósito.

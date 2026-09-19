# Regem Edge — como funciona a atualização

> Documento **informativo** (fica no repositório; `.md` não vai para a loja): a lógica de
> como o servidor local recebe atualizações, quem faz o quê e por quê.

## Nuvem e servidor local: o mesmo código, entregues separados

- **Nuvem** (`api`/`app.dmsregem.com`): atualiza sozinha a cada merge na `main` (EasyPanel).
- **Servidor local** (PC da loja): cópia empacotada do mesmo backend. Só muda quando a
  distribuição **publica um pacote** (`.zip`) e o gestor **instala** (ou agenda).

## Quem decide qual versão cada loja recebe

O servidor local pergunta `GET {nuvem}/edge/update-check?versao=<APP_VERSION>` mandando o
token do servidor (`x-sync-token`). A nuvem olha os releases publicados no **console da
distribuição** (tabela `edge_release`) e devolve **a MAIOR versão liberada para aquela loja**:

| Campo do release | Efeito |
|---|---|
| `percentual` | fatia das lojas que recebe (sorteio estável por empresa + versão; subir de 10% para 30% mantém quem já recebeu) |
| `lojas_piloto` | recebem antes, independente do percentual |
| `pausado` | ninguém novo recebe |
| `recolhido` | nunca mais é oferecido; quem está nele vê o aviso para atualizar ou reverter |

Servidor sem token (versões até a 1.29.x pelo endpoint direto) só vê release em 100%. O
heartbeat autenticado também leva o aviso e já respeita piloto/percentual.

Para "voltar" uma versão ruim em todas as lojas: **recolher** e publicar uma versão **maior**
(o servidor local recusa versão menor).

## Publicar uma versão (distribuição)

1. `.\edge\publicar.ps1 -Versao 1.30.0` → gera `regem-edge-1.30.0.zip` (com `node_modules.tar` e
   `web.tar`), confere o conteúdo e imprime o SHA-256.
2. Sobe o `.zip` no Supabase Storage (bucket `edge-updates`, nome exato).
3. `.\edge\publicar.ps1 -Versao 1.30.0 -SoAssinar -Url <url do zip>` → assina o MESMO arquivo
   (Ed25519 v1 + v2 com validade de 180 dias) com `edge/update-priv.pem` e confere com a chave
   pública.
4. Console da distribuição → Atualizações → **Publicar release**: versão, URL, SHA, as duas
   assinaturas e a validade; comece pelas **lojas piloto** e um percentual baixo. A API
   **recusa** release sem as duas assinaturas válidas.
5. Acompanhe na lista "servidores na versão" e na telemetria (`update_falha`,
   `update_revertido`); suba o percentual, pause ou recolha.

## Instalar na loja (gestor)

Tela **Servidor** → **Instalar agora** ou **Agendar**. A faixa de aviso do topo só leva até lá.

- Com **caixa aberto** (últimas 16 h) ou **pedido em produção** (últimas 3 h), "Instalar agora"
  pede confirmação; o agendamento espera a loja parar (até 12 h depois do horário).
- Instalar de novo uma versão que o gestor **reverteu** também pede confirmação.

## O que o `atualizar.ps1` faz (tarefa SYSTEM `RegemEdgeUpdate`)

1. **Preparação — a loja segue operando, nada instalado é tocado:** consulta a nuvem, confere a
   **assinatura** (obrigatória quando `edge\update-pub.pem` existe — `EDGE_ALLOW_UNSIGNED_UPDATE=true`
   só em bancada), baixa com teto de tamanho, confere o **SHA-256**, monta a versão nova INTEIRA
   em `..\atualizacao-<versão>\` (dependências e app extraídos dos `.tar`), valida o que precisa
   existir e faz o **backup do banco cifrado** (DPAPI). Qualquer falha aqui: nada mudou.
2. **Troca — serviços parados por 1–2 min:** renomeia o conjunto atual para `backup-<data>\` e o
   novo para o lugar (dist, node_modules, web, scripts, database, package*.json, manifesto,
   version.txt), sobrepõe os scripts do `edge\` (guardando os antigos), grava `APP_VERSION`, roda
   as migrations (conexão decifrada), sobe os serviços.
3. **Saúde:** `/ping` respondendo **na versão nova** e os 4 serviços de pé — de novo 30 s depois.
4. **Falhou na troca ou na saúde:** volta o conjunto inteiro, `APP_VERSION` e os scripts; sobe;
   confere a saúde da versão anterior; avisa a distribuição. O backup incompleto vira `falhou-*`.

Uma atualização/reversão por vez (trava em `logs\atualizacao.lock`). Mantém os 2 últimos
`backup-*`. Progresso em `logs\update-status.json` (a tela lê).

## Reverter (`reverter.ps1`, tarefa `RegemEdgeRollback`)

Volta o conjunto inteiro do `backup-*` mais novo e o `APP_VERSION`; o banco fica (use
`-ComBanco` só se o problema for de dados). Marca a versão revertida e avisa a distribuição.
As migrations são aditivas: o código anterior roda no banco novo.

## Transição a partir da 1.29.x

A loja na 1.29.x aplica o primeiro pacote novo com o `atualizar.ps1` ANTIGO (é o que está
instalado): ele não confere assinatura (não tem a chave) e ainda roda `npm ci` essa única vez;
as migrations passam porque o `apply-all-local.mjs` novo decifra a conexão. A partir dele, o
fluxo acima vale inteiro — e a assinatura passa a ser obrigatória.

## Troca da chave de assinatura

Acrescente a chave pública NOVA ao `edge/update-pub.pem` (o arquivo aceita vários blocos),
publique um release assinado com a chave ANTIGA; quando a frota estiver nele, passe a assinar
com a nova e depois tire a antiga do arquivo.

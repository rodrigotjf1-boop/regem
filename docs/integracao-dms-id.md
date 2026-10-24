# API de integração do Regem — a via do DMS ID (Hub DMS)

> Fonte da verdade do lado do Regem para a credencial nova do Padrão DMS de integração (Hub DMS, F3, parte A;
> migration 329). Vale para os produtos da DMS que chamam a API de integração (`/api/v1/integracao/*`). O token por
> loja (`rgm_it_…`, contratos em `integracao-regemcast.md`, `integracao-farol.md` e no Liame) **continua valendo ao
> lado**, sem mudança. A via **nasce desligada**: só funciona depois que a distribuição liga (`DMS_ID_LIGADO`).

## 1. O que muda

Em vez de um token só, cada chamada leva **duas** coisas:

| O quê | Onde vai | Diz |
| --- | --- | --- |
| Token do DMS ID | `Authorization: Bearer <jwt>` | **qual aplicativo** chama (vale até 1 hora; destino = o recurso do Regem) |
| Segredo da ligação | `DMS-Ligacao: dms_lg_regem_…` | **qual autorização da loja** vale |

Vazar um só não abre nada: o segredo só vale com o token do aplicativo dono dele, e o token sozinho não diz loja
nenhuma. A ligação é o **mesmo acesso** que o `rgm_it_` da loja (o mesmo id, a mesma loja, os mesmos escopos, quem
autorizou): o cursor, a chave de idempotência dos cupons, o aviso registrado e o limite por minuto seguem o mesmo
acesso pelas duas vias, e revogar o acesso (pela loja, pela distribuição ou pela própria integração) corta as duas na
chamada seguinte.

**Permissões:** valem as que a loja autorizou **e** que o token do DMS ID também tem (a menor das duas). Token do
DMS ID sem nenhuma permissão do Regem é recusado, mesmo com o destino certo.

## 2. A troca automática

O aplicativo que já usa o `rgm_it_` de uma loja troca por uma ligação, uma vez por loja:

```http
POST /api/v1/integracao/dms-id/ligacao
Authorization: Bearer <token do DMS ID do aplicativo>
Content-Type: application/json

{ "token_integracao": "rgm_it_…" }
```

```json
{
  "ligacao": "dms_lg_regem_…",
  "prefixo": "dms_lg_regem_Ab3dE",
  "loja_id": "6f1d…",
  "permissoes": ["pedidos.ler", "cupons.ler"],
  "segredo_em": "2026-10-21T01:12:03.114Z"
}
```

- O segredo aparece **só nesta resposta** (`Cache-Control: no-store`); o Regem guarda o resumo (SHA-256).
- **Repetir a troca gira o segredo:** o anterior para de valer na hora. Resposta perdida se resolve trocando de novo
  com o mesmo `rgm_it_`.
- Só troca o aplicativo que a distribuição cadastrou para o cliente do token (o do Liame não troca o token do Farol).
- Ligação revogada sozinha não volta pela troca.
- Limite: 60 trocas por minuto por endereço.
- A ligação que nasce de um token antigo avisa os presidentes da empresa por e-mail (Padrão §3): o alcance é o mesmo,
  e o acesso segue em Integrações › Aplicativos conectados.

## 3. Respostas de recusa

Todas em `application/problem+json` (`type` = `https://api.dmsregem.com/problemas/<nome>`). Todo 401 leva
`WWW-Authenticate: Bearer …` com o endereço dos metadados do recurso.

| Status e `type` | Quando | O que fazer |
| --- | --- | --- |
| 401 `token-invalido` | o token do DMS ID falta, está torto, vencido, é de outro destino, de outro emissor ou com a assinatura errada | pedir outro token ao DMS ID e repetir **uma** vez. É defeito do **aplicativo**: não desconecta a loja |
| 403 `escopo-insuficiente` | falta permissão: o token não tem nenhuma do Regem, ou a rota exige uma que a loja não deu ou o token não tem | o `WWW-Authenticate` traz **todas** as que faltam (`scope="…"`) |
| 401 `ligacao-invalida` | a ligação falta, não existe, foi revogada, é de outro aplicativo, ou o acesso da loja acabou (revogado, vencido, loja apagada) | a autorização **daquela loja** acabou: desconectar a loja (e, se ainda houver um `rgm_it_` válido, trocar de novo). A resposta é a mesma para todo motivo |
| 401 `ligacao-invalida` na troca | o `rgm_it_` informado não vale para este aplicativo | conectar a loja de novo |
| 429 `limite-de-chamadas` | 60 chamadas por minuto por acesso (as duas vias somam; contadas no banco, valem entre as cópias do serviço — mig 333) | esperar o `Retry-After` (segundos) |
| 404 `nao-encontrado` | a via está desligada neste ambiente | seguir no `rgm_it_` |

**Quem recusa decide pela via** (Liame, ERR-149): pela ligação, só `ligacao-invalida` é da loja; `token-invalido`
é do aplicativo. Pelo `rgm_it_`, todo 401 continua sendo da loja.

## 4. Metadados do recurso (RFC 9728)

`GET https://api.dmsregem.com/.well-known/oauth-protected-resource/api/v1/integracao` (fora do `/api/v1`):

```json
{
  "resource": "https://api.dmsregem.com/api/v1/integracao",
  "authorization_servers": ["<o emissor do DMS ID>"],
  "scopes_supported": ["pedidos.ler", "…"],
  "bearer_methods_supported": ["header"],
  "resource_name": "Regem (API de integração)"
}
```

## 5. Configuração (distribuição)

Variáveis do serviço da API, no EasyPanel — nada disso é da loja:

| Variável | Valor |
| --- | --- |
| `DMS_ID_LIGADO` | `true` liga a via (sem ela, tudo segue só no `rgm_it_`) |
| `DMS_ID_EMISSOR` | o `iss` dos tokens: o endereço `https` do DMS ID com `/oidc` |
| `DMS_ID_RECURSO` | o identificador do recurso do Regem no DMS ID, **exatamente** `https://api.dmsregem.com/api/v1/integracao` |
| `DMS_ID_APLICATIVOS` | JSON cliente → client_id dos aplicativos cadastrados no DMS ID, como `{"liame":"<client_id>"}` |

Configuração torta não liga a via, e o log da API diz o que corrigir ("via do DMS ID desligada: …"). Tirar um
aplicativo de `DMS_ID_APLICATIVOS` corta as ligações dele na chamada seguinte. Trocar o aplicativo de um cliente
(outro client_id) também: a ligação pertence ao aplicativo que a trocou, e o novo troca de novo os `rgm_it_` das lojas.

No DMS ID, o recurso do Regem tem as permissões do catálogo (`escopos.ts`), e cada aplicativo recebe só as que usa.

## 6. Conformidade

O kit de testes do Padrão (`backend/test/dms/kit-conformidade.mts`, cópia igual à do hub) roda contra a API no
`dms-id.http.spec.ts`, no modo do DMS ID: token sem assinatura, adulterado, vencido, de outro destino e sem
permissão; ligação ausente, inexistente, revogada, de outro aplicativo e sem a permissão; o desafio em todo 401; o
formato dos erros; o limite. Ele roda no Node 22.6 ou mais; o CI (no Node 24.22.1, o mesmo das imagens) o roda no passo
dos testes, e lá pular é falha (`KIT_DMS_OBRIGATORIO`).

Desde o pacote 0.7.1 (F4, parte A), o kit também roda no modo do **manifesto**, pela porta (sem credencial) e pelo
arquivo do repositório. No modo do DMS ID, o `dms-id.http.spec.ts` pula só as conferências opcionais: as três da parte F
da F4 (a classe, a ligação suspensa e a parada) e as sete da conta, do cursor e da escrita, que pedem configuração
própria (kit da parte J), além da dos metadados da MCP. As três da parte F rodam (e passam) no
`integracao-parceiro.http.spec.ts`, com o hub de mentira e as credenciais de parceiro (seção 10).

**O manifesto da porta (Padrão §13):** `GET /.well-known/dms-manifesto`, sem credencial e fora do prefixo `/api/v1`, só
na nuvem. É a documentação pública da porta de integração: OpenAPI 3.1 com os campos `x-dms`, montado do próprio código
(`manifesto-integracao.ts`): os escopos (a frase da tela do clique; sem ela, o rótulo do console), a classe de cada um
(`dms` em todos; `parceiro` nos oito do teto da classe, `ESCOPOS_DO_PARCEIRO` em `escopos.ts`, o catálogo aprovado na
F4: os pedidos, o catálogo, as fichas, a produção, os cupons, a anonimização e, sensíveis, o telefone no pedido e o
custo; criar cupom, a lista de clientes, a 99Food e os usos de cupom ficam só `dms`; o Regem só aceita aplicativo de
parceiro com a chave `PARCEIROS_LIGADOS`, seção 10), o limite (60 por minuto por ligação, para todos; 300 por minuto por
empresa, que só o aplicativo de parceiro tem), as 15 rotas de `/integracao` com exemplos fictícios, os
6 avisos (o corpo sai de `corpoDoAviso`) e a credencial do DMS ID. Fora dele, de propósito: a troca pela ligação e o
OAuth (o ciclo da credencial), as rotas do totem e os avisos assinados ao GoGeM. O arquivo `docs/dms-manifesto.json` é o
que o código monta; o teste `manifesto-integracao.spec.ts` confere, lê as rotas e as permissões dos decoradores do
controller (nenhuma a mais nem a menos) e, com `ATUALIZAR_MANIFESTO=1`, regrava o arquivo.

## 7. Registro no hub e parada (F3, parte A2)

Vale para as duas vias (o `rgm_it_` e a ligação). Nasce desligado (`HUB_LIGADO`); a chave própria vale sem o hub.

- **Registro central:** cada chamada de `/api/v1/integracao/*` vai ao hub da DMS, em lote: quem chamou (o cliente,
  como `liame`), a credencial (`token_integracao` ou `dms_id`) e o prefixo visível dela, a loja e o nome comercial, a
  rota (`GET /integracao/pedidos`, nunca a consulta), o resultado, o problema da recusa, o status e a duração. Nunca o
  conteúdo nem o segredo. O código do registro é o `request_id` da resposta, quando tem a forma de código do hub.
- **Erros:** o 5xx da API de integração vai também à lista de erros do hub, sem as credenciais do Regem e sem dado
  pessoal.
- **Parada:** 503 `integracao-parada`, com `Retry-After: 60`. Vem da chave própria `ACEITAR_INTEGRACOES` (antes de
  qualquer conferência, sem banco e sem hub) ou da lista de parada do hub, depois de reconhecer quem chama:

  | Nível na lista do hub | Alvo |
  | --- | --- |
  | `geral` | tudo |
  | `aplicativo` | o cliente da integração: `liame`, `farol`, `regemcast`, `gogem` |
  | `ligacao` | o prefixo visível da credencial: `rgm_it_xxxxx` ou `dms_lg_regem_xxxxx` |
  | `ferramenta` | a rota, como `GET /integracao/loja` ou `POST /integracao/dms-id/ligacao` |

  **Para quem integra:** 503 `integracao-parada` não é desconexão nem recusa da loja. Esperar o `Retry-After` e
  tentar de novo, sem descartar a credencial.
- **Hub fora do ar:** nada muda para quem chama. A fila espera na memória do processo (até 5.000 chamadas), e vale a
  última lista de parada lida.
- **Fora daqui:** as cinco rotas do totem (GoGeM), que também aceitam o `rgm_it_`, não passam pela parada nem pelo
  registro: elas lançam a venda do totem na loja, e parar a integração não pode parar o totem de vender.

| Variável | Valor |
| --- | --- |
| `HUB_LIGADO` | `true` liga o registro, os erros, a batida e a lista de parada |
| `HUB_URL` | o endereço `https` do hub |
| `HUB_RECURSO` | o identificador do recurso do hub no DMS ID (o destino do token) |
| `HUB_APLICATIVO` e `HUB_SEGREDO` | o aplicativo do Regem no DMS ID (client_id e segredo), com a função de produto no hub |
| `ACEITAR_INTEGRACOES` | ausente ou `true` aceita; qualquer outro valor para toda chamada de integração |

O emissor é o mesmo `DMS_ID_EMISSOR` da via. Configuração torta não liga o hub e não derruba a API: o log diz o que
corrigir ("hub desligado: …").

## 8. Os avisos no hub e a parada (F3, parte D)

Decisão F3-3: o hub vê e para, mas não entrega. Os avisos (os webhooks registrados em `PUT /integracao/webhook`)
continuam saindo do job do Regem; o que muda vale com o hub ligado (`HUB_LIGADO`), menos a chave própria, que vale
sempre.

- **Registro:** cada envio vai ao hub, por rota própria (`POST /api/v1/avisos`, pacote comum 0.4.0): o `webhook-id`
  daquele envio (o mesmo que o destino recebe; um por tentativa), o cliente que recebe, o prefixo visível do acesso (o
  da ligação do DMS ID, quando ativa; senão o do `rgm_it_`), a loja e o nome comercial, o tipo (`pedido.alterado`,
  `cupom.usado`, `catalogo.alterado`…), o resultado (`entregue`; `recusado` = o destino respondeu 4xx, menos 408 e 429;
  `falhou` = sem resposta, 5xx, 408, 429 ou redirecionamento; `pausado` = o Regem parou de mandar para aquele destino),
  o status, a duração, a tentativa e só a origem do destino. Nunca o conteúdo, o caminho do destino nem o segredo. O
  hub de antes responde 404 à rota, e o pacote para de mandar avisos por 30 minutos, sem mexer no registro das chamadas.
- **Parada:** conferida antes de cada envio, pela última lista lida.

  | Nível na lista do hub | O que acontece com o aviso |
  | --- | --- |
  | `geral` ou `aplicativo` (o cliente: `liame`, `farol`…) | nem entra na reserva: nada sai e nada se grava por loja |
  | `ligacao` (o prefixo do `rgm_it_` ou o da ligação do DMS ID) | a reserva daquela loja é solta e ela volta em 30 s |
  | `ferramenta` = `aviso <tipo>` (`aviso pedido.alterado`) | idem, só para aquele tipo |

  Parado, o aviso não sai, não conta como falha e não anda a posição (`avisado_ate`): sai quando a parada acaba, como
  um aviso atrasado. Para quem recebe, nada muda além do atraso: o aviso é só gatilho, e a leitura com cursor segue.
- **Chave própria:** `ACEITAR_INTEGRACOES` desligada segura também os avisos (decisão D-2, confirmada pelo dono em
  21/10/2026), com ou sem o hub, do mesmo jeito: nada sai e a posição de cada loja fica onde está.
- **O estorno do GoGeM (decisão D-1, 21/10/2026):** o pedido de estorno ao GoGeM (fila `aviso_integracao`,
  `gogem-aviso.service.ts`) aparece no registro do hub, e **nenhuma parada o segura**: nem a lista do hub nem a chave
  própria atrasam a devolução do dinheiro do cliente. Cada tentativa da nuvem ao GoGeM vai ao registro, pelos dois
  caminhos (o assinado, no endereço que o GoGeM registrou, e o do token de antes): o tipo `pedido.cancelado`, o código
  `aviso_<id do aviso>:<tentativa>` (o `webhook-id` é o mesmo em todas as tentativas, e no hub cada tentativa é uma
  linha), o prefixo do token de integração do GoGeM só no caminho assinado (o token do equipamento não tem prefixo
  público), a loja, só a origem do destino, o status e a duração. O sucesso é o do estorno, não o do HTTP (V30): um 200
  com o estorno que não saiu volta para a fila e no hub vale `falhou`, com o 200. O servidor da loja só repassa à
  nuvem e não registra nada; quem registra é a nuvem, no envio dela. No console do hub, a lista de ferramentas da
  parada pode oferecer `aviso pedido.cancelado`: parar por ali não segura o estorno.

## 9. A autorização por clique (F3, parte C; migration 336)

Padrão DMS §3, com as decisões do dono de 21/10/2026 (C-1 a C-5, todas na opção recomendada; protótipo aprovado no
hub, `prototipos/autorizacao-no-regem.html`). O contrato é o da B1 do RegemCast (`docs/mcp.md` de lá): os mesmos
campos, as mesmas frases de recusa para quem programa e o mesmo `iss` na volta, para o Liame usar o mesmo código nos
dois produtos. **Nasce desligada**: `AUTORIZACAO_POR_CLIQUE=true` liga, junto com `AUTORIZACAO_DMS_RAZAO_SOCIAL` e
`AUTORIZACAO_DMS_CNPJ` (a empresa dona dos aplicativos, que a tela mostra) e com a via do DMS ID ligada; configuração
torta deixa a autorização indisponível, com o motivo no log, sem derrubar a API. Só o Liame usa o clique (F3-1): o
Farol segue na página de 01/10, e a página e a troca de 01/10 continuam valendo para quem não usa o clique.

**O caminho:**

1. O servidor do Liame empurra o pedido (RFC 9126): `POST /api/v1/integracao/autorizacao/pedido`, com
   `Authorization: Bearer <token do DMS ID>`, em formulário ou JSON: `response_type=code`, `client_id` (opcional; o
   do token), `redirect_uri` (um dos cadastrados, `INTEGRACAO_LIAME_REDIRECT_URIS`), `scope` (separado por espaço;
   pode pedir menos), `state` (16 a 200 visíveis), `code_challenge` (S256, 43) e a conta que pede: `conta_nome`,
   `conta_cnpj` (opcional), `conta_email`, `conta_marca` (opcional). Resposta **201** `{ request_uri, expires_in: 600 }`
   (`urn:ietf:params:oauth:request_uri:rgm_…`; uso único; só o resumo fica gravado).
2. A pessoa abre `https://app.dmsregem.com/integracoes/autorizar?client_id=…&request_uri=…`. A página lê
   `GET /api/v1/integracoes/autorizacao` (sessão do Regem) e recebe uma situação: `indisponivel`, `invalido` (vencido,
   usado, de outro aplicativo ou torto), `pausado` (o Liame na lista de parada do hub, ou a chave própria desligada),
   `nao_presidente`, `travada` (com os minutos) ou `escolha`, com a **tela montada no servidor** (os textos aprovados:
   quem pede, a conta que pede, as lojas, as necessárias, as opcionais nascendo desligadas — o custo também, C-1 —, o
   telefone num bloco próprio, o que o Liame não pode, a nota e o rodapé; com mais de uma loja, nenhuma vem marcada,
   C-2; a loja já conectada soma, e com todas conectadas e permissão nova a tela "pede mais").
3. O presidente autoriza: `POST /api/v1/integracoes/autorizacao` com `{ clientId, requestUri, senha, lojas,
   opcionais, confirmoOutraEmpresa }`. A **senha do Regem** de quem clicou (nunca o PIN), conferida ANTES da validade
   do pedido: errada → 422 com quantas faltam; 5 erradas em 15 minutos travam a autorização por 15 minutos (423; a
   entrada no Regem não muda). A conta de outra empresa — pela **raiz do CNPJ**, os 8 primeiros números (C-3); sem
   CNPJ conta como outra — exige a confirmação (400 sem ela). Opcional não pedida e custo sem "Ver valores em R$": 400.
   Pedido vencido ou usado: 410. Grava a prova (o texto mostrado, versão 1, com a decisão), gasta o pedido e devolve
   `{ redirect }`: o endereço cadastrado com `code`, `state` e `iss` (a origem da API do Regem). Recusar
   (`POST …/recusar`, qualquer nível) gasta o pedido e volta com `error=access_denied`, `state` e `iss`.
4. O servidor do Liame troca o código: `POST /api/v1/integracao/autorizacao/token` **com o token do DMS ID** (sem ele,
   é a troca de 01/10), `grant_type=authorization_code`, `code`, `code_verifier`, `redirect_uri`. O código é gasto
   antes de qualquer conferência (o PKCE errado ou o endereço diferente também gastam), e o código usado de novo
   desliga o que ele criou. Resposta `{ lojas: [{ loja_id, loja_nome, empresa_nome, fuso, moeda, escopos,
   cardapio_url, ligacao, prefixo, permissoes, segredo_em }] }`: **uma ligação por loja** (F3-4), o segredo só aqui.
   Por dentro, cada loja ganha uma linha de token com o segredo descartado (a 329 pede o mesmo id) e a ligação no mesmo
   id; o acesso ativo da loja com o Liame (o do console, o da página de 01/10, a ligação da troca automática ou um
   clique anterior) é trocado na mesma transação, e o que ele liberava continua (soma). Duas trocas da mesma loja ao
   mesmo tempo: o índice único decide, e a segunda recebe 400 ("terminou agora mesmo").

**Depois:** os presidentes da empresa recebem e-mail depois da troca ("foi autorizado" para loja nova; "passou a
receber" para a permissão a mais; renovar com o mesmo não manda nada). Em Aplicativos conectados, o acesso do clique
aparece com `via: 'clique'`, a autorização (quem, quando, a versão, o texto guardado, a conta que pede) e o histórico,
da auditoria. A limpeza dos códigos vencidos da página de 01/10 não apaga a prova do clique.

**As telas:** `/integracoes/autorizar` com `request_uri` abre a tela do clique; sem ele, a página de 01/10. A página não
monta texto: desenha a `tela` que o servidor manda (os mesmos textos que ficam guardados como prova) e cada situação;
depois de autorizar ou recusar, mostra "voltando ao Liame" e segue para o `redirect` (com o link para continuar se o
navegador não for sozinho). Aberta dentro do Instagram ou do Facebook, avisa para abrir no navegador — a volta ao Liame
pode cair no navegador de dentro do aplicativo. Antes do login, o aviso é genérico ("Entre para autorizar o
aplicativo"): o `client_id` do link não diz o nome, e a página não pergunta à API sem sessão. Em Aplicativos
conectados, **Detalhes** abre a gaveta do acesso, com "Ver o texto que você autorizou" para o acesso do clique.

**A migration 336 (só nuvem, sem `drop`):** `integracao_pedido`; a prova na `integracao_autorizacao` (pedido, conta que
pede, outra empresa, opcionais desligadas, texto e versão); `integracao_token_loja.autorizacao_id` com o índice único
de um acesso ativo do clique por loja e aplicativo; e `integracao_autorizacao_trava` (as senhas erradas, fora do
`colaborador`, que sincroniza com a loja).

## 10. O aplicativo de parceiro (F4, parte F; PRs R1a e R1b — nasce desligado)

Um **parceiro** é o aplicativo de outra empresa que a DMS aprovou no portal de parceiros (F4, partes B e C). A R1a (#732)
abre a **porta** para ele; a R1b, a **autorização por clique** que cria a ligação dele (seção 11); os avisos de parceiro
são a R2. Só nuvem.

**Quando ele entra:** só com `PARCEIROS_LIGADOS=true`, o hub ligado (`HUB_LIGADO`) e a via do DMS ID ligada. O cliente do
hub passa a ler também a lista de aplicativos aprovados (`GET /api/v1/aplicativos` do hub, com um token à parte, de
permissão `aplicativos.ler`): ao iniciar e quando a batida mostra versão nova. Nenhum parceiro vale antes de a lista de
parada ser lida uma vez pelo processo (senão um parceiro parado entraria enquanto o hub está instável). O client_id que
está em `DMS_ID_APLICATIVOS` é sempre da DMS, mesmo se aparecer na lista do hub. Da lista ficam de fora (com o motivo
no log): o client_id repetido, o nome de produto da DMS e o aplicativo sem nenhuma permissão necessária dentro do teto
e da etapa. Desligado, fora da lista ou com a ligação de outro cliente, a resposta é a mesma 401 `ligacao-invalida` de
sempre.

**Quem ele é no Regem:** o `cliente` das tabelas é `parceiro_` + 24 dígitos hex do SHA-256 do client_id (não leva o
client_id, que é da distribuição). No hub, ele é registrado e parado pelo **client_id** (a parada de nível
`aplicativo` e a suspensão automática da F4-7). O acesso dele só vale pela ligação: o `rgm_it_` de um acesso de
parceiro é recusado (401), também nas rotas do totem.

**O que ele pode:** as permissões da ligação E do token do DMS ID E as do teto da classe (`ESCOPOS_DO_PARCEIRO`) que o
hub aprovou; as sensíveis (o telefone no pedido e o custo) só na etapa de produção com dado pessoal aprovado — na de
teste, nunca. A lista do hub nunca passa do teto do código.

**O que muda na resposta:** em `GET /integracao/pedidos`, o parceiro recebe só as vendas **confirmadas depois que a
autorização dele começou** (decisão do dono, 24/10/2026; a autorização contínua — `ler_desde`, seção 11 — ou, sem ela,
a criação do acesso) e **`origem: null`**: a origem do anúncio foi capturada com o aviso do
cardápio que nomeia o Liame (F4-13). Em `GET /integracao/clientes/anonimizados`, a mesma janela: só os pedidos de
esquecer feitos depois (dos de antes, ele nunca leu o cliente). `GET /integracao/producao` é a fila viva da cozinha (até
24 horas), não histórico: fica como é. A captura da origem passa a depender só do token do Liame (hoje já era assim, na
prática). `PUT /integracao/webhook` do parceiro responde 422 até a R2.

**Limite e suspensão:** além dos 60 por minuto por ligação, o parceiro tem 300 por minuto **por empresa** (todas as lojas
dele nela), contados na mesma ida ao banco (chave `emp:<cliente>:<empresa>` na `integracao_limite`). Só conta a chamada
que passou no limite da própria ligação, de parceiro aprovado e de ligação não suspensa: uma loja em laço não esgota a
cota das outras. A ligação de parceiro sem uso há 90 dias (a régua `situacaoChave` do pacote) responde 403
`ligacao-suspensa` — depois das recusas 401, para quem não tem a ligação não saber que ela existe; volta com um clique novo
da loja. O relógio dos 90 dias corre também enquanto o Regem recusa o parceiro (parado pelo hub, ou com a chave
desligada): 90 dias sem uso suspendem do mesmo jeito.

**Testes:** `parceiros.regras.spec.ts` (as regras puras) e `integracao-parceiro.http.spec.ts` (Postgres e HTTP, com o DMS
ID e o hub de mentira; as ligações de parceiro preparadas no banco), que roda também o kit no modo do DMS ID com as
credenciais de parceiro: a classe, a ligação suspensa e a parada passam.

**Para ligar (distribuição):** no hub, o papel do Regem com `aplicativos.ler` (feito em 24/10/2026); a migration 340 na
nuvem (seção 11); no EasyPanel do `regem-api`, `PARCEIROS_LIGADOS=true` e reiniciar. A autorização por clique também
precisa estar ligada (`AUTORIZACAO_POR_CLIQUE`, seção 9).

## 11. A autorização por clique do parceiro (F4, parte F, PR R1b; migration 340)

O mesmo clique da seção 9 (pedido empurrado com o token do DMS ID, a tela, a senha do presidente, o código, a troca por
uma ligação por loja), com o que é do parceiro:

- **Quem usa:** o client_id de `DMS_ID_APLICATIVOS` é da DMS e nunca vira parceiro (o Farol, o GoGeM e o RegemCast, que
  não usam o clique, ficam de fora mesmo se o hub os listar). O parceiro aprovado (seção 10) usa, com os endereços de
  volta da lista do hub que forem https, com nome (nunca `localhost`). O pedido tem de trazer ao menos uma permissão
  necessária (vale para todos: sem ela, a autorização com as opcionais desligadas não daria permissão nenhuma).
- **A tela:** selo "Verificado pela DMS"; a empresa e o CNPJ (também o alfanumérico) são os conferidos pela DMS, no lugar
  dos da DMS; o "para que serve" vai entre aspas, nas palavras do parceiro; as necessárias e as opcionais pela marca dele
  (as opcionais nascem desligadas, F4-14), cortadas pelo teto e pela etapa; frases próprias (`FRASES_DO_PARCEIRO`: os
  pedidos sem a origem do anúncio; o catálogo, as fichas e a fila da cozinha com os textos do Farol) — o catálogo do
  clique e o manifesto não mudam; a **confirmação de outra empresa SEMPRE** ("os dados vão para a <razão social>,
  conferida pela DMS; a conta foi informada pelo próprio aplicativo"), exigida e gravada pela tela; e, no "não pode", a
  janela de leitura com a data de verdade ("desta autorização", ou "de antes de <data>" no modo "mais"). O texto tem a
  versão própria (`VERSAO_DO_TEXTO_PARCEIRO`) e a prova diz `classe: 'parceiro'`.
- **O texto que o presidente leu:** a tela do parceiro traz um resumo (SHA-256 do que ele lê), que a página devolve ao
  autorizar. Se a lista do hub mudou entre abrir e clicar (o nome, a empresa, as permissões), o servidor responde 409 e a
  página abre de novo, com o texto novo. A tela do Liame não muda (provado byte a byte, com a ordem das chaves).
- **As 3 lojas da etapa de teste (F4-12):** a conta que vale é a da **troca**, dentro da transação e sob a trava de
  transação do aplicativo (`pg_advisory_xact_lock`): as lojas com acesso vivo do parceiro em todas as empresas, fora as
  desta troca, mais todas as desta troca. Passou: 400 com a frase do limite, o código fica gasto e a empresa fica com o
  registro `integracao.troca_recusada`. Antes, só para a frase certa: a tela conta as lojas de OUTRAS empresas (vivas e
  autorizações pendentes) e mostra as vagas; sem vaga e sem loja ligada aqui, a situação `limite`; ao autorizar, marcar
  além das vagas é recusado. A ligação suspensa (90 dias sem uso) não segura vaga.
- **A janela que atravessa a re-autorização (migration 340):** a troca grava `integracao_token_loja.ler_desde` na mesma
  transação — o do acesso que ela substitui, se ele estava vivo (o modo "mais" não reinicia a janela), ou agora. O acesso
  suspenso não passa a janela nem as permissões de antes: a loja recomeça (a tela a trata como nova e o e-mail é o de
  autorização nova). A porta só lê a coluna para o parceiro; os produtos da DMS não dependem dela.
- **Aplicativos conectados:** o nome e a empresa do parceiro saem do texto guardado do clique (a prova), nunca da lista do
  hub; o selo "Parceiro verificado pela DMS"; as frases do que ele recebe vêm do servidor; a situação "suspenso" para a
  ligação parada há 90 dias; "Revogar todos" aceita o parceiro (só nesta empresa, como sempre).
- **Os e-mails:** o nome e a empresa vêm da prova; o texto diz para onde os dados vão ("conferida pela DMS"), com as
  frases e o "não pode" do parceiro. Os do Liame não mudam.
- **A parada:** pelo client_id do parceiro (o pedido recebe 503 e a tela diz "pausado").

**A migration 340 (só nuvem, sem `drop`):** a coluna `integracao_token_loja.ler_desde` e o índice dos acessos ativos por
cliente (a conta das lojas), com a conferência no mesmo Run (duas linhas `ok`). Tem de estar na nuvem antes do merge.

**Testes:** `autorizacao-clique-parceiro.http.spec.ts` (o clique de ponta a ponta, as vagas, a corrida das 3 lojas na
troca com o cruzamento forçado — V72 —, a janela no modo "mais" e na suspensão, Aplicativos conectados, a parada, o
Liame que segue Liame), `parceiros.regras.spec.ts` (a tela e as regras do parceiro) e, na porta, o
`integracao-parceiro.http.spec.ts` (a janela pelo `ler_desde`).

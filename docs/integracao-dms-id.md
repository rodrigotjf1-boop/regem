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
arquivo do repositório. No modo do DMS ID, ficam puladas só as conferências opcionais: as três da parte F da F4 (a
classe, a ligação suspensa e a parada) e as sete da conta, do cursor e da escrita, que pedem configuração própria
(kit da parte J), além da dos metadados da MCP.

**O manifesto da porta (Padrão §13):** `GET /.well-known/dms-manifesto`, sem credencial e fora do prefixo `/api/v1`, só
na nuvem. É a documentação pública da porta de integração: OpenAPI 3.1 com os campos `x-dms`, montado do próprio código
(`manifesto-integracao.ts`): os escopos (a frase da tela do clique; sem ela, o rótulo do console), a classe `dms` (o
parceiro vem na parte F), o limite de 60 por minuto por ligação, as 15 rotas de `/integracao` com exemplos fictícios, os
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

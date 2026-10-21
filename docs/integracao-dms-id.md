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
| 429 `limite-de-chamadas` | 60 chamadas por minuto por acesso (as duas vias somam) | esperar o `Retry-After` (segundos) |
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
formato dos erros; o limite. Ele roda no Node 22.6 ou mais; o CI o roda num passo próprio com o Node 22.

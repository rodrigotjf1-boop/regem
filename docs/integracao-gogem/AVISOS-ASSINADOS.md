# Avisos assinados do Regem ao GoGeM — contrato 1

**Versão do contrato:** 1, de 19/10/2026 · **Do lado do Regem:** fase 2 da credencial própria do GoGeM
(`docs/pedido-hub-dms-credencial-propria-do-gogem.md`) · **Do lado do GoGeM:** fase 3.

Este arquivo é o que a sessão do GoGeM precisa para receber os dois avisos que o Regem manda hoje com o `X-Sync-Token`.
Os avisos passam a sair assinados no padrão **Standard Webhooks**, o mesmo que o Regem já usa com o Liame e o Farol e
que o Padrão DMS de integração adotou (§9 do `C:\HubDMS\docs\padrao-dms-integracao.md`).

## 1. O que muda e o que não muda

**Muda só o envio da nuvem do Regem para a nuvem do GoGeM**, e só para a loja cujo GoGeM registrar o endereço (§2).
São dois avisos:

| Aviso | Hoje | Depois do registro |
| --- | --- | --- |
| Venda do totem cancelada no Regem (pedido de estorno) | `POST {GoGeM}/sync/regem/pedido-cancelado` com `X-Sync-Token` | `POST` no endereço registrado, `tipo: "pedido.cancelado"`, assinado |
| Botão "Publicar no GoGeM" | `POST {GoGeM}/sync/regem/publicar` com `X-Sync-Token` | `POST` no endereço registrado, `tipo: "catalogo.publicar"`, assinado |

**Não muda:**

- **a rede da loja:** o totem continua falando com o servidor da loja, e o servidor da loja continua repassando à
  nuvem do GoGeM o que é dela (pagamento, pareamento, telemetria, atualização);
- **as 5 rotas que o GoGeM chama no Regem:** catálogo, pausa e as três de venda. Elas aceitam o `Bearer rgm_it_`
  da fase 1, e o `X-Sync-Token` também, até a fase 4;
- **o servidor da loja:** um cancelamento feito no servidor da loja continua indo à nuvem do Regem, e só a nuvem
  fala com o GoGeM. Quem assina é a nuvem do Regem;
- **as ligações com outros produtos e com o Hub DMS:** o Liame e o Farol seguem com os avisos deles. O GoGeM não
  recebe aviso de frescor ("pedido alterado", "catálogo alterado"…), porque os escopos do token dele não liberam
  nenhum. Os outros produtos também não recebem os avisos do GoGeM.

Enquanto o GoGeM não registrar o endereço, o Regem segue exatamente como hoje.

## 2. Como o GoGeM liga os avisos (uma vez por loja)

Com o token `rgm_it_` da loja (o do cliente "GoGeM", emitido em Distribuição › Tokens de integração):

```http
PUT https://api.dmsregem.com/api/v1/integracao/webhook
Authorization: Bearer rgm_it_…
Content-Type: application/json

{ "url": "https://api.gogem.com.br/api/v1/sync/regem/avisos/<id da integração no GoGeM>",
  "segredo": "whsec_<base64 de 24 a 64 bytes aleatórios>" }
```

- **O segredo é do GoGeM:**
  - ele gera 32 bytes aleatórios, monta o `whsec_` + base64 e guarda cifrado;
  - o Regem também guarda cifrado e nunca devolve o segredo.
- **O endereço** tem de começar por `https://api.gogem.com.br/api/v1/sync/regem/avisos/`.
  - Depois desse começo vem **um trecho só**, de até 64 caracteres, só com letras, números, `-` e `_`.
  - Esse trecho é o id da integração no GoGeM. É por ele que o GoGeM acha o segredo para conferir a assinatura.
  - Endereço fora disso → `422 endereco-nao-permitido`. Segredo fora do formato → `400`.
- **Respostas:** `200` com a situação do registro. `GET` mostra a situação (nunca o segredo). `DELETE` para os
  avisos e responde `204`.
- **Trocar o segredo:** `PUT` de novo com o segredo novo. A troca vale na hora; o GoGeM deve aceitar o segredo
  antigo por mais 10 minutos, por causa de um aviso que já estava saindo.
- **O registro é preso ao token:** token novo (troca ou revogação) apaga o registro e o segredo.
  - Ao trocar o token, o GoGeM faz o `PUT` de novo, logo em seguida.
  - Sem registro, até a fase 4, o Regem volta ao caminho antigo, com o `X-Sync-Token`.

## 3. O envio

```http
POST https://api.gogem.com.br/api/v1/sync/regem/avisos/<id>
content-type: application/json
user-agent: Regem-Integracao/1
webhook-id: aviso_5d9f1c2e-7b3a-4c1d-9e8f-0a1b2c3d4e5f
webhook-timestamp: 1792444445
webhook-signature: v1,HCkTVm4dLgQ3u7I1gRWpJRTcGU2jcgTizQ7kZe1t/7U=
X-Sync-Token: <o token de hoje>          ← só até a fase 4 (§7); não use para autenticar a rota nova
```

- `webhook-signature` = `v1,` + base64 do HMAC-SHA256 de `"<webhook-id>.<webhook-timestamp>.<corpo>"`.
  - A chave é o segredo **decodificado do base64**, sem o `whsec_`.
  - O corpo é o **texto exato recebido**, antes de qualquer `JSON.parse` (no Nest: `rawBody: true`).
- O Regem não segue redirecionamento: responda no próprio endereço.
- O prazo para responder é de **5 segundos**. A primeira tentativa do cancelamento acontece com o atendente
  esperando na tela.

### O que o GoGeM confere, nesta ordem

1. Acha a integração pelo trecho do endereço; não achou ou está desligada → `401`.
2. `webhook-timestamp` a mais de 5 minutos do relógio do GoGeM, para mais ou para menos → `401`.
3. Recalcula a assinatura e compara em tempo constante (`timingSafeEqual`).
   - O cabeçalho pode trazer mais de uma assinatura, separadas por espaço; vale se uma bater.
   - Nenhuma bate → `401`.
4. `contrato` diferente de `1` → `422 contrato-nao-suportado`.
5. Se o GoGeM guarda a loja do Regem na integração e `loja_id` não bate → `403`. A assinatura já prende o aviso
   à integração; esta conferência é uma segunda trava.

### Vetor de teste

Com o segredo de exemplo do próprio Standard Webhooks, a assinatura do §3 tem de sair igual:

```text
segredo            whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw
webhook-id         aviso_5d9f1c2e-7b3a-4c1d-9e8f-0a1b2c3d4e5f
webhook-timestamp  1792444445
corpo              {"tipo":"pedido.cancelado","contrato":1,"loja_id":"3f2a6b1c-0d4e-4f5a-8b9c-1d2e3f4a5b6c","cancelado_em":"2026-10-19T21:14:05.000Z","pedido":{"idempotencyKey":"totem-7f3e9a","regemComandaId":"9b8c7d6e-5f4a-4b3c-2d1e-0f9a8b7c6d5e","motivo":"Cliente desistiu"}}
assinatura         v1,HCkTVm4dLgQ3u7I1gRWpJRTcGU2jcgTizQ7kZe1t/7U=
```

## 4. Evento `pedido.cancelado` — venda do totem cancelada no Regem

```json
{
  "tipo": "pedido.cancelado",
  "contrato": 1,
  "loja_id": "<uuid da loja no Regem>",
  "cancelado_em": "2026-10-19T21:14:05.000Z",
  "pedido": {
    "idempotencyKey": "<a chave que o totem mandou na venda, até 120>",
    "regemComandaId": "<uuid da comanda no Regem, opcional, até 120>",
    "motivo": "<texto do atendente, até 500>"
  }
}
```

- **`pedido` é o corpo de hoje, sem mudança**: o GoGeM pode reaproveitar o `CancelarTotemDto` e o
  `cancelarPorChave`. Nenhum dado pessoal vai no aviso.
- **`webhook-id` = `aviso_<uuid do aviso no Regem>`**, o mesmo em todas as tentativas do mesmo cancelamento.
  `webhook-timestamp` e assinatura são refeitos a cada tentativa.
- ⚠️ **Repetido não é para ignorar.** O Regem só repete quando não recebeu resposta ou quando o estorno eletrônico
  falhou (`feito: false` com cartão ou PIX).
  - Ao receber o mesmo `webhook-id` de novo, rode o cancelamento de novo e devolva o resultado atual.
  - O `cancelarPorChave` já é idempotente, e o `X-Idempotency-Key` do Mercado Pago impede estorno em dobro.
  - Responder `200` vazio a uma repetição faz o Regem achar que o estorno não foi pedido.

### O que o GoGeM responde, e o que o Regem faz

| Resposta | O Regem entende | E faz |
| --- | --- | --- |
| `200` `{ "status": "cancelado", "pedidoId", "estorno": { "feito": true, "meio", "valorCentavos", "refundId", "mensagem" } }` | estorno pedido | encerra; o atendente vê "Estorno de R$ X solicitado" |
| `200` com `estorno.feito: false` e `meio` `dinheiro` ou `desconhecido` | nada eletrônico a estornar | encerra; o atendente devolve no balcão |
| `200` com `estorno.feito: false` e meio eletrônico | o Mercado Pago falhou agora | repete (abaixo) |
| `200` sem `estorno` | cancelado sem detalhe | encerra; pede para conferir no painel do GoGeM |
| `401` ou `403` | integração recusou | tenta de novo a cada 6 h e avisa o atendente |
| `404` ou `410` **na rota nova** | endereço errado ou removido | trata como `401` (6 h), nunca como "recusado" |
| `408`, `425`, `429`, `5xx`, sem resposta, mais de 5 s | falha passageira | repete (abaixo); respeita `Retry-After` de até 24 h |
| outro `4xx` (`400`, `409`, `422`) | recusado de vez | encerra; o estorno vira manual. Mostra ao atendente o `message` ou `mensagem` do corpo (até 200 caracteres) |

- **Pedido não encontrado:** responda `422` com `{ "code": "pedido-nao-encontrado", "message": "…" }`, não `404`.
- **Repetição:** depois de 1, 2, 5, 10, 30, 60, 120, 240, 480 e 720 minutos (e daí a cada 720).
  Passados 7 dias sem entrega, o aviso sai da fila com alerta, e o estorno vira manual.

## 5. Evento `catalogo.publicar` — o botão "Publicar no GoGeM"

```json
{
  "tipo": "catalogo.publicar",
  "contrato": 1,
  "loja_id": "<uuid da loja no Regem>",
  "pedido_em": "2026-10-19T21:20:00.000Z"
}
```

- `webhook-id` = `publicar_<uuid novo>`, um por clique.
- **Resposta:** `200` `{ "alterados": <número> }`. O Regem mostra "Publicado no GoGeM: N produto(s)
  sincronizado(s)."
- **Sem repetição.** Se falhar, o atendente vê o erro e clica de novo; o poller do GoGeM segue como rede de
  segurança.
- **Qual registro:** o da loja em uso pelo atendente. Se a loja não tem registro, vale o caminho de hoje.

## 6. Ordem para ligar sem quebrar

| Fase | Quem | O que faz | Risco de quebrar |
| --- | --- | --- | --- |
| 2 | Regem | Passa a assinar quando houver registro. Sem registro, nada muda. | nenhum: nenhuma loja tem registro |
| 3 | GoGeM | Cria `POST /sync/regem/avisos/:id`, que confere a assinatura (§3), atende os dois `tipo` e responde como no §4 e no §5. Também troca o `X-Sync-Token` pelo `Bearer rgm_it_` nas 5 rotas. Só então faz o `PUT` de cada loja. | baixo: liga loja por loja; o `DELETE` desfaz na hora |
| 4 | Regem | Desliga o caminho antigo e para de mandar o `X-Sync-Token` | só depois de todas as lojas registradas e de um período combinado com o dono |

**Como provar a fase 3, numa loja:**

1. Registrar com o `PUT`.
2. Cancelar no Regem uma venda de teste do totem paga em PIX.
3. Conferir no GoGeM o estorno pedido e, no Regem, a mensagem "Estorno de R$ X solicitado".
4. Clicar em "Publicar no GoGeM" e ver o número de alterados.
5. Fazer o `DELETE` e repetir o cancelamento: tem de funcionar pelo caminho antigo.

## 7. Depois da fase 4

- O `X-Sync-Token` some dos avisos e os dois caminhos antigos param de ser chamados.
- Loja sem registro: o cancelamento fica "aguardando a integração", com a mesma mensagem e o mesmo prazo de 7 dias
  de hoje, e sai assim que o GoGeM fizer o `PUT`. "Publicar no GoGeM" diz que a integração não está ligada.
- Versão nova do contrato (`contrato: 2`) só com aviso ao GoGeM e com as duas versões valendo juntas por um tempo
  combinado.

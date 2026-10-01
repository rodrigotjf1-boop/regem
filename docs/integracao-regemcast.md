# Integração Regem → RegemCast (API de integração) — contrato v1

> Fonte da verdade do lado do Regem. O RegemCast (conector `backend/src/modules/regem`, PR #90 do
> RegemCast) consome exatamente isto. Mudou aqui → avisar o RegemCast antes do merge.
> Decisões do dono de 30/09/2026 (ver `docs/decisoes-design.md` §6).

## 1. Acesso

- **Base:** `https://api.dmsregem.com/api/v1`
- **Token:** `Authorization: Bearer rgm_it_…` (50 caracteres), emitido pela **distribuição** no console
  (Integrações → Tokens de integração → "Para quem: RegemCast · empresa inteira"), com a autorização do
  presidente da empresa. O token vale para a **empresa inteira** (todas as lojas). A loja não copia nada.
- **Escopos do RegemCast:**

  | Escopo | Libera |
  |---|---|
  | `clientes.ler` | `GET /integracao/clientes` |
  | `pedidos.ler` | `GET /integracao/pedidos` |
  | `clientes.telefone.ler` | o `cliente {id, telefone}` das vendas |
  | `vendas.99food.ler` | opcional — vendas e clientes da 99Food (autorização do dono registrada no RegemCast) |

- **Limite:** 60 chamadas/min por token → `429` com `Retry-After` em **segundos**.
- **Erros:** `application/problem+json` (`type`, `title`, `status`, `detail`). `401` = token ausente,
  inválido, vencido ou revogado. `403` = falta o escopo da rota (`detail` diz qual). `400` = parâmetro
  ou cursor inválido.
- **Troca de token:** o cursor é da EMPRESA, não do token — o token novo da mesma empresa segue do
  mesmo cursor.

## 2. `GET /integracao/loja` (qualquer escopo)

Com o token da empresa:

```json
{
  "empresa_id": "9b0c…",
  "empresa_nome": "Grupo Sabor",
  "lojas": [{ "id": "l1…", "nome": "Centro" }, { "id": "l2…", "nome": "Tijuca" }],
  "fuso": "America/Sao_Paulo",
  "moeda": "BRL",
  "escopos": ["pedidos.ler", "clientes.telefone.ler", "clientes.ler"]
}
```

`empresa_id` é **estável** (renomear a empresa não muda). A matriz vem primeiro em `lojas`.

## 3. Paginação (as duas listas)

- Query: `limite` (1 a 500, padrão 200) e `cursor` (o `proximo_cursor` da página anterior; ausente na
  primeira).
- Resposta: `{ "itens": [...], "proximo_cursor": "…", "tem_mais": true|false }`.
- Ordem estável por `(atualizado_em, id)`; só o que foi carimbado há mais de 15 s.
- `proximo_cursor` **sempre** vem (no fim também) — guarde e use para a consulta incremental.
- **Nunca** sai página vazia com `tem_mais: true` (o filtro de visibilidade é aplicado antes do limite).
- Um mesmo `id` pode aparecer de novo com `versao` maior: é a versão mais nova (substitua).

## 4. `GET /integracao/clientes` (`clientes.ler`)

Cliente vivo:

```json
{
  "id": "c1…",
  "versao": 3,
  "atualizado_em": "2026-09-30T18:02:11.123456Z",
  "nome": "Ana Souza",
  "telefone": "+5521999998888",
  "canais": ["anotaai", "cardapio"],
  "bairro": "Tijuca",
  "cidade": "Rio de Janeiro",
  "opt_out": { "ativo": false, "em": null, "origem": null },
  "aceite_marketing": { "aceito": true, "em": "2026-09-30T18:01:00.000000Z", "origem": "cardapio_checkout", "texto": "Quero receber promoções da Pizzaria Centro pelo WhatsApp" },
  "criado_em": "2025-11-02T14:00:00.000000Z",
  "removido": false
}
```

Lápide: `{ "id": "c1…", "versao": 4, "atualizado_em": "…", "removido": true }`.

- **Quem sai:** os clientes da empresa (todas as lojas) **com telefone**. **Nunca** quem só pediu por
  marketplace (`ifood`, `99food`, `ubereats`, `rappi`, `keeta`, `aiqfome`, `open_delivery`); só pela 99, **só com
  `vendas.99food.ler`**. Quem também pediu por canal próprio sai sempre. Cliente sem nenhum pedido
  (base importada, cadastro pelo login do cardápio) sai com `canais: []`.
- `telefone`: E.164 **com +55**, ou `null` quando o número não é um telefone brasileiro válido. **Não**
  se inventa o nono dígito: um celular antigo de 10 dígitos sai como está (`+552199998888`).
- `canais`: os canais em que o cliente fez pedido, no formato `^[a-z0-9_]+$` (`99food` exatamente
  assim), em ordem alfabética.
- `bairro` / `cidade`: do endereço salvo do cliente (o principal); `null` quando não há — distância
  ("~3.2 km") nunca sai como bairro.
- `opt_out.ativo`: `true` = o cliente pediu para sair (SAIR no WhatsApp, painel da loja, lista de
  exclusão) — em qualquer forma do número (com/sem 55, com/sem o nono dígito). `em`/`origem`: da saída;
  quem saiu e voltou vem com `ativo: false` e `em` = a data da volta.
- `aceite_marketing`: o último aceite/recusa do cliente; `null` = **nunca respondeu** (a caixinha do
  cardápio é desmarcada: não marcar NÃO é recusa). `aceito: false` = recusa explícita (desmarcou no
  perfil).
- `removido: true`: o cliente pediu para ser esquecido (LGPD — "Excluir conta" do cardápio). É o único
  jeito de um cliente sumir do Regem. Cadastro que a loja apaga ou mescla **não** existe hoje.

## 5. `GET /integracao/pedidos` (`pedidos.ler`)

As vendas **de todas as lojas** da empresa, carga inicial de **3 anos** (o RegemCast não precisa mandar
`confirmados_desde`). Campos usados pelo RegemCast (a venda traz mais — ver o contrato do Liame):

```json
{
  "id": "p1…", "versao": 2, "atualizado_em": "2026-09-30T18:05:00.123456Z",
  "canal": "cardapio", "grupo_canal": "cardapio", "situacao": "confirmado",
  "receita_centavos": 6490,
  "cliente": { "id": "c1…", "telefone": "+5521999998888", "novo": false },
  "criado_em": "…", "confirmado_em": "…", "faturado_em": "…", "cancelado_em": null,
  "itens": [{ "id": "…", "produto_id": "…", "nome": "Pizza Calabresa", "quantidade": "1", "receita_centavos": 5990, "custo_centavos": null }],
  "unidade_id": "l1…", "unidade_nome": "Centro",
  "tipo": "entrega", "bairro": "Tijuca", "cidade": "Rio de Janeiro", "taxa_entrega_centavos": 500
}
```

- `situacao`: `confirmado` | `cancelado` | `removido` (deixou de ser venda — desfazer).
- `tipo`: `entrega` | `retirada` (pedido) · `mesa` | `balcao` (comanda; o totem direto é balcão).
- `bairro`/`cidade`: só da **entrega** (`null` para retirada/balcão/mesa); distância nunca sai como bairro;
  sem cidade no pedido, a da loja.
- `taxa_entrega_centavos`: a taxa cobrada no pedido (comanda: 0).
- `cliente`: `null` em marketplace — **exceto** `99food` com `vendas.99food.ler`. Venda de comanda
  (balcão/mesa) não tem cliente. O telefone é o mesmo formato de `/clientes`.
- `cardapio_web` sai marcado pelo `canal` (o RegemCast descarta quando liga o Cardápio Web direto).

## 6. O que o RegemCast não recebe

Nada de marketplace além da 99 (e só com o escopo). Nenhuma escrita nesta versão (devolver o opt-out
ao Regem é a fase 2 — pede mudança no conector). Nada de outras empresas: todo filtro vem do token.

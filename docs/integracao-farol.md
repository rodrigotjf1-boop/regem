# Integração Regem → Farol (API de integração) — contrato v2

> Fonte da verdade do lado do Regem. O Farol (auditoria da operação por câmera, da DMS) consome
> exatamente isto. Mudou aqui → avisar o Farol antes do merge.
> Decisões do dono de 10/10/2026 (ver `docs/decisoes-design.md` §6).
> **v1** (11/10/2026): o catálogo e as fichas. **v2** (11/10/2026): a fila de produção (§6) — só
> acrescenta; nada da v1 mudou.

O Farol confere, pela câmera da bancada, se o lanche foi montado como a ficha manda. Para isso ele
precisa saber **o que a loja vende, do que cada produto é feito e o que a cozinha tem para fazer
agora**. Ele só LÊ — e nunca recebe preço, custo, margem, CMV, cliente ou venda.

## 1. Acesso

- **Base:** `https://api.dmsregem.com/api/v1`
- **Token:** `Authorization: Bearer rgm_it_…` (50 caracteres), **um por loja**. Nasce na autorização
  pela loja:
  1. o Farol abre `https://app.dmsregem.com/integracoes/autorizar` com `cliente=farol`,
     `redirect_uri`, `state`, `code_challenge` e `code_challenge_method=S256` (PKCE);
  2. o **presidente** da empresa marca as lojas na página "Autorizar o Farol" e autoriza. Não há o
     que ligar ou desligar: as três leituras vão juntas;
  3. o Regem devolve a pessoa ao `redirect_uri` com `code` e `state`;
  4. o servidor do Farol troca o código em `POST /integracao/autorizacao/token`
     (`code`, `code_verifier`, `redirect_uri`, `client_id=farol`, `client_secret`). A resposta traz
     `{ lojas: [{ loja_id, loja_nome, empresa_nome, fuso, moeda, escopos, cardapio_url, token }] }` —
     o token de cada loja aparece **só aqui**. O código vale 10 minutos e uma tentativa.
- **O que a distribuição configura no Regem** (ambiente do serviço `regem-api`):
  `INTEGRACAO_FAROL_CLIENT_SECRET` (32 caracteres ou mais; sem ele a página responde "ainda não
  disponível" e a troca recusa todo mundo) e, se o endereço de volta não for o padrão,
  `INTEGRACAO_FAROL_REDIRECT_URIS` (lista separada por vírgula). Padrão:
  `https://api.monitorfarol.com.br/v1/regem/retorno`.
- **Escopos do Farol:**

  | Escopo | Libera |
  |---|---|
  | `catalogo.ler` | `GET /integracao/catalogo` |
  | `fichas.ler` | `GET /integracao/fichas` |
  | `producao.ler` | `GET /integracao/producao` |

- **Limite:** 60 chamadas/min por token → `429` com `Retry-After` em **segundos**.
- **Erros:** `application/problem+json` (`type`, `title`, `status`, `detail`). `401` = token ausente,
  inválido ou revogado. `403` = falta o escopo da rota (`detail` diz qual).
- **Revogar:** o presidente, em **Configurações → Aplicativos conectados**; o próprio Farol, com
  `POST /integracao/autorizacao/revogar`; ou a distribuição, pelo console. Vale na chamada seguinte
  (não há cache). Autorizar de novo uma loja troca o token dela: o antigo passa a devolver `401`.
- **A loja vem do token.** Não existe parâmetro de loja nem de empresa.

## 2. `GET /integracao/loja` (qualquer escopo)

```json
{
  "loja_id": "l1…",
  "loja_nome": "Centro",
  "empresa_nome": "Grupo Sabor",
  "fuso": "America/Sao_Paulo",
  "moeda": "BRL",
  "escopos": ["catalogo.ler", "fichas.ler", "producao.ler"],
  "cardapio_url": null
}
```

## 3. O retrato e a versão (as três leituras)

- Cada rota devolve o **retrato inteiro** da loja (na fila de produção, o da janela — §6), com a
  `versao` dele (32 caracteres).
- Mande a versão que você guardou em `?versao=`. Se nada mudou, a resposta é só
  `{ "versao": "…", "atualizado": false }`.
- A versão é a **impressão do conteúdo**, não uma data: muda quando qualquer campo do retrato muda,
  e não muda quando muda o que não está nele (preço, custo). Salvar um produto de novo troca os ids
  das variações e dos adicionais dele — e a versão muda junto.
- **O que entra:** o que é da loja do token e o que está cadastrado sem loja (a rede). Empresa de
  uma loja só: tudo. O apagado não sai; o inativo sai com `ativo: false`.
- **Quais ids são fixos:** produto, ficha, categoria, setor, a etapa reutilizável (`etapa_id`) e a
  opção reutilizável (`opcao_id`). **Mudam a cada salvamento:** a variação, o grupo de adicionais e
  a opção do produto (`id`). O ingrediente da ficha não tem id. Trate cada resposta como retrato
  inteiro e case a variação pelo produto e pelo código (ou nome).
- Sugestão de leitura do catálogo e das fichas: uma vez a cada 5 a 10 minutos por loja, sempre com
  `?versao=`. A fila de produção pode ser lida de 15 em 15 segundos (o limite de 60 chamadas por
  minuto é do token, somando as três rotas).

## 4. `GET /integracao/catalogo` (`catalogo.ler`)

```json
{
  "versao": "9f2c1a…",
  "atualizado": true,
  "gerado_em": "2026-10-10T23:10:00.000Z",
  "loja_id": "l1…",
  "categorias": [{ "id": "c1…", "nome": "Burgers", "categoria_pai_id": "c0…", "ordem": 2, "ativo": true }],
  "setores": [{ "id": "s1…", "nome": "Montagem" }],
  "produtos": [
    {
      "id": "p1…",
      "codigo": "XB",
      "nome": "X-Burger",
      "descricao": "Pão, blend e queijo",
      "tipo": "variavel",
      "unidade_medida": "un",
      "categoria_id": "c1…",
      "vai_para_producao": true,
      "setor_producao_id": "s1…",
      "tempo_preparo_min": 12,
      "ficha_id": "f1…",
      "ativo": true,
      "variacoes": [{ "id": "v1…", "nome": "Duplo", "codigo": "XB-D", "fator_ficha": 2, "ativo": true }],
      "combo": [],
      "adicionais": [
        {
          "id": "g1…",
          "etapa_id": "e1…",
          "nome": "Adicionais",
          "tipo": "adicionar",
          "min": 0,
          "max": 3,
          "obrigatorio": false,
          "ordem": 0,
          "opcoes": [
            {
              "id": "o1…",
              "opcao_id": "r1…",
              "nome": "Bacon",
              "codigo": "AD-BAC",
              "ordem": 0,
              "informativa": false,
              "acrescenta": { "tipo": "insumo", "insumo_id": "i9…", "nome": "Bacon fatiado", "quantidade_estoque": 0.02, "unidade_estoque": "kg" },
              "retira": null
            }
          ]
        }
      ]
    }
  ]
}
```

- `tipo` do produto: `simples`, `variavel` ou `combo`. No combo, `combo` lista os produtos que o
  compõem (`produto_id`, `quantidade`).
- `variacoes[].fator_ficha`: quanto da ficha do produto a variação usa (o "Duplo" usa 2).
- `setores`: os setores **da loja do token**. O `setor_producao_id` do produto é o do cadastro e
  pode ser de outra loja da empresa (aí ele não aparece em `setores`).
- `adicionais[].tipo`: `adicionar` ou `remover`.
- `opcoes[].informativa`: a opção não tem código PDV — é só uma observação ("ponto da carne"); não
  acrescenta nem retira nada.
- `opcoes[].acrescenta` (grupo de adicionar), um de:
  - `{ "tipo": "insumo", "insumo_id", "nome", "quantidade_estoque", "unidade_estoque" }` — o item do
    estoque e quanto dele sai a cada vez que a opção é escolhida, na unidade do estoque;
  - `{ "tipo": "ficha", "ficha_id" }` — a opção é um preparo com ficha (uma porção por escolha);
  - `{ "tipo": "produto", "produto_id" }` — a opção é um produto (a bebida do combo);
  - `null` — não acrescenta nada que o Regem saiba.
- `opcoes[].retira` (grupo de remover): `{ "insumo_id", "sub_ficha_id", "nome" }` — o ingrediente da
  ficha que deixa de entrar ("sem cebola").

## 5. `GET /integracao/fichas` (`fichas.ler`)

```json
{
  "versao": "41b7e0…",
  "atualizado": true,
  "gerado_em": "2026-10-10T23:10:00.000Z",
  "loja_id": "l1…",
  "fichas": [
    {
      "id": "f1…",
      "nome": "X-Burger",
      "categoria": "lanche",
      "rendimento": 1,
      "rendimento_unidade": "porção",
      "porcao_tamanho": 1,
      "porcao_unidade": "unidade",
      "setor_id": "s1…",
      "ativo": true,
      "ingredientes": [
        { "ordem": 0, "insumo_id": "i1…", "sub_ficha_id": null, "nome": "Pão brioche", "quantidade": 1, "unidade": "unidade", "quantidade_estoque": 1, "unidade_estoque": "unidade", "fator_correcao": 1, "so_delivery": false },
        { "ordem": 1, "insumo_id": null, "sub_ficha_id": "f7…", "nome": "Blend da casa", "quantidade": 0.12, "unidade": "kg", "quantidade_estoque": 0.12, "unidade_estoque": null, "fator_correcao": 1, "so_delivery": false },
        { "ordem": 2, "insumo_id": "i2…", "sub_ficha_id": null, "nome": "Queijo prato", "quantidade": 2, "unidade": "fatia", "quantidade_estoque": 0.04, "unidade_estoque": "kg", "fator_correcao": 1, "so_delivery": false }
      ]
    }
  ]
}
```

- Os ingredientes vêm **na ordem da ficha** (`ordem`).
- `quantidade` e `unidade`: como a pessoa informou na ficha ("2 fatia"). `quantidade_estoque` e
  `unidade_estoque`: a mesma quantidade na unidade do estoque do insumo (0,04 kg) — é a que a venda
  baixa. Sem item do estoque (sub-receita ou insumo escrito à mão), as duas quantidades são iguais
  e `unidade_estoque` é `null`.
- `sub_ficha_id`: o ingrediente é outra ficha (sub-receita) — ela vem na mesma lista.
- `so_delivery`: a linha só entra em pedido que sai da loja (a embalagem).
- `fator_correcao`: a perda no preparo (1 = sem perda).
- `rendimento`: quanto a ficha rende; o consumo de uma venda é
  `quantidade_estoque × fator_correcao ÷ rendimento`, vezes o `fator_ficha` da variação.

## 6. `GET /integracao/producao` (`producao.ler`)

A fila da cozinha da loja do token — o que o KDS mostra, sem o histórico.

```json
{
  "versao": "c07d5e…",
  "atualizado": true,
  "gerado_em": "2026-10-11T12:40:05.000Z",
  "loja_id": "l1…",
  "pedidos": [
    {
      "id": "pp1…",
      "numero": 41,
      "origem": "mesa",
      "canal": null,
      "consumo": "local",
      "status": "preparo",
      "setor_id": "s1…",
      "tempo_preparo_min": 12,
      "alterado": false,
      "criado_em": "2026-10-11T12:30:00.000Z",
      "iniciado_em": "2026-10-11T12:32:00.000Z",
      "pronto_em": null,
      "entregue_em": null,
      "cancelado_em": null,
      "itens": [
        {
          "id": "ppi1…",
          "produto_id": "p1…",
          "ficha_id": "f1…",
          "variacao": { "id": "v1…", "nome": "Duplo", "codigo": "XB-D", "fator_ficha": 2 },
          "descricao": "X-Burger · Duplo",
          "quantidade": 2,
          "observacao": "bem passado",
          "removido": false,
          "adicionais_texto": "+ 2x Bacon · sem Cebola",
          "adicionais": [
            {
              "tipo": "adicionar",
              "opcao_id": "r1…",
              "nome": "Bacon",
              "vezes": 2,
              "acrescenta": { "tipo": "insumo", "insumo_id": "i9…", "nome": "Bacon fatiado", "quantidade_estoque": 0.02, "unidade_estoque": "kg" },
              "retira": null
            },
            {
              "tipo": "remover",
              "opcao_id": null,
              "nome": "Sem cebola",
              "vezes": 1,
              "acrescenta": null,
              "retira": { "insumo_id": "i3…", "sub_ficha_id": null, "nome": "Cebola roxa" }
            }
          ]
        }
      ]
    }
  ]
}
```

- **A janela:** os pedidos **em produção** (`recebido` ou `preparo`) criados nas últimas 24 horas, e
  os **concluídos** (`pronto` ou `entregue`) ou **cancelados** nas últimas 2 horas. Vêm na ordem em
  que entraram na fila. Pedido que sai da janela some do retrato — e a versão muda.
- `status`: `recebido`, `preparo`, `pronto`, `entregue` ou `cancelado`. Cada loja usa as etapas que
  quiser: há loja que vai de `recebido` direto a `pronto`, e loja que não usa `entregue`. Quem avança
  é o **pedido inteiro**; o item não tem etapa.
- `origem`: `balcao`, `mesa`, `comanda`, `delivery` ou `totem`. `canal`: de onde veio o pedido de
  fora ("iFood", "Cardápio", "Totem"…), ou `null`. `consumo`: `local`, `viagem` ou `null`.
- `numero`: o número do pedido na fila da loja, no dia.
- `alterado`: o pedido mudou depois de entrar na fila (item acrescentado ou retirado).
- `itens[].produto_id`, `ficha_id` e `variacao`: como ficaram **na venda**. A `variacao.id` muda
  quando o produto é salvo de novo — case pelo `codigo` (ou nome). Item que foi retirado da venda
  sai com `removido: true` e sem produto; item de canal que não casou com produto do catálogo sai
  só com a `descricao`.
- `itens[].descricao` é o texto que a cozinha lê. No pedido feito pelo cardápio do Regem ele já
  traz as escolhas entre parênteses, e aí `adicionais_texto` vem `null`.
- `itens[].adicionais`: as escolhas do item, com o mesmo formato de `acrescenta` e `retira` do
  catálogo (§4) e o mesmo `opcao_id` (fixo). `vezes` = quantas vezes a escolha foi feita naquele
  item; `quantidade_estoque` é de **uma** vez. `opcao_id: null` = opção criada só naquele produto.
- `itens[].observacao`: o que foi escrito para a cozinha, como veio.
- **Atraso:** na loja que tem servidor próprio, a fila chega à nuvem pelo sincronismo — até um
  minuto depois. Na loja que roda só na nuvem, é na hora.
- **Não sai:** quem é o cliente (nome, telefone, CPF), a mesa, a senha de retirada, o motivo do
  cancelamento e qualquer valor.

## 7. O que NÃO sai, e por quê

| Não sai | Onde fica |
|---|---|
| Preço de venda, preço do adicional, preço promocional | no Regem |
| Custo do produto, do insumo e do ingrediente; margem; CMV e meta de CMV | no Regem |
| Cliente (nome, telefone, CPF), mesa, senha de retirada, motivo do cancelamento | no Regem |
| Venda, caixa, estoque (saldo), equipe, ponto | no Regem |

O teste `integracao-farol.http.spec.ts` monta um cadastro e uma venda cheios de preço, custo e dado
do cliente e varre as três respostas atrás de qualquer campo com nome de dinheiro ou de cliente e
de qualquer um daqueles valores. A leitura da fila nem toca a tabela da venda onde eles estão.

O token do Farol **não liga a cópia das vendas** que serve ao Liame e ao RegemCast (o carimbador):
a empresa que só tem o Farol conectado não ganha carga de vendas, fila nem reconciliação.

## 8. O que vem depois

- **O aviso do Farol para a cozinha** (o KDS por produto com baixa automática, e os alertas) vai
  pela **rede da loja** — decisão do dono em 10/10/2026 — e tem plano próprio, apresentado antes.

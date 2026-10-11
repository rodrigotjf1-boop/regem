# Integração Regem → Farol (API de integração) — contrato v1

> Fonte da verdade do lado do Regem. O Farol (auditoria da operação por câmera, da DMS) consome
> exatamente isto. Mudou aqui → avisar o Farol antes do merge.
> Decisões do dono de 10/10/2026 (ver `docs/decisoes-design.md` §6).

O Farol confere, pela câmera da bancada, se o lanche foi montado como a ficha manda. Para isso ele
precisa saber **o que a loja vende e do que cada produto é feito**. Ele só LÊ — e nunca recebe
preço, custo, margem, CMV, cliente ou venda.

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
  | `producao.ler` | a fila de produção — a rota entra na próxima versão deste contrato; o escopo já vai na autorização, para a loja autorizar uma vez só |

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

## 3. O retrato e a versão (as duas leituras)

- Cada rota devolve o **retrato inteiro** da loja, com a `versao` dele (32 caracteres).
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
- Sugestão de leitura: uma vez a cada 5 a 10 minutos por loja, sempre com `?versao=`.

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

## 6. O que NÃO sai, e por quê

| Não sai | Onde fica |
|---|---|
| Preço de venda, preço do adicional, preço promocional | no Regem |
| Custo do produto, do insumo e do ingrediente; margem; CMV e meta de CMV | no Regem |
| Cliente, venda, caixa, estoque (saldo), equipe, ponto | no Regem |

O teste `integracao-farol.http.spec.ts` monta um cadastro cheio de preço e custo e varre as duas
respostas atrás de qualquer campo com nome de dinheiro e de qualquer um daqueles valores.

O token do Farol **não liga a cópia das vendas** que serve ao Liame e ao RegemCast (o carimbador):
a empresa que só tem o Farol conectado não ganha carga de vendas, fila nem reconciliação.

## 7. O que vem depois

- **`GET /integracao/producao`** (`producao.ler`): a fila de produção da loja — os pedidos em
  produção e os concluídos das últimas 2 horas, com o produto de cada item, os adicionais, a
  observação e os horários; sem o cliente e sem valores. Entra na versão 2 deste contrato.
- **O aviso do Farol para a cozinha** (o KDS por produto com baixa automática, e os alertas) vai
  pela **rede da loja** — decisão do dono em 10/10/2026 — e tem plano próprio, apresentado antes.

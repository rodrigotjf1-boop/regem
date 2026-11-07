# Integração Regem ↔ Orzuni (cardápio do iFood) — contrato v1

> Fonte da verdade do lado do Regem. São **dois sentidos**, cada um pela porta de quem é chamado:
>
> 1. **Regem → Orzuni** (R2, no ar desde 06/11/2026): quando o preço do iFood ou a pausa mudam no Regem, o Regem chama
>    a porta MCP do Orzuni (`modules/orzuni/`, ligação `dms_lg_orzuni_…` guardada cifrada pela distribuição). O contrato
>    é o do Orzuni (`docs/porta-mcp.md` de lá).
> 2. **Orzuni → Regem** (este documento; migration 374): o Orzuni **lê** o catálogo da loja com o preço do iFood, para
>    montar no iFood o que está no Regem e falta lá. Só leitura.

## 1. Acesso

- **Base:** `https://api.dmsregem.com/api/v1`
- **Rota:** `GET /integracao/catalogo` — a MESMA do Farol (`docs/integracao-farol.md` §3 e §4: o retrato, a versão, os
  ids, a loja do token). Nada de `GET /sync/catalogo`: aquela rota é do totem (só a credencial do GoGeM passa, as outras
  recebem 403) e o `X-Sync-Token` é a credencial do **servidor da loja**, que nunca sai do Regem.
- **Permissões do Orzuni** (`CLIENTES_INTEGRACAO.orzuni`, um acesso **por loja**):

  | Permissão | Libera |
  |---|---|
  | `catalogo.ler` | `GET /integracao/catalogo` |
  | `catalogo.ifood.ler` | os campos do iFood no MESMO catálogo (seção 2). Sozinha não abre rota: sem `catalogo.ler`, 403 |

  O acesso do Orzuni não lê mais nada da porta (vendas, clientes, cupons, fichas, fila da cozinha: 403) e não liga a
  cópia das vendas (o carimbador): as duas permissões são de leitura na hora.
- **Credencial — duas formas, o mesmo acesso:**
  - **pela ligação do DMS ID (o destino):** `Authorization: Bearer <token do DMS ID do aplicativo Orzuni>` +
    `DMS-Ligacao: dms_lg_regem_…`. A ligação nasce da troca automática (`POST /integracao/dms-id/ligacao` com o
    `rgm_it_` da loja, uma vez por loja — `docs/integracao-dms-id.md` §2). Valem as permissões que a loja autorizou E
    que o token do DMS ID tem;
  - **pelo token da loja:** `Authorization: Bearer rgm_it_…` (50 caracteres). É a credencial antiga dos produtos da
    DMS: serve para começar e para a troca; o uso direto sai na F6 do Hub DMS.
- **Como a loja autoriza (piloto):** a distribuição emite o `rgm_it_` da loja no console da distribuição (quadro
  "Tokens de integração" › "Emitir token", cliente **Orzuni**, as duas permissões), com a autorização do presidente
  registrada como evidência. O token aparece
  uma vez; o Orzuni guarda cifrado e troca pela ligação. **Depois do piloto:** a autorização por clique do presidente
  (`docs/integracao-dms-id.md` §9), sem token colado — pede a ficha do Orzuni no clique e o fluxo OAuth do lado dele.
- **Limite:** 60 chamadas/min por acesso → `429` com `Retry-After` em segundos. **Erros:** `application/problem+json`;
  `401` = credencial ausente, inválida ou revogada; `403` = falta a permissão (`detail` diz qual).
- **Revogar:** o presidente em **Configurações › Aplicativos conectados**, ou a distribuição pelo console. Vale na
  chamada seguinte.

## 2. Os campos do iFood (só com `catalogo.ifood.ler`)

No produto:

| Campo | Tipo | O que é |
|---|---|---|
| `preco_ifood_centavos` | inteiro ou `null` | o preço do produto **no iFood**, em centavos (pode ser diferente do preço do Regem). `null` = sem preço próprio no iFood: **não mandar preço ao iFood** |
| `no_ifood` | `true`/`false` | `true` = a loja diz que o produto **ESTÁ** no cardápio do iFood (é o "no" de "no iFood", não "não"). `false` = não está, ou ainda não foi marcado |

Na opção de adicional (`produtos[].adicionais[].opcoes[]`):

| Campo | Tipo | O que é |
|---|---|---|
| `preco_ifood_centavos` | inteiro ou `null` | o preço do complemento no iFood, em centavos. É o da **opção reutilizável** (`opcao_id`): um preço por código PDV. `null` = sem preço no iFood, ou opção criada só neste produto (`opcao_id` nulo) |

```json
{
  "id": "p1…",
  "codigo": "XB",
  "nome": "X-Burger",
  "ativo": true,
  "preco_ifood_centavos": 4550,
  "no_ifood": true,
  "adicionais": [
    {
      "nome": "Adicionais",
      "opcoes": [
        { "opcao_id": "o1…", "nome": "Bacon", "codigo": "AD-BAC", "ordem": 0, "preco_ifood_centavos": 400 }
      ]
    }
  ]
}
```

(Trecho: os outros campos do produto e da opção são os do `docs/integracao-farol.md` §4.)

**A regra do dono que o Orzuni respeita ao montar o iFood:** só o produto com `no_ifood: true` **e** com
`preco_ifood_centavos` preenchido vai ao iFood, pelo preço do iFood (nunca o preço do Regem, que não sai nesta rota). O
que só existe no iFood o Regem nunca apaga.

**A versão** (`?versao=`) cobre os campos do iFood: mudar o preço do iFood de um produto ou de uma opção muda a versão
do Orzuni (e não a do Farol, que não recebe esses campos).

## 3. O que NÃO sai

| Não sai | Onde fica |
|---|---|
| Preço de venda do Regem, acréscimo do adicional, preço promocional | no Regem |
| Custo, margem, CMV, fichas técnicas | no Regem |
| Vendas, clientes, cupons, caixa, estoque, equipe | no Regem |

O teste `integracao-orzuni.http.spec.ts` prova os campos, o `null`, o maior valor da coluna (os centavos passam do
inteiro de 32 bits), a versão, o 403 sem `catalogo.ler`, que o Farol não recebe nem o nome dos campos e que o acesso do
Orzuni não abre o `/sync/catalogo` nem as outras leituras.

## 4. O que a distribuição configura

- **Banco:** a migration 374 (só nuvem; troca as duas travas de escopo — vai pelo SQL Editor, LIC-171).
- **Para a ligação do DMS ID:** no `regem-api`, `DMS_ID_APLICATIVOS` ganha `"orzuni":"<client_id do aplicativo Orzuni no
  DMS ID>"`; no DMS ID (hub), o recurso do Regem passa a ter a permissão `catalogo.ifood.ler`, e o aplicativo Orzuni
  recebe `catalogo.ler` e `catalogo.ifood.ler` para esse recurso.
- **Avisos (webhook):** ainda não. O Orzuni lê quando precisa, com `?versao=`. Para receber o `catalogo.alterado`
  (`docs/integracao-farol.md` §9), o Regem precisa do endereço base do Orzuni em `WEBHOOK_INTEGRACAO` (`escopos.ts`).

# Regem × RegeMBoard — o esgotado na TV

O RegeMBoard mostra o cardápio nas TVs da loja. Ligado ao Regem, ele mostra "Esgotado" no produto que acabou, sem
ninguém mexer no painel dele. Hub DMS, F6, plano "Clique RegeMBoard → Regem" (decisões R-1 a R-9, 15/11/2026);
protótipo `prototipos/clique-regemboard.html` do hub; migration 429.

## Como liga

Pelo **clique** (Padrão DMS §3), loja por loja, igual ao GoGeM: o dono do RegeMBoard clica em "Conectar pelo Regem", o
presidente da empresa autoriza no Regem (`/integracoes/autorizar`) e o RegeMBoard troca o código pela **ligação** de
cada loja marcada (`dms_lg_regem_…`). Não há token colado (R-8).

- Ficha `regemboard` em `APLICATIVOS_DO_CLIQUE` (`autorizacao-clique.regras.ts`): as duas permissões são necessárias;
  a volta vem de `INTEGRACAO_REGEMBOARD_REDIRECT_URIS` (padrão `https://app.regemboard.com/integracoes/regem/volta`).
- Cliente `regemboard` em `CLIENTES_INTEGRACAO` (`escopos.ts`), abrangência loja. **A entrada no código vem antes da
  variável:** só ponha `regemboard` em `DMS_ID_APLICATIVOS` com esta versão no ar — cliente que o código não conhece
  DESLIGA a via do DMS ID inteira (`ligacao.regras.ts`; ver ERR-477 e a V92).

## As permissões

| Permissão | O que libera | Frase na página |
|---|---|---|
| `catalogo.ler` | `GET /integracao/catalogo` | Os produtos da loja, com categoria, variações, setor de produção, tempo de preparo e os adicionais de cada um. Sem preço. |
| `catalogo.disponibilidade.ler` (nova, só produto da DMS) | os campos de disponibilidade no mesmo catálogo e o aviso `disponibilidade.alterada` | Se cada produto e cada adicional está à venda agora nesta loja: esgotado, pausado ou fora do cardápio. Sem preço. |

## Os campos (só com `catalogo.disponibilidade.ler`)

No produto:

- `disponivel` (bool) e `indisponivel_por`: `fora_do_cardapio` (`ativo` falso) > `esgotado` (`pausado_estoque`, todas as
  lojas) > `esgotado_na_loja` (`produto_pausa_estoque` da loja do acesso) > `null` (à venda). É a regra da venda
  (`common/pausa-loja.ts`). O acesso sem loja só vê o esgotado de todas as lojas.

No adicional (`adicionais[].opcoes[]`):

- `disponivel` e `indisponivel_por`: `fora_do_cardapio` (`opcao.ativo` falso) > `esgotado` (`opcao.esgotado`) > `null`. Vale
  a opção reutilizável de onde o adicional saiu; o adicional criado só no produto está sempre à venda.

A pausa por **canal** (`canais_pausados`: iFood, 99, totem) não conta: é de um canal, e a TV da loja não é canal nenhum.
Os campos fazem parte da versão do retrato DESTE acesso: esgotar muda a versão do RegeMBoard, e a do Farol não.

## O aviso

`disponibilidade.alterada` (Standard Webhooks, como os outros avisos do Regem), para o endereço que o RegeMBoard registra em
`PUT /integracao/webhook` dentro de `INTEGRACAO_REGEMBOARD_WEBHOOK_URLS` (padrão `https://api.regemboard.com/v1/regem/avisos/`,
um trecho depois: o id da conexão). Corpo: `{ "tipo": "disponibilidade.alterada", "loja_id": "…" }` — só o gatilho;
quem recebe lê `GET /integracao/catalogo?versao=`.

- Sai quando: o produto esgota ou volta em todas as lojas (`pausado_estoque`); a pausa da loja entra, muda ou sai
  (`produto_pausa_estoque`); o adicional esgota ou volta (`opcao.esgotado`). Ligar ou desligar o produto (`ativo`) já
  avisa `catalogo.alterado`, que o RegeMBoard também recebe (tem `catalogo.ler`).
- Como sai: gatilhos POR COMANDO da 429 (`integracao_disponibilidade_mudou`) enfileiram o recurso `disponibilidade` na
  fila da 316; o job dos avisos carimba a marca e avisa, com a mesma regra de loja e de atraso do catálogo. Só a empresa
  com token ativo desta permissão enche a fila. Medido: 2.000 produtos num comando = uma linha na fila.

## Provas

- `integracao-retrato-aviso.http.spec.ts`, bloco "a disponibilidade avisa o RegeMBoard (mig 429)": os 5 gatilhos só nas
  cópias, esgotar e voltar em todas as lojas, a pausa da R1 avisa a R1 e a da R2 não, o adicional, o que não enfileira,
  o catálogo com e sem a permissão (e a versão), a medição em massa.
- `autorizacao-clique.http.spec.ts` (de ponta a ponta) e `autorizacao-clique.regras.spec.ts` (a ficha e o pedido).
- `integracao-token.spec.ts` (a lista de escopos = a trava da 429).

## A migration

`429_integracao_disponibilidade.sql` (`@cloud-only`): troca as quatro travas (escopos do token e da autorização; recurso
da fila e da marca dos avisos) e cria a função e os 5 gatilhos. Tem `drop constraint` → **vai pelo SQL Editor** do
Supabase (o MCP recusa `drop`, ERR-225), ANTES do merge, fora do pico. A conferência no fim tem 6 linhas `ok`.
